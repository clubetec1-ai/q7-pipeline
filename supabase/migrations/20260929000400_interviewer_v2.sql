-- =============================================================================
-- Entrevistador 2.0 — consultoria completa e planejamento estratégico (28/09)
--  * Etapas: empresa (dados públicos + atendimento) → cultura → situação →
--    objetivos → setores → processos (por setor, "como se ensinasse") → plano.
--  * Novas seções internas: cultura (missão, visão, valores), situacao,
--    objetivos, setores. Nunca vão para a IA de atendimento.
--  * public_research: o que foi achado em fontes abertas (site, CNPJ).
--  * plan: planejamento estratégico gerado pelo backend (só leitura no navegador).
-- Idempotente.
-- =============================================================================

ALTER TABLE public.company_profiles
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'empresa',
  ADD COLUMN IF NOT EXISTS public_research jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS plan_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_profiles_stage_check') THEN
    ALTER TABLE public.company_profiles ADD CONSTRAINT company_profiles_stage_check CHECK (
      stage IN ('empresa', 'cultura', 'situacao', 'objetivos', 'setores', 'processos', 'plano')
      AND pg_column_size(public_research) < 50000 AND pg_column_size(plan) < 200000);
  END IF;
END $$;

-- Só as seções conhecidas; cada uma é texto (até 8 mil caracteres).
CREATE OR REPLACE FUNCTION private.company_profile_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE k text;
BEGIN
  FOR k IN SELECT jsonb_object_keys(NEW.sections) LOOP
    IF k NOT IN ('empresa', 'atendimento', 'produtos', 'politicas', 'faq', 'areas', 'sistemas', 'metas',
                 'cultura', 'situacao', 'objetivos', 'setores') THEN
      RAISE EXCEPTION 'seção desconhecida: %', k USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(NEW.sections -> k) <> 'string' OR char_length(NEW.sections ->> k) > 8000 THEN
      RAISE EXCEPTION 'seção % inválida ou longa demais', k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- O dono pode escolher a etapa (voltar/pular); plano e pesquisa só pelo backend.
GRANT UPDATE (stage) ON public.company_profiles TO authenticated;
