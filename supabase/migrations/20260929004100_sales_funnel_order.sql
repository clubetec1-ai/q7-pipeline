-- =============================================================================
-- Funil de vendas (design P2, 03/10): ao instalar, as etapas do funil ficam na
-- ordem certa (Novo lead → … → Perdido) e as etapas antigas da empresa vão para
-- o fim, em vez de as novas ficarem depois das antigas. Nada é apagado.
-- Idempotente.
-- =============================================================================
CREATE OR REPLACE FUNCTION private.install_sales_funnel(org uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  st record; added int := 0; defs jsonb; f jsonb; i int := 0; n int;
  stages jsonb := '[{"name":"Novo lead","color":"#2563EB"},{"name":"Qualificado","color":"#0891B2"},
    {"name":"Diagnóstico ou demonstração","color":"#7C3AED"},{"name":"Proposta enviada","color":"#D97706"},
    {"name":"Teste grátis","color":"#65A30D"},{"name":"Cliente","color":"#16A34A"},{"name":"Perdido","color":"#64748B"}]';
  want jsonb := '[{"key":"origem","label":"Origem do contato","type":"text","ai_readable":true},
    {"key":"segmento","label":"Tipo de empresa","type":"text","ai_readable":true},
    {"key":"equipe","label":"Pessoas no atendimento","type":"text","ai_readable":true},
    {"key":"dor","label":"Maior dificuldade","type":"long_text","ai_readable":true}]';
BEGIN
  FOR st IN SELECT value FROM jsonb_array_elements(stages) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.pipeline_stages WHERE organization_id = org AND lower(name) = lower(st.value ->> 'name')) THEN
      added := added + 1;
      INSERT INTO public.pipeline_stages (organization_id, name, color, position)
      VALUES (org, st.value ->> 'name', st.value ->> 'color', 1000 + added);
    END IF;
  END LOOP;

  -- Ordem: as 7 do funil primeiro (na ordem do funil), depois as outras da empresa (na ordem em que estavam).
  n := jsonb_array_length(stages);
  FOR st IN
    SELECT s.id FROM public.pipeline_stages s
    LEFT JOIN LATERAL (SELECT ord FROM jsonb_array_elements(stages) WITH ORDINALITY AS x(v, ord)
                       WHERE lower(x.v ->> 'name') = lower(s.name)) k ON true
    WHERE s.organization_id = org
    ORDER BY coalesce(k.ord, n + 1), s.position, s.created_at
  LOOP
    UPDATE public.pipeline_stages SET position = i WHERE id = st.id;
    i := i + 1;
  END LOOP;

  INSERT INTO public.tags (organization_id, name, color, icon) VALUES
    (org, 'Lead quente', '#E11D48', 'flame'), (org, 'Lead morno', '#D97706', 'sun'), (org, 'Lead frio', '#2563EB', 'snowflake')
  ON CONFLICT (organization_id, name) DO NOTHING;

  SELECT rt.fields INTO defs FROM public.record_types rt WHERE rt.organization_id = org AND rt.key = 'contato';
  IF defs IS NULL THEN
    INSERT INTO public.record_types (organization_id, key, name, fields) VALUES (org, 'contato', 'Contato', want);
  ELSE
    FOR f IN SELECT value FROM jsonb_array_elements(want) LOOP
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(defs) x WHERE x ->> 'key' = f ->> 'key') THEN defs := defs || jsonb_build_array(f); END IF;
    END LOOP;
    UPDATE public.record_types SET fields = defs, updated_at = now() WHERE organization_id = org AND key = 'contato';
  END IF;

  PERFORM private.audit(org, 'funnel.installed', 'sales_funnel', jsonb_build_object('stages_added', added));
  RETURN jsonb_build_object('stages_added', added);
END $$;
REVOKE ALL ON FUNCTION private.install_sales_funnel(uuid) FROM PUBLIC, anon, authenticated;
