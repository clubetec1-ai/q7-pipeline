-- =============================================================================
-- Agente entrevistador — levantamento da empresa (roadmap: IA)
--  * company_profiles: retrato da empresa por seção (texto consolidado) +
--    processos repetidos + sugestões de automação. Só org.settings.
--  * interview_messages: a conversa do dono com o entrevistador.
--  * Seções públicas (empresa, atendimento, produtos, políticas, faq) podem ir
--    para a IA de atendimento (use_in_ai); as internas nunca vão.
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.company_profiles (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  sections jsonb NOT NULL DEFAULT '{}'::jsonb,
  processes jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggestions_at timestamptz,
  use_in_ai boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(sections) = 'object' AND pg_column_size(sections) < 200000),
  CHECK (jsonb_typeof(processes) = 'array' AND jsonb_array_length(processes) <= 100),
  CHECK (jsonb_typeof(suggestions) = 'array' AND jsonb_array_length(suggestions) <= 50)
);

CREATE TABLE IF NOT EXISTS public.interview_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('assistant', 'user')),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 8000),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS interview_messages_org_idx ON public.interview_messages (organization_id, id);

-- Só as seções conhecidas; cada uma é texto (até 8 mil caracteres).
CREATE OR REPLACE FUNCTION private.company_profile_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE k text;
BEGIN
  FOR k IN SELECT jsonb_object_keys(NEW.sections) LOOP
    IF k NOT IN ('empresa', 'atendimento', 'produtos', 'politicas', 'faq', 'areas', 'sistemas', 'metas') THEN
      RAISE EXCEPTION 'seção desconhecida: %', k USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(NEW.sections -> k) <> 'string' OR char_length(NEW.sections ->> k) > 8000 THEN
      RAISE EXCEPTION 'seção % inválida ou longa demais', k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.company_profile_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS company_profile_guard ON public.company_profiles;
CREATE TRIGGER company_profile_guard BEFORE INSERT OR UPDATE ON public.company_profiles
  FOR EACH ROW EXECUTE FUNCTION private.company_profile_guard();

ALTER TABLE public.company_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interview_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_profiles, public.interview_messages FROM anon, authenticated;
GRANT SELECT ON public.company_profiles, public.interview_messages TO authenticated;
GRANT INSERT (organization_id, sections, processes, use_in_ai, updated_by) ON public.company_profiles TO authenticated;
GRANT UPDATE (sections, processes, use_in_ai, updated_by) ON public.company_profiles TO authenticated;
GRANT DELETE ON public.interview_messages TO authenticated; -- "recomeçar a conversa"

DROP POLICY IF EXISTS "org: dono/admin" ON public.company_profiles;
CREATE POLICY "org: dono/admin" ON public.company_profiles FOR ALL TO authenticated
  USING (private.has_permission(organization_id, 'org.settings'))
  WITH CHECK (private.has_permission(organization_id, 'org.settings'));
DROP POLICY IF EXISTS "org: dono/admin" ON public.interview_messages;
CREATE POLICY "org: dono/admin" ON public.interview_messages FOR ALL TO authenticated
  USING (private.has_permission(organization_id, 'org.settings'))
  WITH CHECK (private.has_permission(organization_id, 'org.settings'));
