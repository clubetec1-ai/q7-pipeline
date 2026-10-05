-- =============================================================================
-- Diagnóstico, 2ª parte (Fase 3, item 18): convidar o responsável do setor para
-- escrever os processos do setor dele. A pessoa convidada vê SÓ o convite dela
-- (nome do setor e o texto que ela mesma escreve) — nada do resto do Diagnóstico.
-- O texto enviado volta para o dono, que organiza com IA e aprova como hoje.
-- Idempotente.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.diag_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  setor text NOT NULL CHECK (char_length(btrim(setor)) BETWEEN 1 AND 80),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'used')),
  raw text CHECK (raw IS NULL OR char_length(raw) <= 12000),
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  UNIQUE (organization_id, setor, user_id)
);
ALTER TABLE public.diag_delegations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.diag_delegations FROM anon, authenticated;
GRANT SELECT ON public.diag_delegations TO authenticated;
GRANT ALL ON public.diag_delegations TO service_role;
DROP POLICY IF EXISTS "ver" ON public.diag_delegations;
CREATE POLICY "ver" ON public.diag_delegations FOR SELECT TO authenticated USING (
  private.module_on(organization_id, 'diagnostico') AND (
    private.has_permission(organization_id, 'org.settings')
    OR (user_id = (SELECT auth.uid()) AND private.is_member(organization_id) AND status <> 'used')));

CREATE OR REPLACE FUNCTION public.diag_invite_sector(org uuid, p_setor text, uid uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE nid uuid; s text := btrim(coalesce(p_setor, ''));
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  PERFORM private.require_module(org, 'diagnostico');
  IF char_length(s) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'setor inválido' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = org AND user_id = uid AND status = 'active') THEN
    RAISE EXCEPTION 'a pessoa precisa ser da equipe' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.diag_delegations (organization_id, setor, user_id, invited_by)
  VALUES (org, s, uid, (SELECT auth.uid()))
  ON CONFLICT (organization_id, setor, user_id) DO UPDATE
    SET status = 'pending', invited_by = EXCLUDED.invited_by, created_at = now(), submitted_at = NULL
  RETURNING id INTO nid;
  INSERT INTO public.notifications (organization_id, user_id, kind, ref)
  VALUES (org, uid, 'diag_invite', jsonb_build_object('id', nid, 'setor', s));
  PERFORM private.audit(org, 'diag.invite', nid::text, jsonb_build_object('setor', s, 'user_id', uid));
  RETURN nid;
END $$;
REVOKE ALL ON FUNCTION public.diag_invite_sector(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diag_invite_sector(uuid, text, uuid) TO authenticated;

-- A pessoa convidada envia (ou reenvia) o texto do setor dela.
CREATE OR REPLACE FUNCTION public.diag_submit_sector(delegation uuid, p_raw text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.diag_delegations; t text := btrim(coalesce(p_raw, ''));
BEGIN
  SELECT * INTO d FROM public.diag_delegations WHERE id = delegation;
  IF d.id IS NULL OR d.user_id <> (SELECT auth.uid()) OR d.status = 'used' OR NOT private.is_member(d.organization_id) THEN
    RAISE EXCEPTION 'convite não encontrado' USING ERRCODE = '42501';
  END IF;
  PERFORM private.require_module(d.organization_id, 'diagnostico');
  IF char_length(t) NOT BETWEEN 10 AND 12000 THEN RAISE EXCEPTION 'escreva ao menos uma frase (até 12 mil caracteres)' USING ERRCODE = '22023'; END IF;
  UPDATE public.diag_delegations SET raw = t, status = 'submitted', submitted_at = now() WHERE id = d.id;
  -- Avisa quem convidou (se ainda puder ver o Diagnóstico) ou, senão, os donos.
  INSERT INTO public.notifications (organization_id, user_id, kind, ref)
  SELECT d.organization_id, m.user_id, 'diag_submitted', jsonb_build_object('id', d.id, 'setor', d.setor,
    'name', left(coalesce((SELECT display_name FROM public.organization_members WHERE organization_id = d.organization_id AND user_id = d.user_id), ''), 80))
  FROM public.organization_members m
  WHERE m.organization_id = d.organization_id AND m.status = 'active'
    AND (m.user_id = d.invited_by OR (m.role = 'owner' AND NOT EXISTS (
      SELECT 1 FROM public.organization_members x WHERE x.organization_id = d.organization_id AND x.user_id = d.invited_by AND x.status = 'active')));
  PERFORM private.audit(d.organization_id, 'diag.submit', d.id::text, jsonb_build_object('setor', d.setor));
END $$;
REVOKE ALL ON FUNCTION public.diag_submit_sector(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diag_submit_sector(uuid, text) TO authenticated;

-- Dono: marcar como usado (o texto foi para a etapa) ou cancelar o convite.
CREATE OR REPLACE FUNCTION public.diag_close_delegation(delegation uuid, p_used boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.diag_delegations;
BEGIN
  SELECT * INTO d FROM public.diag_delegations WHERE id = delegation;
  IF d.id IS NULL OR NOT private.has_permission(d.organization_id, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF p_used THEN UPDATE public.diag_delegations SET status = 'used' WHERE id = d.id;
  ELSE DELETE FROM public.diag_delegations WHERE id = d.id; END IF;
  PERFORM private.audit(d.organization_id, CASE WHEN p_used THEN 'diag.use' ELSE 'diag.cancel' END, d.id::text, jsonb_build_object('setor', d.setor));
END $$;
REVOKE ALL ON FUNCTION public.diag_close_delegation(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diag_close_delegation(uuid, boolean) TO authenticated;
