-- =============================================================================
-- Verificação em duas etapas (MFA/TOTP do Supabase Auth) — roadmap segurança
--  * Quem tem MFA ativado e entrou só com senha (sessão aal1) não recebe
--    nenhuma permissão até digitar o código (aal2): senha vazada não basta.
--  * A empresa pode exigir MFA de donos e administradores (settings.require_mfa);
--    sem MFA, eles ficam sem permissões até ativar. Só liga quem já tem MFA.
--  * Operador da plataforma (acesso a várias empresas) só com aal2.
--  * Vale para tela, API e Edge Functions: tudo passa por effective_permissions.
-- Idempotente.
-- =============================================================================

CREATE OR REPLACE FUNCTION private.aal2()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce((SELECT auth.jwt()) ->> 'aal', 'aal1') = 'aal2'
$$;

CREATE OR REPLACE FUNCTION private.has_verified_factor()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM auth.mfa_factors
                 WHERE user_id = (SELECT auth.uid()) AND status = 'verified')
$$;
REVOKE ALL ON FUNCTION private.aal2(), private.has_verified_factor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.aal2(), private.has_verified_factor() TO authenticated;

CREATE OR REPLACE FUNCTION private.is_platform_operator()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.aal2() AND EXISTS (SELECT 1 FROM public.platform_operators
                                    WHERE user_id = (SELECT auth.uid()))
$$;

CREATE OR REPLACE FUNCTION private.effective_permissions(org uuid)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.org_role;
BEGIN
  IF org IS NULL OR (SELECT auth.uid()) IS NULL THEN RETURN ARRAY[]::text[]; END IF;
  -- MFA ativado + sessão só com senha: nada até digitar o código.
  IF NOT private.aal2() AND private.has_verified_factor() THEN RETURN ARRAY[]::text[]; END IF;
  r := private.member_role(org);
  IF r IS NOT NULL THEN
    IF r IN ('owner', 'admin') AND NOT private.aal2()
       AND coalesce((SELECT (settings ->> 'require_mfa')::boolean FROM public.organizations WHERE id = org), false) THEN
      RETURN ARRAY[]::text[];
    END IF;
    RETURN private.role_permissions(r);
  END IF;
  IF private.aal2() AND private.has_support_access(org) THEN
    RETURN array_remove(array_remove(private.role_permissions('admin'),
      'members.manage'), 'org.billing');
  END IF;
  RETURN ARRAY[]::text[];
END $$;

-- Situação do MFA de quem está logado (a tela decide pedir código ou ativação).
CREATE OR REPLACE FUNCTION public.my_mfa_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'enrolled', private.has_verified_factor(),
    'aal2', private.aal2(),
    'required', EXISTS (SELECT 1 FROM public.platform_operators WHERE user_id = (SELECT auth.uid()))
      OR EXISTS (SELECT 1 FROM public.organization_members m JOIN public.organizations o ON o.id = m.organization_id
                 WHERE m.user_id = (SELECT auth.uid()) AND m.status = 'active' AND o.status = 'active'
                   AND m.role IN ('owner', 'admin') AND coalesce((o.settings ->> 'require_mfa')::boolean, false)))
$$;
REVOKE ALL ON FUNCTION public.my_mfa_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_mfa_status() TO authenticated;

-- Exigir MFA de donos/admins (só quem já tem MFA e está com código digitado).
CREATE OR REPLACE FUNCTION public.set_require_mfa(org uuid, required boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  IF required AND NOT (private.aal2() AND private.has_verified_factor()) THEN
    RAISE EXCEPTION 'ative a verificação em duas etapas na sua conta antes de exigir da equipe' USING ERRCODE = '22023';
  END IF;
  UPDATE public.organizations SET settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('require_mfa', required)
  WHERE id = org;
  INSERT INTO public.audit_log (organization_id, actor_id, action, target, meta)
  VALUES (org, auth.uid(), 'security.require_mfa', NULL, jsonb_build_object('required', required));
END $$;
REVOKE ALL ON FUNCTION public.set_require_mfa(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_require_mfa(uuid, boolean) TO authenticated;
