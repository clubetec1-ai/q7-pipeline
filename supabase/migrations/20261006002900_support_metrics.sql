-- Medição de chamados de suporte por empresa (desenho 07, fatia 10, §6.3): quantos pedidos de ajuda cada empresa abriu
-- nos primeiros 30 dias (a implantação) e em quais telas. A meta é o número cair a cada empresa nova — sinal de que o
-- autoatendimento guiado está funcionando. Só a equipe da plataforma vê. Sem conteúdo dos chamados (só contagens).
-- Idempotente.
CREATE OR REPLACE FUNCTION public.platform_support_metrics()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY x ->> 'desde' DESC) FROM (
    SELECT jsonb_build_object(
      'org_id', o.id, 'name', o.name, 'desde', o.created_at,
      'implantacao', (SELECT count(*) FROM public.service_requests s WHERE s.organization_id = o.id AND s.created_at < o.created_at + interval '30 days'),
      'ultimos_30', (SELECT count(*) FROM public.service_requests s WHERE s.organization_id = o.id AND s.created_at >= now() - interval '30 days'),
      'abertos', (SELECT count(*) FROM public.service_requests s WHERE s.organization_id = o.id AND s.status IN ('open', 'in_progress')),
      'pelo_assistente', (SELECT count(*) FROM public.service_requests s WHERE s.organization_id = o.id AND s.source = 'assistente'),
      'telas', coalesce((SELECT jsonb_agg(jsonb_build_object('tela', t.page, 'n', t.n) ORDER BY t.n DESC)
                         FROM (SELECT coalesce(nullif(s.page, ''), '(sem tela)') AS page, count(*) AS n FROM public.service_requests s
                               WHERE s.organization_id = o.id GROUP BY 1 ORDER BY 2 DESC LIMIT 5) t), '[]'::jsonb)) AS x
    FROM public.organizations o) q), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.platform_support_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_support_metrics() TO authenticated;
