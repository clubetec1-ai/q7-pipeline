-- =============================================================================
-- Diagnóstico, 2ª parte: as seções novas (dados, pos_venda, presenca, medicao)
-- entram na lista do guarda de company_profiles — sem isso, aprovar Pós-venda,
-- Sistemas e dados e Publicar e medir era recusado ("seção desconhecida").
-- A lista acompanha SECTIONS em supabase/functions/_shared/company.ts.
-- Idempotente.
-- =============================================================================
CREATE OR REPLACE FUNCTION private.company_profile_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE k text;
BEGIN
  FOR k IN SELECT jsonb_object_keys(NEW.sections) LOOP
    IF k NOT IN ('empresa', 'atendimento', 'produtos', 'politicas', 'faq', 'clientes', 'regras_ia', 'marca_visual',
                 'marca_voz', 'cultura', 'situacao', 'objetivos', 'setores', 'areas', 'sistemas', 'metas',
                 'dados', 'pos_venda', 'presenca', 'medicao') THEN
      RAISE EXCEPTION 'seção desconhecida: %', k USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(NEW.sections -> k) <> 'string' OR char_length(NEW.sections ->> k) > 8000 THEN
      RAISE EXCEPTION 'seção % inválida ou longa demais', k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
