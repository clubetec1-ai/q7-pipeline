-- =============================================================================
-- Correção (teste de ponta a ponta com o Cartório Teste, 02/10): as seções novas
-- do Diagnóstico 3.0 (clientes, regras_ia, marca_visual, marca_voz) não estavam
-- na lista do guarda de company_profiles — aprovar Clientes e jornada, Marca e
-- Regras e limites da IA era recusado ("seção desconhecida").
-- A lista acompanha SECTIONS em supabase/functions/_shared/company.ts.
-- Idempotente.
-- =============================================================================

CREATE OR REPLACE FUNCTION private.company_profile_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE k text;
BEGIN
  FOR k IN SELECT jsonb_object_keys(NEW.sections) LOOP
    IF k NOT IN ('empresa', 'atendimento', 'produtos', 'politicas', 'faq', 'clientes', 'regras_ia', 'marca_visual',
                 'marca_voz', 'cultura', 'situacao', 'objetivos', 'setores', 'areas', 'sistemas', 'metas') THEN
      RAISE EXCEPTION 'seção desconhecida: %', k USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(NEW.sections -> k) <> 'string' OR char_length(NEW.sections ->> k) > 8000 THEN
      RAISE EXCEPTION 'seção % inválida ou longa demais', k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
