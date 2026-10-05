-- =============================================================================
-- Cérebro, fatias 5 e 6 (docs/design/03-cerebro.md §2.5, §3): orquestrador semanal
-- e agentes de área.
--  * org_modules.limits: franquia do cérebro que SÓ o operador Clubetec grava
--    ({"analises_mes": 8, "manual_dia": 1}); o dono não consegue mudar (R1);
--  * brain_runs: cada análise (semanal/manual) com resumo, consumo e hash do pacote;
--  * service_brain_packet: o ÚNICO dado que a IA vê — agregados, metas com semáforo,
--    pendências, resultados recentes e o texto do Diagnóstico (objetivos/situação);
--    nunca conversa, nome, telefone ou e-mail;
--  * service_brain_propose: a única "escrita" dos agentes — vira proposta "sugerida"
--    em improvements (source 'cerebro'), ≤3 por área por análise, recusa se a área já
--    tem 5 pendentes, deduplica pelo título, avisa quem aprova, audita como ai_agent;
--  * cron semanal (segunda 8h de Brasília) chama a função brain com o segredo do cron.
-- Tudo service_role; o navegador só lê brain_runs (dono/admin). Idempotente.
-- =============================================================================

ALTER TABLE public.org_modules ADD COLUMN IF NOT EXISTS limits jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.platform_set_module_limits(org uuid, m text, lim jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(lim) <> 'object' OR octet_length(lim::text) > 2000 THEN RAISE EXCEPTION 'limites inválidos' USING ERRCODE = '22023'; END IF;
  UPDATE public.org_modules SET limits = lim WHERE organization_id = org AND module = m;
  IF NOT FOUND THEN RAISE EXCEPTION 'módulo não contratado' USING ERRCODE = '22023'; END IF;
  PERFORM private.audit(org, 'module.limits', m, jsonb_build_object('limits', lim));
END $$;
REVOKE ALL ON FUNCTION public.platform_set_module_limits(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_module_limits(uuid, text, jsonb) TO authenticated;

CREATE TABLE IF NOT EXISTS public.brain_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('semanal', 'manual')),
  status text NOT NULL DEFAULT 'rodando' CHECK (status IN ('rodando', 'ok', 'erro', 'pulado')),
  period_start date NOT NULL DEFAULT (date_trunc('week', now()))::date,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  packet_hash text CHECK (packet_hash IS NULL OR packet_hash ~ '^[0-9a-f]{16,64}$'),
  summary jsonb CHECK (summary IS NULL OR octet_length(summary::text) <= 30000),
  calls integer NOT NULL DEFAULT 0, tokens_in integer NOT NULL DEFAULT 0, tokens_out integer NOT NULL DEFAULT 0,
  model text CHECK (model IS NULL OR char_length(model) <= 80),
  error text CHECK (error IS NULL OR char_length(error) <= 300),
  triggered_by uuid,
  UNIQUE (id, organization_id)
);
CREATE INDEX IF NOT EXISTS brain_runs_org_idx ON public.brain_runs (organization_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS brain_runs_weekly_once ON public.brain_runs (organization_id, period_start)
  WHERE kind = 'semanal' AND status IN ('rodando', 'ok', 'pulado');
ALTER TABLE public.brain_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brain_runs FROM anon, authenticated;
GRANT SELECT ON public.brain_runs TO authenticated;
GRANT ALL ON public.brain_runs TO service_role;
DROP POLICY IF EXISTS "org: ver" ON public.brain_runs;
CREATE POLICY "org: ver" ON public.brain_runs FOR SELECT TO authenticated USING (private.has_permission(organization_id, 'org.settings'));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'improvements_brain_run_fk') THEN
    ALTER TABLE public.improvements ADD CONSTRAINT improvements_brain_run_fk FOREIGN KEY (brain_run_id, organization_id)
      REFERENCES public.brain_runs (id, organization_id) ON DELETE SET NULL (brain_run_id);
  END IF;
END $$;

-- Franquia do mês (operador define; padrão 8 análises por mês).
CREATE OR REPLACE FUNCTION private.brain_limit(org uuid, k text, fallback integer)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT (limits ->> k)::integer FROM public.org_modules WHERE organization_id = org AND module = 'gestao' AND enabled
                   AND limits ->> k ~ '^[0-9]{1,4}$'), fallback)
$$;
REVOKE ALL ON FUNCTION private.brain_limit(uuid, text, integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.brain_quota_ok(org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT count(*) FROM public.brain_runs WHERE organization_id = org AND status IN ('rodando', 'ok', 'erro')
            AND started_at >= date_trunc('month', now())) < private.brain_limit(org, 'analises_mes', 8)
$$;
REVOKE ALL ON FUNCTION private.brain_quota_ok(uuid) FROM PUBLIC, anon, authenticated;

-- Empresas para a análise semanal: ativas, com o módulo, com área ligada, sem análise na semana e com franquia.
CREATE OR REPLACE FUNCTION public.service_brain_due()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT o.id FROM public.organizations o
  WHERE o.status = 'active' AND private.module_on(o.id, 'gestao')
    AND EXISTS (SELECT 1 FROM public.org_areas a WHERE a.organization_id = o.id AND a.enabled)
    AND NOT EXISTS (SELECT 1 FROM public.brain_runs r WHERE r.organization_id = o.id AND r.kind = 'semanal'
                    AND r.period_start = (date_trunc('week', now()))::date AND r.status IN ('rodando', 'ok', 'pulado'))
    AND private.brain_quota_ok(o.id)
  ORDER BY o.created_at LIMIT 10
$$;
REVOKE ALL ON FUNCTION public.service_brain_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_brain_due() TO service_role;

-- Pode rodar a análise manual agora? (dono/admin, módulo, franquia do mês e 1 por dia)
CREATE OR REPLACE FUNCTION public.service_brain_can_run_manual(org uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN NOT private.module_on(org, 'gestao') THEN 'O módulo Qualidade e Gestão não está ativo.'
    WHEN NOT EXISTS (SELECT 1 FROM public.org_areas WHERE organization_id = org AND enabled) THEN 'Ligue pelo menos uma área em Configurações → Áreas e responsáveis.'
    WHEN NOT private.brain_quota_ok(org) THEN 'A franquia de análises do mês acabou.'
    WHEN (SELECT count(*) FROM public.brain_runs WHERE organization_id = org AND kind = 'manual' AND started_at > now() - interval '24 hours')
         >= private.brain_limit(org, 'manual_dia', 1) THEN 'Já houve uma análise manual nas últimas 24 horas.'
    WHEN EXISTS (SELECT 1 FROM public.brain_runs WHERE organization_id = org AND status = 'rodando' AND started_at > now() - interval '10 minutes')
      THEN 'Já há uma análise em andamento.'
    ELSE 'ok' END
$$;
REVOKE ALL ON FUNCTION public.service_brain_can_run_manual(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_brain_can_run_manual(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.service_brain_start_run(org uuid, p_kind text, who uuid)
RETURNS uuid LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.brain_runs (organization_id, kind, triggered_by) VALUES (org, p_kind, who) RETURNING id
$$;
REVOKE ALL ON FUNCTION public.service_brain_start_run(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_brain_start_run(uuid, text, uuid) TO service_role;

-- Hash do pacote da última análise concluída (para pular quando nada mudou).
CREATE OR REPLACE FUNCTION public.service_brain_last_hash(org uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT packet_hash FROM public.brain_runs WHERE organization_id = org AND status = 'ok' AND packet_hash IS NOT NULL
  ORDER BY started_at DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.service_brain_last_hash(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_brain_last_hash(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.service_brain_finish_run(run uuid, org uuid, p_status text, p_summary jsonb,
  p_calls integer, p_in integer, p_out integer, p_model text, p_error text, p_hash text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.brain_runs SET status = p_status, summary = p_summary, calls = coalesce(p_calls, 0), tokens_in = coalesce(p_in, 0),
    tokens_out = coalesce(p_out, 0), model = left(p_model, 80), error = left(p_error, 300), packet_hash = p_hash, finished_at = now()
  WHERE id = run AND organization_id = org;
  IF NOT FOUND THEN RAISE EXCEPTION 'execução não encontrada' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.audit_log (organization_id, actor_type, agent_key, action, target, meta)
  VALUES (org, 'ai_agent', 'cerebro', 'brain.run', run::text,
          jsonb_build_object('status', p_status, 'calls', p_calls, 'tokens_in', p_in, 'tokens_out', p_out));
  IF p_status = 'ok' THEN
    INSERT INTO public.notifications (organization_id, user_id, kind, ref)
    SELECT org, m.user_id, 'brain_weekly', jsonb_build_object('run_id', run)
    FROM public.organization_members m WHERE m.organization_id = org AND m.status = 'active' AND m.role IN ('owner', 'admin');
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.service_brain_finish_run(uuid, uuid, text, jsonb, integer, integer, integer, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_brain_finish_run(uuid, uuid, text, jsonb, integer, integer, integer, text, text, text) TO service_role;

-- O pacote que a IA lê. Só agregados e textos do Diagnóstico (que o dono escreveu).
CREATE OR REPLACE FUNCTION public.service_brain_packet(org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.company_profiles; last jsonb;
BEGIN
  SELECT * INTO p FROM public.company_profiles WHERE organization_id = org;
  SELECT summary -> 'prioridades' INTO last FROM public.brain_runs WHERE organization_id = org AND status = 'ok' ORDER BY started_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'empresa', jsonb_build_object(
      'objetivos', left(coalesce(p.sections ->> 'objetivos', ''), 1200),
      'situacao', left(coalesce(p.sections ->> 'situacao', ''), 800),
      'diagnostico', left(coalesce(p.plan ->> 'diagnostico', ''), 800),
      'objetivos_plano', coalesce((SELECT jsonb_agg(jsonb_build_object('objetivo', left(x ->> 'objetivo', 160), 'indicador', left(x ->> 'indicador', 120)))
                                   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.plan -> 'objetivos') = 'array' THEN p.plan -> 'objetivos' ELSE '[]'::jsonb END) x), '[]'::jsonb)),
    'prioridades_anteriores', coalesce(last, '[]'::jsonb),
    'areas', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'key', a.key, 'nome', a.name, 'agente_ligado', a.agent_enabled,
        'indicadores', private.area_values(a.id, now() - interval '7 days', now()),
        'semana_anterior', private.area_values(a.id, now() - interval '14 days', now() - interval '7 days'),
        'metas', coalesce((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'titulo', left(g.title, 160), 'indicador', g.metric_key,
                   'alvo', g.target, 'sentido', g.direction, 'valor', private.goal_value(g), 'semaforo', private.goal_status(g, private.goal_value(g))))
                 FROM public.area_goals g WHERE g.area_id = a.id AND g.status = 'ativa'), '[]'::jsonb),
        'pendentes', (SELECT count(*) FROM public.improvements i WHERE i.area_id = a.id AND i.status IN ('sugerida', 'aprovada')),
        'resultados_recentes', coalesce((SELECT jsonb_agg(jsonb_build_object('titulo', left(i.title, 120), 'resultado', i.result))
                 FROM (SELECT * FROM public.improvements WHERE area_id = a.id AND status = 'resultado' AND closed_at > now() - interval '60 days'
                       ORDER BY closed_at DESC LIMIT 5) i), '[]'::jsonb),
        'abertas', coalesce((SELECT jsonb_agg(left(i.title, 120)) FROM (SELECT title FROM public.improvements
                 WHERE area_id = a.id AND status IN ('sugerida', 'aprovada', 'no_ar') ORDER BY created_at DESC LIMIT 10) i), '[]'::jsonb),
        'processos', coalesce((SELECT jsonb_agg(jsonb_build_object('nome', left(x ->> 'nome', 120), 'implementar', x ->> 'implementar'))
                 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.processes) = 'array' THEN p.processes ELSE '[]'::jsonb END) x
                 WHERE lower(coalesce(x ->> 'setor', x ->> 'area', '')) = lower(a.name)), '[]'::jsonb)
      ) ORDER BY a.name) FROM public.org_areas a WHERE a.organization_id = org AND a.enabled), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.service_brain_packet(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_brain_packet(uuid) TO service_role;

-- Propostas de um agente de área (já validadas pelo servidor).
CREATE OR REPLACE FUNCTION public.service_brain_propose(org uuid, run uuid, p_area_key text, items jsonb)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.org_areas; it jsonb; n integer := 0; nid uuid; k text; goal uuid;
BEGIN
  SELECT * INTO a FROM public.org_areas WHERE organization_id = org AND key = p_area_key AND enabled ORDER BY created_at LIMIT 1;
  IF a.id IS NULL OR jsonb_typeof(items) <> 'array' THEN RETURN 0; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brain_runs WHERE id = run AND organization_id = org) THEN RETURN 0; END IF;
  -- Cobra antes de propor mais: área com 5+ pendentes não recebe novas.
  IF (SELECT count(*) FROM public.improvements WHERE area_id = a.id AND status = 'sugerida') >= 5 THEN RETURN 0; END IF;
  FOR it IN SELECT value FROM jsonb_array_elements(items) LIMIT 3 LOOP
    CONTINUE WHEN char_length(btrim(coalesce(it ->> 'titulo', ''))) < 2;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.improvements WHERE organization_id = org AND lower(title) = lower(btrim(it ->> 'titulo'))
                          AND status IN ('sugerida', 'aprovada', 'no_ar'));
    k := CASE WHEN it ->> 'tipo' IN ('processo', 'automacao', 'agente', 'integracao') THEN it ->> 'tipo' ELSE 'processo' END;
    goal := NULL;
    IF it ->> 'meta_id' ~ '^[0-9a-f-]{36}$' THEN
      SELECT id INTO goal FROM public.area_goals WHERE id = (it ->> 'meta_id')::uuid AND area_id = a.id;
    END IF;
    INSERT INTO public.improvements (organization_id, title, description, how, source, kind, modelo, department_id, status,
      area_id, goal_id, evidence, priority, agent_key, process_ref, brain_run_id, due_date)
    VALUES (org, left(btrim(it ->> 'titulo'), 160), left(it ->> 'problema', 2000), left(it ->> 'como', 4000), 'cerebro', k,
      CASE WHEN it ->> 'modelo' ~ '^[a-z_]{2,30}$' THEN it ->> 'modelo' END, a.department_id, 'sugerida',
      a.id, goal, CASE WHEN jsonb_typeof(it -> 'evidencias') = 'array' THEN it -> 'evidencias' END,
      CASE WHEN (it ->> 'prioridade') ~ '^[1-5]$' THEN (it ->> 'prioridade')::smallint END,
      'area:' || a.key, left(it ->> 'processo', 120), run,
      CASE WHEN (it ->> 'prazo_dias') ~ '^[0-9]{1,2}$' AND (it ->> 'prazo_dias')::int BETWEEN 1 AND 60 THEN current_date + (it ->> 'prazo_dias')::int END)
    RETURNING id INTO nid;
    INSERT INTO public.audit_log (organization_id, actor_type, agent_key, action, target, meta)
    VALUES (org, 'ai_agent', 'area:' || a.key, 'brain.proposed', nid::text, jsonb_build_object('area', a.name, 'run', run));
    PERFORM private.notify_improvement((SELECT x FROM public.improvements x WHERE x.id = nid));
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.service_brain_propose(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_brain_propose(uuid, uuid, text, jsonb) TO service_role;

-- Cron semanal: chama a função brain (que pega as empresas devidas).
CREATE OR REPLACE FUNCTION private.brain_weekly_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.service_brain_due()) THEN RETURN; END IF;
  SELECT value INTO base FROM public.app_settings WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'platform:cron_secret';
  IF coalesce(base, '') = '' OR secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := base || '/brain',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{"action":"weekly"}'::jsonb, timeout_milliseconds := 150000);
END $$;
REVOKE ALL ON FUNCTION private.brain_weekly_tick() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'brain-weekly') THEN PERFORM cron.unschedule('brain-weekly'); END IF;
    -- Segunda 11h UTC (8h em Brasília) e, se sobrar empresa (10 por vez), de hora em hora na segunda.
    PERFORM cron.schedule('brain-weekly', '0 11-20 * * 1', 'SELECT private.brain_weekly_tick()');
  END IF;
END $$;
