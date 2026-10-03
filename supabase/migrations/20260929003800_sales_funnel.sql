-- =============================================================================
-- Funil de vendas instalável (pedido em 03/10; primeiro para a Clubetec, depois
-- para qualquer empresa): etapas no Kanban, etiquetas de temperatura do lead,
-- campos do cliente (origem, segmento, equipe, maior dificuldade), bloco de fluxo
-- "Mover no funil" e relatório por etapa e por origem.
-- Idempotente.
-- =============================================================================

-- Bloco novo nos fluxos: "stage" (move a conversa para uma etapa do funil).
CREATE OR REPLACE FUNCTION public.publish_flow(flow uuid)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.flow_versions; nextv integer; bad text;
BEGIN
  SELECT * INTO d FROM public.flow_versions WHERE flow_id = flow AND status = 'draft';
  IF d.id IS NULL OR NOT private.has_permission(d.organization_id, 'org.settings') THEN
    RAISE EXCEPTION 'rascunho não encontrado' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(d.graph -> 'nodes') n WHERE n ->> 'type' = 'start') <> 1 THEN
    RAISE EXCEPTION 'o fluxo precisa de exatamente um bloco Início' USING ERRCODE = '22023';
  END IF;
  SELECT n ->> 'type' INTO bad FROM jsonb_array_elements(d.graph -> 'nodes') n
  WHERE n ->> 'type' NOT IN ('start', 'message', 'menu', 'question', 'condition', 'business_hours',
                             'ai_agent', 'tag', 'transfer', 'close',
                             'wait', 'survey', 'http', 'record', 'connector', 'stage') LIMIT 1;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'bloco desconhecido: %', bad USING ERRCODE = '22023'; END IF;
  -- Etapa do funil precisa ser desta empresa.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(d.graph -> 'nodes') n
             WHERE n ->> 'type' = 'stage' AND NOT EXISTS (
               SELECT 1 FROM public.pipeline_stages s
               WHERE s.organization_id = d.organization_id AND s.id::text = n -> 'data' ->> 'stage_id')) THEN
    RAISE EXCEPTION 'escolha a etapa do funil em todos os blocos "Mover no funil"' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(d.graph -> 'edges') e
             WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d.graph -> 'nodes') n WHERE n ->> 'id' = e ->> 'source')
                OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d.graph -> 'nodes') n WHERE n ->> 'id' = e ->> 'target')) THEN
    RAISE EXCEPTION 'há ligações para blocos que não existem' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(max(version), 0) + 1 INTO nextv FROM public.flow_versions WHERE flow_id = flow;
  UPDATE public.flow_versions SET status = 'archived' WHERE flow_id = flow AND status = 'published';
  INSERT INTO public.flow_versions (organization_id, flow_id, version, status, graph, published_at, published_by)
  VALUES (d.organization_id, flow, nextv, 'published', d.graph, now(), (SELECT auth.uid()));
  PERFORM private.audit(d.organization_id, 'flow.published', flow::text, jsonb_build_object('version', nextv));
  RETURN nextv;
END $$;
REVOKE ALL ON FUNCTION public.publish_flow(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_flow(uuid) TO authenticated;

-- Prepara a empresa para o funil: etapas que faltam, etiquetas de temperatura e campos do cliente.
CREATE OR REPLACE FUNCTION private.install_sales_funnel(org uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  st record; pos integer; added int := 0; defs jsonb; f jsonb;
  stages jsonb := '[{"name":"Novo lead","color":"#3FB8BE"},{"name":"Qualificado","color":"#6C8EF5"},
    {"name":"Diagnóstico ou demonstração","color":"#8B5CF6"},{"name":"Proposta enviada","color":"#F5A623"},
    {"name":"Teste grátis","color":"#22C1A4"},{"name":"Cliente","color":"#2EB67D"},{"name":"Perdido","color":"#94A3B8"}]';
  want jsonb := '[{"key":"origem","label":"Origem do contato","type":"text","ai_readable":true},
    {"key":"segmento","label":"Tipo de empresa","type":"text","ai_readable":true},
    {"key":"equipe","label":"Pessoas no atendimento","type":"text","ai_readable":true},
    {"key":"dor","label":"Maior dificuldade","type":"long_text","ai_readable":true}]';
BEGIN
  SELECT coalesce(max(position), -1) INTO pos FROM public.pipeline_stages WHERE organization_id = org;
  FOR st IN SELECT value FROM jsonb_array_elements(stages) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.pipeline_stages WHERE organization_id = org AND lower(name) = lower(st.value ->> 'name')) THEN
      pos := pos + 1; added := added + 1;
      INSERT INTO public.pipeline_stages (organization_id, name, color, position) VALUES (org, st.value ->> 'name', st.value ->> 'color', pos);
    END IF;
  END LOOP;

  INSERT INTO public.tags (organization_id, name, color, icon) VALUES
    (org, 'Lead quente', '#EF4444', 'flame'), (org, 'Lead morno', '#F59E0B', 'sun'), (org, 'Lead frio', '#3B82F6', 'snowflake')
  ON CONFLICT (organization_id, name) DO NOTHING;

  -- Campos do cliente (tipo reservado 'contato'): acrescenta só os que faltam.
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

-- Servidor (implementador): prepara o funil antes de montar o fluxo de qualificação.
CREATE OR REPLACE FUNCTION public.service_install_sales_funnel(org uuid)
RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$ SELECT private.install_sales_funnel(org) $$;
REVOKE ALL ON FUNCTION public.service_install_sales_funnel(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_install_sales_funnel(uuid) TO service_role;

-- Relatório do funil: conversas criadas no período por etapa atual e por origem (só números).
CREATE OR REPLACE FUNCTION public.sales_funnel_report(org uuid, since date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE won uuid;
BEGIN
  IF NOT (private.has_permission(org, 'reports.view') OR private.has_permission(org, 'org.settings')) THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO won FROM public.pipeline_stages WHERE organization_id = org AND lower(name) = 'cliente' LIMIT 1;
  RETURN jsonb_build_object(
    'stages', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'color', s.color, 'position', s.position,
        'count', (SELECT count(*) FROM public.conversations c WHERE c.organization_id = org AND c.stage_id = s.id
                  AND c.created_at >= coalesce(since, current_date - 30))) ORDER BY s.position)
      FROM public.pipeline_stages s WHERE s.organization_id = org), '[]'::jsonb),
    'origins', coalesce((
      SELECT jsonb_agg(jsonb_build_object('origem', o.origem, 'leads', o.leads, 'clientes', o.clientes) ORDER BY o.leads DESC)
      FROM (
        SELECT coalesce(nullif(ct.custom ->> 'origem', ''), 'sem origem') AS origem, count(*) AS leads,
               count(*) FILTER (WHERE won IS NOT NULL AND c.stage_id = won) AS clientes
        FROM public.conversations c LEFT JOIN public.contacts ct ON ct.id = c.contact_id
        WHERE c.organization_id = org AND c.created_at >= coalesce(since, current_date - 30)
        GROUP BY 1) o), '[]'::jsonb),
    'total', (SELECT count(*) FROM public.conversations c WHERE c.organization_id = org AND c.created_at >= coalesce(since, current_date - 30))
  );
END $$;
REVOKE ALL ON FUNCTION public.sales_funnel_report(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_funnel_report(uuid, date) TO authenticated;
