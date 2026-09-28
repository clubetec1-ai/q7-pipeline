-- =============================================================================
-- publish_flow aceita o bloco 'record' (criar/atualizar/consultar registro).
-- Idempotente.
-- =============================================================================

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
                             'wait', 'survey', 'http', 'record') LIMIT 1;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'bloco desconhecido: %', bad USING ERRCODE = '22023'; END IF;
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
