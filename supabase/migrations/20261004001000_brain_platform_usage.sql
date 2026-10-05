-- =============================================================================
-- Cérebro: painel da Clubetec (operador). Consumo por empresa no mês (análises,
-- chamadas e tokens) e a franquia de cada uma — para acompanhar custo e ajustar.
-- Só números; nada do conteúdo das análises. Idempotente.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.platform_brain_usage(since date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'org_id', o.id, 'name', o.name,
      'limits', coalesce(m.limits, '{}'::jsonb),
      'ok', (SELECT count(*) FROM public.brain_runs r WHERE r.organization_id = o.id AND r.status = 'ok' AND r.started_at >= since),
      'erro', (SELECT count(*) FROM public.brain_runs r WHERE r.organization_id = o.id AND r.status = 'erro' AND r.started_at >= since),
      'pulado', (SELECT count(*) FROM public.brain_runs r WHERE r.organization_id = o.id AND r.status = 'pulado' AND r.started_at >= since),
      'chamadas', (SELECT coalesce(sum(r.calls), 0) FROM public.brain_runs r WHERE r.organization_id = o.id AND r.started_at >= since),
      'tokens_in', (SELECT coalesce(sum(r.tokens_in), 0) FROM public.brain_runs r WHERE r.organization_id = o.id AND r.started_at >= since),
      'tokens_out', (SELECT coalesce(sum(r.tokens_out), 0) FROM public.brain_runs r WHERE r.organization_id = o.id AND r.started_at >= since),
      'ultima', (SELECT max(r.started_at) FROM public.brain_runs r WHERE r.organization_id = o.id),
      'areas', (SELECT count(*) FROM public.org_areas a WHERE a.organization_id = o.id AND a.enabled))
    ORDER BY o.name)
    FROM public.organizations o
    JOIN public.org_modules m ON m.organization_id = o.id AND m.module = 'gestao' AND m.enabled), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.platform_brain_usage(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_brain_usage(date) TO authenticated;
