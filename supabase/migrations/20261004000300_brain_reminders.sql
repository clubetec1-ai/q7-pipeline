-- =============================================================================
-- Cérebro, fatia 3 (docs/design/03-cerebro.md §2.3 e §2.7): cobranças sem IA.
--  * improvements ganham prazo, contador de cobranças e os campos que as próximas
--    fatias usam (meta, evidência, prioridade, agente, processo do Diagnóstico, execução);
--  * brain_daily_tick (cron diário, sem IA): foto semanal às segundas; avisa meta fora
--    do rumo (1x/7 dias); cobra proposta parada (sugerida >3 dias, aprovada sem ir ao
--    ar >7 dias, prazo vencido) a cada 3 dias; depois de 2 cobranças escala ao dono;
--  * "Cobrar" manual (dono, 1x/24 h) e prazo (quem aprova).
-- Só empresas com o módulo "gestao". Idempotente.
-- =============================================================================

ALTER TABLE public.improvements ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE public.improvements ADD COLUMN IF NOT EXISTS reminded_at timestamptz;
ALTER TABLE public.improvements ADD COLUMN IF NOT EXISTS reminders smallint NOT NULL DEFAULT 0;
ALTER TABLE public.improvements ADD COLUMN IF NOT EXISTS goal_id uuid;
ALTER TABLE public.improvements ADD COLUMN IF NOT EXISTS evidence jsonb;
ALTER TABLE public.improvements ADD COLUMN IF NOT EXISTS priority smallint;
ALTER TABLE public.improvements ADD COLUMN IF NOT EXISTS agent_key text;
ALTER TABLE public.improvements ADD COLUMN IF NOT EXISTS process_ref text;
ALTER TABLE public.improvements ADD COLUMN IF NOT EXISTS brain_run_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'improvements_goal_fk') THEN
    ALTER TABLE public.improvements ADD CONSTRAINT improvements_goal_fk FOREIGN KEY (goal_id, organization_id)
      REFERENCES public.area_goals (id, organization_id) ON DELETE SET NULL (goal_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'improvements_brain_ck') THEN
    ALTER TABLE public.improvements ADD CONSTRAINT improvements_brain_ck CHECK (
      (agent_key IS NULL OR agent_key ~ '^[a-z_:]{2,40}$')
      AND (process_ref IS NULL OR char_length(process_ref) <= 120)
      AND (evidence IS NULL OR octet_length(evidence::text) <= 8192)
      AND (priority IS NULL OR priority BETWEEN 1 AND 5));
  END IF;
END $$;

-- Quem recebe a cobrança de uma proposta: responsável/substituto da área (ou, sem área ou
-- escalada, dono/admin). Devolve user_ids da MESMA empresa, membros ativos.
CREATE OR REPLACE FUNCTION private.brain_recipients(org uuid, area uuid, escalate boolean)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.user_id FROM public.organization_members m
  WHERE m.organization_id = org AND m.status = 'active'
    AND ((escalate OR area IS NULL OR NOT EXISTS (SELECT 1 FROM public.org_areas a WHERE a.id = area AND a.enabled AND a.approver_id IS NOT NULL))
           AND m.role IN ('owner', 'admin')
         OR (NOT escalate AND area IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.org_areas a WHERE a.id = area AND a.organization_id = org AND a.enabled
                 AND m.user_id IN (a.approver_id, a.backup_approver_id))))
$$;
REVOKE ALL ON FUNCTION private.brain_recipients(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.brain_daily_tick()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE o record; g public.area_goals; i public.improvements; v numeric; light text; esc boolean; n integer := 0;
BEGIN
  FOR o IN SELECT DISTINCT a.organization_id AS id FROM public.org_areas a
           JOIN public.organizations x ON x.id = a.organization_id AND x.status = 'active'
           WHERE a.enabled AND private.module_on(a.organization_id, 'gestao') LOOP
    -- 1. Segunda-feira: foto da semana anterior.
    IF extract(isodow FROM now()) = 1 THEN PERFORM private.snapshot_area_metrics(o.id); END IF;

    -- 2. Meta fora do rumo: avisa o responsável (ou o dono), no máximo 1x a cada 7 dias.
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

    -- 3. Propostas paradas: cobra a cada 3 dias; depois de 2 cobranças, escala ao dono.
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
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION private.brain_daily_tick() FROM PUBLIC, anon, authenticated;

-- "Cobrar" agora (dono/admin; 1x a cada 24 h por proposta).
CREATE OR REPLACE FUNCTION public.nudge_improvement(improvement uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.improvements;
BEGIN
  SELECT * INTO i FROM public.improvements WHERE id = improvement FOR UPDATE;
  IF i.id IS NULL OR NOT private.has_permission(i.organization_id, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF i.status NOT IN ('sugerida', 'aprovada') THEN RAISE EXCEPTION 'esta proposta não está pendente' USING ERRCODE = '22023'; END IF;
  IF i.reminded_at IS NOT NULL AND i.reminded_at > now() - interval '24 hours' THEN
    RAISE EXCEPTION 'já foi cobrada nas últimas 24 horas' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.notifications (organization_id, user_id, kind, ref)
  SELECT i.organization_id, r, 'brain_reminder', jsonb_build_object('improvement_id', i.id, 'title', left(i.title, 120), 'status', i.status, 'manual', true)
  FROM private.brain_recipients(i.organization_id, i.area_id, false) r WHERE r <> (SELECT auth.uid());
  UPDATE public.improvements SET reminders = least(reminders + 1, 100), reminded_at = now() WHERE id = i.id;
  PERFORM private.audit(i.organization_id, 'improvement.nudged', i.id::text, jsonb_build_object('title', i.title));
END $$;
REVOKE ALL ON FUNCTION public.nudge_improvement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nudge_improvement(uuid) TO authenticated;

-- Prazo da proposta (quem pode aprová-la).
CREATE OR REPLACE FUNCTION public.set_improvement_due(improvement uuid, due date)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.improvements;
BEGIN
  SELECT * INTO i FROM public.improvements WHERE id = improvement FOR UPDATE;
  IF i.id IS NULL OR NOT private.can_approve_improvement(i) THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF due IS NOT NULL AND due < current_date THEN RAISE EXCEPTION 'o prazo não pode ser no passado' USING ERRCODE = '22023'; END IF;
  UPDATE public.improvements SET due_date = due, updated_at = now() WHERE id = i.id;
  PERFORM private.audit(i.organization_id, 'improvement.due', i.id::text, jsonb_build_object('due', due));
END $$;
REVOKE ALL ON FUNCTION public.set_improvement_due(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_improvement_due(uuid, date) TO authenticated;

-- Pendências do painel (paradas, prazos, metas fora), com o mesmo recorte do brain_overview.
CREATE OR REPLACE FUNCTION public.brain_pending(org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE owner boolean := private.has_permission(org, 'org.settings');
BEGIN
  IF NOT owner AND NOT EXISTS (SELECT 1 FROM public.org_areas a WHERE a.organization_id = org AND private.is_area_approver(a.id)) THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', i.id, 'title', i.title, 'status', i.status, 'area_id', i.area_id, 'due_date', i.due_date, 'reminders', i.reminders,
      'reminded_at', i.reminded_at, 'since', CASE WHEN i.status = 'aprovada' THEN i.approved_at ELSE i.created_at END,
      'motivo', CASE WHEN i.due_date IS NOT NULL AND i.due_date < current_date THEN 'prazo_vencido'
                     WHEN i.status = 'aprovada' THEN 'aprovada_sem_ir_ao_ar' ELSE 'esperando_aprovacao' END)
      ORDER BY coalesce(i.due_date, (CASE WHEN i.status = 'aprovada' THEN i.approved_at ELSE i.created_at END)::date))
    FROM public.improvements i
    WHERE i.organization_id = org AND i.status IN ('sugerida', 'aprovada')
      AND ((i.status = 'sugerida' AND i.created_at < now() - interval '3 days')
        OR (i.status = 'aprovada' AND i.approved_at < now() - interval '7 days')
        OR (i.due_date IS NOT NULL AND i.due_date < current_date))
      AND (owner OR (i.area_id IS NOT NULL AND private.is_area_approver(i.area_id)))), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.brain_pending(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brain_pending(uuid) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'brain-daily') THEN PERFORM cron.unschedule('brain-daily'); END IF;
    PERFORM cron.schedule('brain-daily', '0 12 * * *', 'SELECT private.brain_daily_tick()');
  END IF;
END $$;
