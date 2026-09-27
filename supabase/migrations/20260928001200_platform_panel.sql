-- =============================================================================
-- Painel da plataforma (operadores Clubetec) — spec multi-tenant §5.4, §8.3
--  * Visão das empresas clientes (só contagens, nenhum conteúdo de conversa).
--  * Suspender/reativar empresa.
--  * Acesso de suporte com motivo obrigatório e prazo (até 120 min), auditado;
--    o operador só enxerga dados da empresa enquanto o acesso valer.
--  * service_create_org: criar empresa com modelo (usada pela Edge Function
--    platform-orgs, que também convida o dono).
-- Tudo exige private.is_platform_operator(). Idempotente.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.platform_org_overview()
RETURNS TABLE (id uuid, name text, status text, template_key text, plan text, created_at timestamptz,
               members bigint, numbers bigint, mailboxes bigint, conversations_30d bigint, last_activity timestamptz,
               support_until timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT o.id, o.name, o.status, o.template_key, o.plan, o.created_at,
      (SELECT count(*) FROM public.organization_members m WHERE m.organization_id = o.id AND m.status = 'active'),
      (SELECT count(*) FROM public.whatsapp_instances w WHERE w.organization_id = o.id),
      (SELECT count(*) FROM public.email_accounts e WHERE e.organization_id = o.id),
      (SELECT count(*) FROM public.conversations c WHERE c.organization_id = o.id AND c.last_message_at > now() - interval '30 days'),
      (SELECT max(c.last_message_at) FROM public.conversations c WHERE c.organization_id = o.id),
      (SELECT max(s.expires_at) FROM public.support_access s
        WHERE s.organization_id = o.id AND s.operator_id = (SELECT auth.uid()) AND s.expires_at > now())
    FROM public.organizations o ORDER BY o.created_at DESC;
END $$;

CREATE OR REPLACE FUNCTION public.platform_set_org_status(org uuid, new_status text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF new_status NOT IN ('active', 'suspended') THEN RAISE EXCEPTION 'situação inválida' USING ERRCODE = '22023'; END IF;
  UPDATE public.organizations SET status = new_status WHERE id = org;
  IF NOT FOUND THEN RAISE EXCEPTION 'empresa não encontrada' USING ERRCODE = '22023'; END IF;
  PERFORM private.audit(org, 'platform.org_status', org::text, jsonb_build_object('status', new_status));
END $$;

CREATE OR REPLACE FUNCTION public.platform_open_support(org uuid, reason text, minutes integer DEFAULT 60)
RETURNS timestamptz LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE until timestamptz := now() + make_interval(mins => least(greatest(coalesce(minutes, 60), 15), 120));
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF char_length(trim(coalesce(reason, ''))) < 10 THEN
    RAISE EXCEPTION 'descreva o motivo do acesso (mín. 10 caracteres)' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = org) THEN
    RAISE EXCEPTION 'empresa não encontrada' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.support_access (organization_id, operator_id, reason, expires_at)
  VALUES (org, (SELECT auth.uid()), left(trim(reason), 500), until);
  PERFORM private.audit(org, 'platform.support_open', org::text,
    jsonb_build_object('reason', left(trim(reason), 500), 'until', until));
  RETURN until;
END $$;

CREATE OR REPLACE FUNCTION public.platform_close_support(org uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  UPDATE public.support_access SET expires_at = now()
  WHERE organization_id = org AND operator_id = (SELECT auth.uid()) AND expires_at > now();
  IF FOUND THEN PERFORM private.audit(org, 'platform.support_close', org::text, '{}'::jsonb); END IF;
END $$;

-- Empresas em que o operador está com acesso de suporte ativo (para o seletor).
CREATE OR REPLACE FUNCTION public.my_support_access()
RETURNS TABLE (organization_id uuid, name text, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.organization_id, o.name, max(s.expires_at)
  FROM public.support_access s JOIN public.organizations o ON o.id = s.organization_id AND o.status = 'active'
  WHERE s.operator_id = (SELECT auth.uid()) AND s.expires_at > now()
  GROUP BY s.organization_id, o.name
$$;

CREATE OR REPLACE FUNCTION public.service_create_org(org_name text, template text, creator uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE org uuid;
BEGIN
  IF char_length(trim(coalesce(org_name, ''))) < 2 THEN RAISE EXCEPTION 'nome da empresa inválido' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.organizations (name, slug, template_key, created_by)
  VALUES (left(trim(org_name), 120), 'org-' || left(md5(gen_random_uuid()::text), 10), template, creator)
  RETURNING id INTO org;
  PERFORM private.apply_template(org, template, NULL);
  PERFORM private.audit(org, 'platform.org_create', org::text, jsonb_build_object('template', template, 'by', creator));
  RETURN org;
END $$;

REVOKE ALL ON FUNCTION public.platform_org_overview(), public.platform_set_org_status(uuid, text),
  public.platform_open_support(uuid, text, integer), public.platform_close_support(uuid), public.my_support_access()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_org_overview(), public.platform_set_org_status(uuid, text),
  public.platform_open_support(uuid, text, integer), public.platform_close_support(uuid), public.my_support_access()
  TO authenticated;
REVOKE ALL ON FUNCTION public.service_create_org(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_create_org(text, text, uuid) TO service_role;
