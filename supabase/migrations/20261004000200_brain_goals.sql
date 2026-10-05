-- =============================================================================
-- Cérebro, fatia 2 (docs/design/03-cerebro.md §2.2 e §2.6): metas e números por área.
--  * catálogo FECHADO de indicadores, calculado em SQL (a IA nunca produz número);
--  * area_goals: meta por área (dono define; o cérebro só poderá propor);
--  * area_metric_snapshots: foto semanal (série histórica; gravada pelo backend);
--  * goal_status: semáforo no banco (no_rumo / atencao / fora / sem_dados);
--  * brain_overview: painel por área (dono vê todas; responsável só as suas).
-- Só agregados: nada de nome, telefone ou conteúdo de conversa. RH nunca por pessoa.
-- Idempotente.
-- =============================================================================

-- Indicadores de cada tipo de área (a ordem é a da tela).
CREATE OR REPLACE FUNCTION private.area_metric_keys(area_key text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE area_key
    WHEN 'vendas' THEN ARRAY['leads_novos', 'clientes_novos', 'conversao_pct', 'leads_sem_origem_pct']
    WHEN 'financeiro' THEN ARRAY['valor_emitido', 'valor_recebido', 'valor_em_atraso', 'cobrancas_em_atraso']
    WHEN 'marketing' THEN ARRAY['novos_contatos', 'campanha_enviados', 'leads_sem_origem_pct', 'fora_da_lista']
    WHEN 'operacao' THEN ARRAY['fluxo_execucoes', 'fluxo_concluidas_pct', 'fluxo_erros', 'numeros_com_problema']
    WHEN 'administrativo' THEN ARRAY['registros_criados', 'processos_implantados', 'melhorias_paradas']
    WHEN 'rh' THEN ARRAY['equipe_ativa', 'nota_media_equipe', 'atendimentos_por_pessoa_media']
    ELSE ARRAY['atendimentos', 'fila_min', 'resposta_min', 'satisfeitos_pct', 'nota_media', 'resolvidos_ia_pct', 'fila_30min']
  END
$$;

-- Valores de TODOS os indicadores num período (setor opcional para os de atendimento e vendas).
CREATE OR REPLACE FUNCTION private.area_metric_values(org uuid, dept uuid, since timestamptz, until timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH t AS (
    SELECT * FROM public.tickets WHERE organization_id = org AND created_at >= since AND created_at < until
      AND (dept IS NULL OR department_id = dept)),
  c AS (
    SELECT cv.*, ct.custom ->> 'origem' AS origem FROM public.conversations cv
    LEFT JOIN public.contacts ct ON ct.id = cv.contact_id
    WHERE cv.organization_id = org AND cv.created_at >= since AND cv.created_at < until AND coalesce(cv.channel, 'whatsapp') <> 'email'
      AND (dept IS NULL OR cv.department_id = dept)),
  won AS (SELECT id FROM public.pipeline_stages WHERE organization_id = org AND lower(name) = 'cliente' LIMIT 1),
  r AS (
    SELECT * FROM public.ticket_reviews WHERE organization_id = org AND status = 'done' AND reviewed_at >= since AND reviewed_at < until
      AND (dept IS NULL OR department_id = dept)),
  fr AS (SELECT * FROM public.flow_runs WHERE organization_id = org AND started_at >= since AND started_at < until)
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'atendimentos', (SELECT count(*) FROM t),
    'fila_min', (SELECT round(avg(extract(epoch FROM (opened_at - queued_at)) / 60)::numeric, 1) FROM t WHERE queued_at IS NOT NULL AND opened_at IS NOT NULL),
    'resposta_min', (SELECT round(avg(extract(epoch FROM (first_response_at - opened_at)) / 60)::numeric, 1) FROM t WHERE first_response_at IS NOT NULL AND opened_at IS NOT NULL),
    'satisfeitos_pct', (SELECT round(100.0 * count(*) FILTER (WHERE satisfied = 'sim') / nullif(count(*), 0)) FROM r),
    'nota_media', (SELECT round(avg(score)::numeric, 1) FROM r),
    'resolvidos_ia_pct', (SELECT round(100.0 * count(*) FILTER (WHERE assigned_to IS NULL AND NOT coalesce(external_reply, false)) / nullif(count(*), 0)) FROM t WHERE status = 'closed'),
    'fila_30min', (SELECT count(*) FROM public.tickets WHERE organization_id = org AND status = 'queued' AND queued_at < now() - interval '30 minutes'
                     AND (dept IS NULL OR department_id = dept)),
    'leads_novos', (SELECT count(*) FROM c),
    'clientes_novos', (SELECT count(*) FROM c WHERE stage_id = (SELECT id FROM won)),
    'conversao_pct', (SELECT round(100.0 * count(*) FILTER (WHERE stage_id = (SELECT id FROM won)) / nullif(count(*), 0)) FROM c),
    'leads_sem_origem_pct', (SELECT round(100.0 * count(*) FILTER (WHERE coalesce(origem, '') = '') / nullif(count(*), 0)) FROM c),
    'valor_emitido', (SELECT coalesce(sum(value), 0) FROM public.charges WHERE organization_id = org AND created_at >= since AND created_at < until),
    'valor_recebido', (SELECT coalesce(sum(value), 0) FROM public.charges WHERE organization_id = org AND paid_at >= since AND paid_at < until),
    'valor_em_atraso', (SELECT coalesce(sum(value), 0) FROM public.charges WHERE organization_id = org AND status = 'overdue'),
    'cobrancas_em_atraso', (SELECT count(*) FROM public.charges WHERE organization_id = org AND status = 'overdue'),
    'novos_contatos', (SELECT count(*) FROM public.contacts WHERE organization_id = org AND created_at >= since AND created_at < until),
    'campanha_enviados', (SELECT count(*) FROM public.campaign_recipients WHERE organization_id = org AND status = 'sent' AND sent_at >= since AND sent_at < until),
    'fora_da_lista', (SELECT count(*) FROM public.contacts WHERE organization_id = org AND opted_out_at >= since AND opted_out_at < until),
    'fluxo_execucoes', (SELECT count(*) FROM fr),
    'fluxo_concluidas_pct', (SELECT round(100.0 * count(*) FILTER (WHERE finished_at IS NOT NULL) / nullif(count(*), 0)) FROM fr),
    'fluxo_erros', (SELECT count(*) FROM fr WHERE error IS NOT NULL),
    'numeros_com_problema', (SELECT count(*) FROM public.whatsapp_instances WHERE organization_id = org AND health_status IN ('warning', 'critical')),
    'registros_criados', (SELECT count(*) FROM public.records WHERE organization_id = org AND created_at >= since AND created_at < until),
    'processos_implantados', (SELECT count(*) FROM public.company_profiles p, jsonb_array_elements(coalesce(p.processes, '[]'::jsonb)) x
                               WHERE p.organization_id = org AND x ->> 'implementar' = 'agora'),
    'melhorias_paradas', (SELECT count(*) FROM public.improvements WHERE organization_id = org
                           AND ((status = 'sugerida' AND created_at < now() - interval '3 days')
                             OR (status = 'aprovada' AND approved_at < now() - interval '7 days'))),
    'equipe_ativa', (SELECT count(*) FROM public.organization_members WHERE organization_id = org AND status = 'active'),
    'nota_media_equipe', (SELECT round(avg(score)::numeric, 1) FROM r),
    'atendimentos_por_pessoa_media', (SELECT round(count(*)::numeric / nullif(count(DISTINCT assigned_to), 0), 1) FROM t WHERE assigned_to IS NOT NULL)))
$$;
REVOKE ALL ON FUNCTION private.area_metric_values(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

-- Valores de uma área (só os indicadores dela; setor ligado filtra atendimento e vendas).
CREATE OR REPLACE FUNCTION private.area_values(area uuid, since timestamptz, until timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT jsonb_object_agg(k, v.value) FROM jsonb_each(private.area_metric_values(a.organization_id,
            CASE WHEN a.key IN ('atendimento', 'vendas', 'pos_venda', 'outra', 'operacao') THEN a.department_id END, since, until)) v
          JOIN unnest(private.area_metric_keys(a.key)) k ON k = v.key), '{}'::jsonb)
  FROM public.org_areas a WHERE a.id = area
$$;
REVOKE ALL ON FUNCTION private.area_values(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.area_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  area_id uuid NOT NULL,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 160),
  metric_key text NOT NULL CHECK (metric_key ~ '^[a-z_]{2,40}$'),
  direction text NOT NULL CHECK (direction IN ('up', 'down')),
  target numeric NOT NULL,
  baseline numeric,
  period text NOT NULL DEFAULT 'semana' CHECK (period IN ('semana', 'mes')),
  starts_on date NOT NULL DEFAULT current_date,
  ends_on date,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('plano', 'manual', 'cerebro')),
  status text NOT NULL DEFAULT 'ativa' CHECK (status IN ('proposta', 'ativa', 'atingida', 'encerrada')),
  alerted_at timestamptz,
  created_by uuid, approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  CONSTRAINT area_goals_area_fk FOREIGN KEY (area_id, organization_id) REFERENCES public.org_areas (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS area_goals_area_idx ON public.area_goals (area_id, status);
ALTER TABLE public.area_goals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.area_goals FROM anon, authenticated;
GRANT SELECT ON public.area_goals TO authenticated;
GRANT ALL ON public.area_goals TO service_role;
DROP POLICY IF EXISTS "org: ver" ON public.area_goals;
CREATE POLICY "org: ver" ON public.area_goals FOR SELECT TO authenticated
  USING (private.has_permission(organization_id, 'org.settings') OR private.is_area_approver(area_id));

CREATE TABLE IF NOT EXISTS public.area_metric_snapshots (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  area_id uuid NOT NULL,
  metric_key text NOT NULL,
  period_start date NOT NULL,
  value numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, area_id, metric_key, period_start),
  CONSTRAINT area_snapshots_area_fk FOREIGN KEY (area_id, organization_id) REFERENCES public.org_areas (id, organization_id) ON DELETE CASCADE
);
ALTER TABLE public.area_metric_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.area_metric_snapshots FROM anon, authenticated;
GRANT SELECT ON public.area_metric_snapshots TO authenticated;
GRANT ALL ON public.area_metric_snapshots TO service_role;
DROP POLICY IF EXISTS "org: ver" ON public.area_metric_snapshots;
CREATE POLICY "org: ver" ON public.area_metric_snapshots FOR SELECT TO authenticated
  USING (private.has_permission(organization_id, 'org.settings') OR private.is_area_approver(area_id));

-- Foto da semana anterior de todas as áreas ligadas de uma empresa (backend/cron).
CREATE OR REPLACE FUNCTION private.snapshot_area_metrics(org uuid)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a record; ws date := (date_trunc('week', now()) - interval '7 days')::date; n integer := 0; c integer;
BEGIN
  FOR a IN SELECT id FROM public.org_areas WHERE organization_id = org AND enabled LOOP
    INSERT INTO public.area_metric_snapshots (organization_id, area_id, metric_key, period_start, value)
    SELECT org, a.id, v.key, ws, (v.value #>> '{}')::numeric
    FROM jsonb_each(private.area_values(a.id, ws, ws + 7)) v
    ON CONFLICT (organization_id, area_id, metric_key, period_start) DO UPDATE SET value = EXCLUDED.value;
    GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION private.snapshot_area_metrics(uuid) FROM PUBLIC, anon, authenticated;

-- Valor atual da meta (últimos 7 ou 30 dias) e semáforo, sempre calculados no banco.
CREATE OR REPLACE FUNCTION private.goal_value(g public.area_goals)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (private.area_values(g.area_id, now() - CASE g.period WHEN 'mes' THEN interval '30 days' ELSE interval '7 days' END, now())
          ->> g.metric_key)::numeric
$$;
REVOKE ALL ON FUNCTION private.goal_value(public.area_goals) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.goal_status(g public.area_goals, v numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN v IS NULL THEN 'sem_dados'
    WHEN g.direction = 'up' AND v >= g.target THEN 'no_rumo'
    WHEN g.direction = 'up' AND v >= g.target * 0.8 THEN 'atencao'
    WHEN g.direction = 'down' AND v <= g.target THEN 'no_rumo'
    WHEN g.direction = 'down' AND v <= g.target * 1.2 THEN 'atencao'
    ELSE 'fora' END
$$;

-- Criar/editar meta (dono/admin). metric_key tem que ser do catálogo da área.
CREATE OR REPLACE FUNCTION public.save_area_goal(org uuid, goal uuid, area uuid, p_title text, p_metric text,
  p_direction text, p_target numeric, p_period text, p_ends date)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.org_areas; nid uuid; base numeric;
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM public.org_areas WHERE id = area AND organization_id = org;
  IF a.id IS NULL THEN RAISE EXCEPTION 'área não encontrada' USING ERRCODE = '22023'; END IF;
  IF NOT (p_metric = ANY (private.area_metric_keys(a.key))) THEN RAISE EXCEPTION 'indicador não pertence a esta área' USING ERRCODE = '22023'; END IF;
  IF p_target IS NULL THEN RAISE EXCEPTION 'informe a meta' USING ERRCODE = '22023'; END IF;
  base := (private.area_values(area, now() - CASE p_period WHEN 'mes' THEN interval '30 days' ELSE interval '7 days' END, now()) ->> p_metric)::numeric;
  IF goal IS NULL THEN
    INSERT INTO public.area_goals (organization_id, area_id, title, metric_key, direction, target, baseline, period, ends_on, source, status, created_by, approved_by)
    VALUES (org, area, btrim(p_title), p_metric, p_direction, p_target, base, coalesce(p_period, 'semana'), p_ends, 'manual', 'ativa', auth.uid(), auth.uid())
    RETURNING id INTO nid;
  ELSE
    UPDATE public.area_goals SET area_id = area, title = btrim(p_title), metric_key = p_metric, direction = p_direction, target = p_target,
      period = coalesce(p_period, 'semana'), ends_on = p_ends, updated_at = now()
    WHERE id = goal AND organization_id = org RETURNING id INTO nid;
    IF nid IS NULL THEN RAISE EXCEPTION 'meta não encontrada' USING ERRCODE = '42501'; END IF;
  END IF;
  PERFORM private.audit(org, 'goal.saved', nid::text, jsonb_build_object('title', btrim(p_title), 'metric', p_metric, 'target', p_target));
  RETURN nid;
END $$;
REVOKE ALL ON FUNCTION public.save_area_goal(uuid, uuid, uuid, text, text, text, numeric, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_area_goal(uuid, uuid, uuid, text, text, text, numeric, text, date) TO authenticated;

-- Aprovar meta proposta (pelo cérebro) ou encerrar (dono/admin).
CREATE OR REPLACE FUNCTION public.set_area_goal_status(goal uuid, new_status text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE g public.area_goals;
BEGIN
  SELECT * INTO g FROM public.area_goals WHERE id = goal FOR UPDATE;
  IF g.id IS NULL OR NOT private.has_permission(g.organization_id, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF new_status NOT IN ('ativa', 'atingida', 'encerrada') THEN RAISE EXCEPTION 'situação inválida' USING ERRCODE = '22023'; END IF;
  UPDATE public.area_goals SET status = new_status, approved_by = CASE WHEN new_status = 'ativa' THEN auth.uid() ELSE approved_by END, updated_at = now()
  WHERE id = goal;
  PERFORM private.audit(g.organization_id, 'goal.' || new_status, goal::text, jsonb_build_object('title', g.title));
END $$;
REVOKE ALL ON FUNCTION public.set_area_goal_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_area_goal_status(uuid, text) TO authenticated;

-- Painel do cérebro por área: dono vê todas as áreas ligadas; responsável só as suas.
CREATE OR REPLACE FUNCTION public.brain_overview(org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE owner boolean := private.has_permission(org, 'org.settings'); res jsonb;
BEGIN
  IF NOT owner AND NOT EXISTS (SELECT 1 FROM public.org_areas a WHERE a.organization_id = org AND private.is_area_approver(a.id)) THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id, 'key', a.key, 'name', a.name, 'approver_id', a.approver_id, 'approval_mode', a.approval_mode,
    'metrics', private.area_values(a.id, now() - interval '7 days', now()),
    'previous', private.area_values(a.id, now() - interval '14 days', now() - interval '7 days'),
    'goals', coalesce((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'title', g.title, 'metric_key', g.metric_key, 'direction', g.direction,
                'target', g.target, 'baseline', g.baseline, 'period', g.period, 'status', g.status,
                'value', private.goal_value(g), 'light', private.goal_status(g, private.goal_value(g))) ORDER BY g.created_at)
              FROM public.area_goals g WHERE g.area_id = a.id AND g.status IN ('proposta', 'ativa')), '[]'::jsonb),
    'pending', jsonb_build_object(
      'sugeridas', (SELECT count(*) FROM public.improvements i WHERE i.area_id = a.id AND i.status = 'sugerida'),
      'aprovadas', (SELECT count(*) FROM public.improvements i WHERE i.area_id = a.id AND i.status = 'aprovada'),
      'no_ar', (SELECT count(*) FROM public.improvements i WHERE i.area_id = a.id AND i.status = 'no_ar'))
  ) ORDER BY a.name), '[]'::jsonb) INTO res
  FROM public.org_areas a
  WHERE a.organization_id = org AND a.enabled AND (owner OR private.is_area_approver(a.id));
  RETURN jsonb_build_object('scope', CASE WHEN owner THEN 'dono' ELSE 'responsavel' END, 'areas', res);
END $$;
REVOKE ALL ON FUNCTION public.brain_overview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brain_overview(uuid) TO authenticated;
