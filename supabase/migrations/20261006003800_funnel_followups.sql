-- Etapa B, item 3 (funil de vendas): o funil pronto já vem com os retornos automáticos de "Proposta enviada" (2, 5 e 10
-- dias), acompanhamento do "Teste grátis" (1, 3 e 6 dias) e o pós-venda em "Cliente" (2, 7 e 30 dias: implantação,
-- pesquisa e indicação). Não muda etapa que a empresa já configurou. Empresas que já instalaram o funil ganham os
-- retornos agora (também só onde estava vazio). Idempotente.
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

  -- Retornos automáticos (Etapa B, item 3): proposta, teste grátis e pós-venda. Só onde a empresa ainda não configurou.
  UPDATE public.pipeline_stages SET followup_days = '{2,5,10}',
    followup_hint = 'Perguntar se ficou alguma dúvida na proposta e oferecer uma conversa rápida para ajustar. Sem pressão.'
  WHERE organization_id = org AND lower(name) = 'proposta enviada' AND cardinality(followup_days) = 0;
  UPDATE public.pipeline_stages SET followup_days = '{1,3,6}',
    followup_hint = 'Acompanhar o teste grátis: perguntar como está indo, oferecer ajuda para configurar o que falta e lembrar quando o teste termina. Sem pressão e sem prometer nada fora do plano.'
  WHERE organization_id = org AND lower(name) = 'teste grátis' AND cardinality(followup_days) = 0;
  UPDATE public.pipeline_stages SET followup_days = '{2,7,30}',
    followup_hint = 'Pós-venda: no primeiro retorno, perguntar se a implantação está tranquila; no segundo, pedir uma nota de 1 a 5 e um comentário; no terceiro, perguntar se conhece alguém que também ganharia com o serviço (indicação). Curto e gentil.'
  WHERE organization_id = org AND lower(name) = 'cliente' AND cardinality(followup_days) = 0;

  PERFORM private.audit(org, 'funnel.installed', 'sales_funnel', jsonb_build_object('stages_added', added));
  RETURN jsonb_build_object('stages_added', added);
END $$;
REVOKE ALL ON FUNCTION private.install_sales_funnel(uuid) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE o uuid;
BEGIN
  FOR o IN SELECT DISTINCT organization_id FROM public.pipeline_stages WHERE lower(name) IN ('proposta enviada', 'teste grátis') LOOP
    UPDATE public.pipeline_stages SET followup_days = '{2,5,10}',
      followup_hint = 'Perguntar se ficou alguma dúvida na proposta e oferecer uma conversa rápida para ajustar. Sem pressão.'
    WHERE organization_id = o AND lower(name) = 'proposta enviada' AND cardinality(followup_days) = 0;
    UPDATE public.pipeline_stages SET followup_days = '{1,3,6}',
      followup_hint = 'Acompanhar o teste grátis: perguntar como está indo, oferecer ajuda para configurar o que falta e lembrar quando o teste termina. Sem pressão e sem prometer nada fora do plano.'
    WHERE organization_id = o AND lower(name) = 'teste grátis' AND cardinality(followup_days) = 0;
    UPDATE public.pipeline_stages SET followup_days = '{2,7,30}',
      followup_hint = 'Pós-venda: no primeiro retorno, perguntar se a implantação está tranquila; no segundo, pedir uma nota de 1 a 5 e um comentário; no terceiro, perguntar se conhece alguém que também ganharia com o serviço (indicação). Curto e gentil.'
    WHERE organization_id = o AND lower(name) = 'cliente' AND cardinality(followup_days) = 0;
  END LOOP;
END $$;
