-- =============================================================================
-- Diagnóstico: recomeçar do zero (com cópia para desfazer)
--  * A empresa mudou o jeito de trabalhar, não gostou das respostas ou faltavam
--    dados: dono/admin zera retrato, processos, planejamento, sugestões, dados
--    públicos, etapa e conversa. Antes, guarda uma cópia (últimas 5) para desfazer.
--  * Fluxos e registros já instalados como rascunho não são tocados.
--  * Só pelo RPC (dono/admin), com auditoria. Cópias: só o backend lê o conteúdo.
-- Idempotente.
-- =============================================================================

-- Etapas do diagnóstico em páginas: texto do dono + aprovação por etapa.
ALTER TABLE public.company_profiles ADD COLUMN IF NOT EXISTS steps jsonb NOT NULL DEFAULT '{}'::jsonb;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_profiles_steps_check') THEN
    ALTER TABLE public.company_profiles ADD CONSTRAINT company_profiles_steps_check
      CHECK (jsonb_typeof(steps) = 'object' AND pg_column_size(steps) < 300000);
  END IF;
END $$;
GRANT UPDATE (steps) ON public.company_profiles TO authenticated;

CREATE TABLE IF NOT EXISTS public.company_profile_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile jsonb NOT NULL,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS company_profile_snapshots_org_idx ON public.company_profile_snapshots (organization_id, id DESC);
ALTER TABLE public.company_profile_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_profile_snapshots FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.reset_company_profile(org uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.company_profiles;
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO p FROM public.company_profiles WHERE organization_id = org FOR UPDATE;
  IF p.organization_id IS NOT NULL THEN
    INSERT INTO public.company_profile_snapshots (organization_id, profile, messages, created_by)
    VALUES (org, to_jsonb(p) - 'organization_id',
            coalesce((SELECT jsonb_agg(jsonb_build_object('role', m.role, 'content', m.content) ORDER BY m.id)
                      FROM public.interview_messages m WHERE m.organization_id = org), '[]'::jsonb),
            auth.uid());
    DELETE FROM public.company_profile_snapshots s
    WHERE s.organization_id = org AND s.id NOT IN (
      SELECT id FROM public.company_profile_snapshots WHERE organization_id = org ORDER BY id DESC LIMIT 5);
    UPDATE public.company_profiles SET sections = '{}'::jsonb, processes = '[]'::jsonb, suggestions = '[]'::jsonb,
      suggestions_at = NULL, stage = 'empresa', public_research = '{}'::jsonb, plan = '{}'::jsonb, plan_at = NULL, steps = '{}'::jsonb,
      updated_by = auth.uid()
    WHERE organization_id = org;
  END IF;
  DELETE FROM public.interview_messages WHERE organization_id = org;
  INSERT INTO public.audit_log (organization_id, actor_id, action, target, meta)
  VALUES (org, auth.uid(), 'diagnostic.reset', NULL, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true, 'saved_copy', p.organization_id IS NOT NULL);
END $$;

-- Desfazer: volta a cópia mais recente (e a remove da lista).
CREATE OR REPLACE FUNCTION public.restore_company_profile(org uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.company_profile_snapshots;
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.company_profile_snapshots WHERE organization_id = org ORDER BY id DESC LIMIT 1 FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'não há diagnóstico anterior guardado' USING ERRCODE = '22023'; END IF;
  UPDATE public.company_profiles SET
    sections = coalesce(s.profile -> 'sections', '{}'::jsonb), processes = coalesce(s.profile -> 'processes', '[]'::jsonb),
    suggestions = coalesce(s.profile -> 'suggestions', '[]'::jsonb), suggestions_at = (s.profile ->> 'suggestions_at')::timestamptz,
    stage = coalesce(s.profile ->> 'stage', 'empresa'), public_research = coalesce(s.profile -> 'public_research', '{}'::jsonb),
    plan = coalesce(s.profile -> 'plan', '{}'::jsonb), plan_at = (s.profile ->> 'plan_at')::timestamptz,
    use_in_ai = coalesce((s.profile ->> 'use_in_ai')::boolean, true), steps = coalesce(s.profile -> 'steps', '{}'::jsonb), updated_by = auth.uid()
  WHERE organization_id = org;
  DELETE FROM public.interview_messages WHERE organization_id = org;
  INSERT INTO public.interview_messages (organization_id, role, content)
  SELECT org, x ->> 'role', x ->> 'content' FROM jsonb_array_elements(s.messages) x;
  DELETE FROM public.company_profile_snapshots WHERE id = s.id;
  INSERT INTO public.audit_log (organization_id, actor_id, action, target, meta)
  VALUES (org, auth.uid(), 'diagnostic.restore', NULL, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true);
END $$;

-- Quantas cópias existem (para mostrar o "Desfazer").
CREATE OR REPLACE FUNCTION public.company_profile_snapshots_count(org uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN private.has_permission(org, 'org.settings')
    THEN (SELECT count(*)::integer FROM public.company_profile_snapshots WHERE organization_id = org) ELSE 0 END
$$;
REVOKE ALL ON FUNCTION public.reset_company_profile(uuid), public.restore_company_profile(uuid),
  public.company_profile_snapshots_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_company_profile(uuid), public.restore_company_profile(uuid),
  public.company_profile_snapshots_count(uuid) TO authenticated;
