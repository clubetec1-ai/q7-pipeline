-- =============================================================================
-- Correções da revisão de segurança e qualidade (04/10) — funil, cérebro e melhorias.
--  1. Retorno por etapa: mensagem humana também recomeça a contagem (não "atropela"
--     quem acabou de falar com o cliente).
--  2. Aprovação: a restrição de tipo (processo/automação) vale só para o responsável da
--     área; o supervisor do setor volta a aprovar como antes, MAS respeita o modo "só o
--     dono" da área da proposta.
--  3. Avisos/cobranças: área no modo "só o dono" avisa o dono desde a primeira vez.
--  4. Correção criada pelo monitor herda área, meta, processo e agente da original.
--  5. Análises do cérebro: execução presa em "rodando" vira erro após 10 min; só uma
--     em andamento por empresa (índice); a checagem do limite manual e a abertura são
--     atômicas; franquia conta só análises que chamaram a IA; empresa com erro recente
--     não é retentada na mesma hora; vez de quem tentou há mais tempo.
--  6. Áreas e metas exigem o módulo "Qualidade e Gestão" (gatilho).
--  7. Cobrança diária: falha numa empresa não derruba as outras.
--  8. Pacote do cérebro sem títulos vindos de avaliações de conversas e com o id da área.
--  9. Histórico por área e painel mais leves.
-- Idempotente.
-- =============================================================================

-- 1. Retorno por etapa: cliente OU pessoa da equipe falou → recomeça a contagem.
CREATE OR REPLACE FUNCTION private.on_inbound_restart_stage_followups()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (NEW.direction = 'inbound' OR NEW.sender = 'human') AND EXISTS (
    SELECT 1 FROM public.followups WHERE conversation_id = NEW.conversation_id AND kind = 'auto_stage' AND status = 'pending') THEN
    PERFORM private.schedule_stage_followups(NEW.conversation_id, now());
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS messages_inbound_stage_followups ON public.messages;
CREATE TRIGGER messages_inbound_stage_followups AFTER INSERT ON public.messages
  FOR EACH ROW WHEN (NEW.direction = 'inbound' OR NEW.sender = 'human') EXECUTE FUNCTION private.on_inbound_restart_stage_followups();

-- 2. Quem aprova.
CREATE OR REPLACE FUNCTION private.can_approve_improvement(i public.improvements)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.has_permission(i.organization_id, 'org.settings')
      -- Responsável da área: só processo/automação e só no modo "responsavel".
      OR (i.kind IN ('processo', 'automacao') AND i.area_id IS NOT NULL AND private.is_area_approver(i.area_id)
          AND EXISTS (SELECT 1 FROM public.org_areas a WHERE a.id = i.area_id AND a.approval_mode = 'responsavel'))
      -- Supervisor do setor (regra antiga), salvo se a área da proposta está em "só o dono".
      OR (i.department_id IS NOT NULL AND private.has_permission(i.organization_id, 'reports.view')
          AND private.in_department(i.department_id)
          AND NOT EXISTS (SELECT 1 FROM public.org_areas a WHERE a.id = i.area_id AND a.approval_mode = 'dono'))
$$;
REVOKE ALL ON FUNCTION private.can_approve_improvement(public.improvements) FROM PUBLIC, anon, authenticated;

-- 3. Avisos: responsável da área só no modo "responsavel".
CREATE OR REPLACE FUNCTION private.notify_improvement(i public.improvements)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.notifications (organization_id, user_id, kind, ref)
  SELECT DISTINCT i.organization_id, m.user_id, 'improvement',
         jsonb_build_object('improvement_id', i.id, 'title', left(i.title, 120), 'source', i.source)
  FROM public.organization_members m
  WHERE m.organization_id = i.organization_id AND m.status = 'active'
    AND (m.role IN ('owner', 'admin')
         OR (m.role = 'supervisor' AND i.department_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.department_members dm WHERE dm.department_id = i.department_id AND dm.user_id = m.user_id))
         OR (i.area_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.org_areas a WHERE a.id = i.area_id AND a.enabled AND a.approval_mode = 'responsavel'
                 AND m.user_id IN (a.approver_id, a.backup_approver_id))))
$$;
REVOKE ALL ON FUNCTION private.notify_improvement(public.improvements) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.brain_recipients(org uuid, area uuid, escalate boolean)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH a AS (SELECT * FROM public.org_areas WHERE id = area AND organization_id = org AND enabled),
  to_area AS (SELECT NOT escalate AND EXISTS (SELECT 1 FROM a WHERE a.approval_mode = 'responsavel' AND a.approver_id IS NOT NULL) AS yes)
  SELECT m.user_id FROM public.organization_members m, to_area
  WHERE m.organization_id = org AND m.status = 'active'
    AND ((NOT to_area.yes AND m.role IN ('owner', 'admin'))
      OR (to_area.yes AND EXISTS (SELECT 1 FROM a WHERE m.user_id IN (a.approver_id, a.backup_approver_id))))
$$;
REVOKE ALL ON FUNCTION private.brain_recipients(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- 4. Correção do monitor (e qualquer nova versão) herda área, meta, processo e agente.
CREATE OR REPLACE FUNCTION private.improvement_inherit_parent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.improvements;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT * INTO p FROM public.improvements WHERE id = NEW.parent_id AND organization_id = NEW.organization_id;
    IF p.id IS NOT NULL THEN
      NEW.area_id := coalesce(NEW.area_id, p.area_id);
      NEW.goal_id := coalesce(NEW.goal_id, p.goal_id);
      NEW.process_ref := coalesce(NEW.process_ref, p.process_ref);
      NEW.agent_key := coalesce(NEW.agent_key, p.agent_key);
      NEW.priority := coalesce(NEW.priority, p.priority);
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS improvements_inherit_parent ON public.improvements;
CREATE TRIGGER improvements_inherit_parent BEFORE INSERT ON public.improvements
  FOR EACH ROW EXECUTE FUNCTION private.improvement_inherit_parent();

-- 5. Análises do cérebro.
CREATE OR REPLACE FUNCTION private.brain_sweep_stuck()
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.brain_runs SET status = 'erro', error = 'tempo esgotado', finished_at = now()
  WHERE status = 'rodando' AND started_at < now() - interval '10 minutes'
$$;
REVOKE ALL ON FUNCTION private.brain_sweep_stuck() FROM PUBLIC, anon, authenticated;
SELECT private.brain_sweep_stuck();
CREATE UNIQUE INDEX IF NOT EXISTS brain_runs_one_running ON public.brain_runs (organization_id) WHERE status = 'rodando';

CREATE OR REPLACE FUNCTION private.brain_quota_ok(org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT count(*) FROM public.brain_runs WHERE organization_id = org
            AND (status IN ('rodando', 'ok') OR (status = 'erro' AND calls > 0))
            AND started_at >= date_trunc('month', now())) < private.brain_limit(org, 'analises_mes', 8)
$$;
REVOKE ALL ON FUNCTION private.brain_quota_ok(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.service_brain_due()
RETURNS SETOF uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.brain_sweep_stuck();
  RETURN QUERY
  SELECT o.id FROM public.organizations o
  WHERE o.status = 'active' AND private.module_on(o.id, 'gestao')
    AND EXISTS (SELECT 1 FROM public.org_areas a WHERE a.organization_id = o.id AND a.enabled)
    AND NOT EXISTS (SELECT 1 FROM public.brain_runs r WHERE r.organization_id = o.id AND r.kind = 'semanal'
                    AND r.period_start = (date_trunc('week', now()))::date AND r.status IN ('rodando', 'ok', 'pulado'))
    AND NOT EXISTS (SELECT 1 FROM public.brain_runs r WHERE r.organization_id = o.id AND r.status = 'erro'
                    AND r.started_at > now() - interval '6 hours')
    AND private.brain_quota_ok(o.id)
  ORDER BY (SELECT max(r.started_at) FROM public.brain_runs r WHERE r.organization_id = o.id) NULLS FIRST, o.created_at
  LIMIT 10;
END $$;
REVOKE ALL ON FUNCTION public.service_brain_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_brain_due() TO service_role;

-- Abre a análise com trava por empresa: a checagem do manual e o INSERT são atômicos.
CREATE OR REPLACE FUNCTION public.service_brain_start_run(org uuid, p_kind text, who uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE nid uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('brain:' || org::text));
  PERFORM private.brain_sweep_stuck();
  IF p_kind = 'manual' AND public.service_brain_can_run_manual(org) <> 'ok' THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.brain_runs WHERE organization_id = org AND status = 'rodando') THEN RETURN NULL; END IF;
  INSERT INTO public.brain_runs (organization_id, kind, triggered_by) VALUES (org, p_kind, who) RETURNING id INTO nid;
  RETURN nid;
EXCEPTION WHEN unique_violation THEN RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.service_brain_start_run(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_brain_start_run(uuid, text, uuid) TO service_role;

-- 6. Áreas e metas só com o módulo "Qualidade e Gestão".
CREATE OR REPLACE FUNCTION private.require_gestao_row()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.module_on(NEW.organization_id, 'gestao') THEN
    RAISE EXCEPTION 'o módulo Qualidade e Gestão não está ativo para esta empresa' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS org_areas_require_gestao ON public.org_areas;
CREATE TRIGGER org_areas_require_gestao BEFORE INSERT OR UPDATE ON public.org_areas
  FOR EACH ROW EXECUTE FUNCTION private.require_gestao_row();
DROP TRIGGER IF EXISTS area_goals_require_gestao ON public.area_goals;
CREATE TRIGGER area_goals_require_gestao BEFORE INSERT ON public.area_goals
  FOR EACH ROW EXECUTE FUNCTION private.require_gestao_row();

-- 7. Cobrança diária isolada por empresa.
CREATE OR REPLACE FUNCTION private.brain_daily_tick()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE o record; g public.area_goals; i public.improvements; v numeric; light text; esc boolean; n integer := 0;
BEGIN
  PERFORM private.brain_sweep_stuck();
  FOR o IN SELECT DISTINCT a.organization_id AS id FROM public.org_areas a
           JOIN public.organizations x ON x.id = a.organization_id AND x.status = 'active'
           WHERE a.enabled AND private.module_on(a.organization_id, 'gestao') LOOP
    BEGIN
      IF extract(isodow FROM now()) = 1 THEN PERFORM private.snapshot_area_metrics(o.id); END IF;

      FOR g IN SELECT * FROM public.area_goals WHERE organization_id = o.id AND status = 'ativa'
               AND (alerted_at IS NULL OR alerted_at < now() - interval '7 days') LOOP
        v := private.goal_value(g);
        light := private.goal_status(g, v);
        IF light = 'fora' THEN
          INSERT INTO public.notifications (organization_id, user_id, kind, ref)
          SELECT o.id, r, 'brain_goal', jsonb_build_object('goal_id', g.id, 'title', left(g.title, 120), 'area_id', g.area_id)
          FROM private.brain_recipients(o.id, g.area_id, false) r;
          UPDATE public.area_goals SET alerted_at = now() WHERE id = g.id;
          n := n + 1;
        END IF;
      END LOOP;

      FOR i IN SELECT * FROM public.improvements WHERE organization_id = o.id
               AND status IN ('sugerida', 'aprovada')
               AND ((status = 'sugerida' AND created_at < now() - interval '3 days')
                 OR (status = 'aprovada' AND approved_at < now() - interval '7 days')
                 OR (due_date IS NOT NULL AND due_date < current_date))
               AND (reminded_at IS NULL OR reminded_at < now() - interval '3 days') LOOP
        esc := i.reminders >= 2;
        INSERT INTO public.notifications (organization_id, user_id, kind, ref)
        SELECT o.id, r, 'brain_reminder', jsonb_build_object('improvement_id', i.id, 'title', left(i.title, 120), 'status', i.status,
               'escalado', esc, 'area_id', i.area_id)
        FROM private.brain_recipients(o.id, i.area_id, esc) r;
        UPDATE public.improvements SET reminders = least(reminders + 1, 100), reminded_at = now() WHERE id = i.id;
        PERFORM private.audit(o.id, CASE WHEN esc THEN 'brain.escalated' ELSE 'brain.reminder' END, i.id::text,
          jsonb_build_object('title', i.title, 'reminders', i.reminders + 1));
        n := n + 1;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'brain_daily_tick: empresa % falhou: %', o.id, SQLERRM;
    END;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION private.brain_daily_tick() FROM PUBLIC, anon, authenticated;

-- 8. Pacote: id da área; sem títulos de melhorias vindas de avaliações de conversas.
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
        'id', a.id, 'key', a.key, 'nome', a.name, 'agente_ligado', a.agent_enabled,
        'indicadores', private.area_values(a.id, now() - interval '7 days', now()),
        'semana_anterior', private.area_values(a.id, now() - interval '14 days', now() - interval '7 days'),
        'metas', coalesce((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'titulo', left(g.title, 160), 'indicador', g.metric_key,
                   'alvo', g.target, 'sentido', g.direction, 'valor', gv.v, 'semaforo', private.goal_status(g, gv.v)))
                 FROM public.area_goals g, LATERAL (SELECT private.goal_value(g) AS v) gv WHERE g.area_id = a.id AND g.status = 'ativa'), '[]'::jsonb),
        'pendentes', (SELECT count(*) FROM public.improvements i WHERE i.area_id = a.id AND i.status IN ('sugerida', 'aprovada')),
        'resultados_recentes', coalesce((SELECT jsonb_agg(jsonb_build_object('titulo', left(i.title, 120), 'resultado', i.result))
                 FROM (SELECT * FROM public.improvements WHERE area_id = a.id AND status = 'resultado' AND source <> 'avaliacoes'
                       AND closed_at > now() - interval '60 days' ORDER BY closed_at DESC LIMIT 5) i), '[]'::jsonb),
        'abertas', coalesce((SELECT jsonb_agg(left(i.title, 120)) FROM (SELECT title FROM public.improvements
                 WHERE area_id = a.id AND status IN ('sugerida', 'aprovada', 'no_ar') AND source <> 'avaliacoes'
                 ORDER BY created_at DESC LIMIT 10) i), '[]'::jsonb),
        'processos', coalesce((SELECT jsonb_agg(jsonb_build_object('nome', left(x ->> 'nome', 120), 'implementar', x ->> 'implementar'))
                 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.processes) = 'array' THEN p.processes ELSE '[]'::jsonb END) x
                 WHERE lower(coalesce(x ->> 'setor', x ->> 'area', '')) = lower(a.name)), '[]'::jsonb)
      ) ORDER BY a.name) FROM public.org_areas a WHERE a.organization_id = org AND a.enabled), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.service_brain_packet(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_brain_packet(uuid) TO service_role;

-- Propostas pela área exata (id), não pelo tipo (duas áreas podem ter o mesmo tipo).
CREATE OR REPLACE FUNCTION public.service_brain_propose_area(org uuid, run uuid, area uuid, items jsonb)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.org_areas; it jsonb; n integer := 0; nid uuid; k text; goal uuid;
BEGIN
  SELECT * INTO a FROM public.org_areas WHERE id = area AND organization_id = org AND enabled;
  IF a.id IS NULL OR jsonb_typeof(items) <> 'array' THEN RETURN 0; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brain_runs WHERE id = run AND organization_id = org) THEN RETURN 0; END IF;
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
REVOKE ALL ON FUNCTION public.service_brain_propose_area(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_brain_propose_area(uuid, uuid, uuid, jsonb) TO service_role;
-- A versão por tipo de área deixa de existir (pode cair na área errada).
DROP FUNCTION IF EXISTS public.service_brain_propose(uuid, uuid, text, jsonb);

-- 9. Histórico: filtra a auditoria primeiro (org, data, ação) e liga por uuid.
CREATE OR REPLACE FUNCTION public.area_activity(org uuid, area uuid, since timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.org_areas a WHERE a.id = area AND a.organization_id = org) THEN
    RAISE EXCEPTION 'área não encontrada' USING ERRCODE = '42501';
  END IF;
  IF NOT (private.has_permission(org, 'org.settings') OR private.is_area_approver(area)) THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY (x ->> 'at') DESC) FROM (
    SELECT jsonb_build_object(
      'action', l.action, 'at', l.created_at,
      'title', left(coalesce(i.title, g.title, a.name, ''), 160),
      'who', CASE WHEN l.actor_type = 'ai_agent' THEN 'Cérebro' WHEN l.actor_type = 'system' THEN 'Sistema'
                  ELSE coalesce(nullif(m.display_name, ''), 'Equipe') END) AS x
    FROM (SELECT * FROM public.audit_log
          WHERE organization_id = org AND created_at >= coalesce(since, now() - interval '60 days')
            AND (action LIKE 'improvement.%' OR action LIKE 'brain.%' OR action LIKE 'goal.%' OR action LIKE 'area.%')
            AND target ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          ORDER BY created_at DESC LIMIT 2000) l
    LEFT JOIN public.improvements i ON i.id = l.target::uuid AND i.organization_id = org
    LEFT JOIN public.area_goals g ON g.id = l.target::uuid AND g.organization_id = org
    LEFT JOIN public.org_areas a ON a.id = l.target::uuid AND a.organization_id = org
    LEFT JOIN public.organization_members m ON m.organization_id = org AND m.user_id = l.actor_id
    WHERE i.area_id = area OR g.area_id = area OR a.id = area
    ORDER BY l.created_at DESC LIMIT 100) t), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.area_activity(uuid, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.area_activity(uuid, uuid, timestamptz) TO authenticated;

-- Painel: valor da meta calculado uma vez.
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
                'value', gv.v, 'light', private.goal_status(g, gv.v)) ORDER BY g.created_at)
              FROM public.area_goals g, LATERAL (SELECT private.goal_value(g) AS v) gv
              WHERE g.area_id = a.id AND g.status IN ('proposta', 'ativa')), '[]'::jsonb),
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
