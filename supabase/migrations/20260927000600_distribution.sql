-- =============================================================================
-- ClubeCRM — presença, distribuição automática e painel do supervisor (2C).
-- Spec: docs/superpowers/specs/2026-09-24-atendimento-humano-design.md §5, §7.5, §7.7
-- Idempotente.
-- =============================================================================

ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS distribution_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS max_concurrent integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS queue_alert_minutes integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS reply_alert_minutes integer NOT NULL DEFAULT 10;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'departments_distribution_mode_check') THEN
    ALTER TABLE public.departments ADD CONSTRAINT departments_distribution_mode_check
      CHECK (distribution_mode IN ('manual', 'auto') AND max_concurrent BETWEEN 1 AND 100);
  END IF;
END $$;

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_response_at timestamptz;

CREATE TABLE IF NOT EXISTS public.pause_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  UNIQUE (organization_id, name),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.agent_presence (
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'paused', 'offline')),
  pause_reason_id uuid,
  status_since timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  last_assigned_at timestamptz,
  max_concurrent integer CHECK (max_concurrent IS NULL OR max_concurrent BETWEEN 1 AND 100),
  PRIMARY KEY (organization_id, user_id),
  FOREIGN KEY (organization_id, user_id)
    REFERENCES public.organization_members (organization_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (pause_reason_id, organization_id)
    REFERENCES public.pause_reasons (id, organization_id) ON DELETE SET NULL (pause_reason_id)
);

ALTER TABLE public.pause_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pause_reasons, public.agent_presence FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.agent_presence FROM authenticated;
DROP POLICY IF EXISTS "org: ver" ON public.pause_reasons;
DROP POLICY IF EXISTS "org: gerenciar" ON public.pause_reasons;
CREATE POLICY "org: ver" ON public.pause_reasons FOR SELECT TO authenticated
  USING (private.is_member(organization_id));
CREATE POLICY "org: gerenciar" ON public.pause_reasons FOR ALL TO authenticated
  USING (private.has_permission(organization_id, 'library.manage'))
  WITH CHECK (private.has_permission(organization_id, 'library.manage'));
DROP POLICY IF EXISTS "org: ver" ON public.agent_presence;
CREATE POLICY "org: ver" ON public.agent_presence FOR SELECT TO authenticated
  USING (private.is_member(organization_id));

-- Motivos de pausa padrão (organizações novas e existentes).
CREATE OR REPLACE FUNCTION private.seed_pause_reasons()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.pause_reasons (organization_id, name, position)
  SELECT NEW.id, r, o FROM unnest(ARRAY['Almoço', 'Intervalo', 'Reunião', 'Treinamento']) WITH ORDINALITY AS x(r, o)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.seed_pause_reasons() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS seed_pause_reasons ON public.organizations;
CREATE TRIGGER seed_pause_reasons AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION private.seed_pause_reasons();
INSERT INTO public.pause_reasons (organization_id, name, position)
SELECT o.id, r, x.o FROM public.organizations o,
  unnest(ARRAY['Almoço', 'Intervalo', 'Reunião', 'Treinamento']) WITH ORDINALITY AS x(r, o)
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Presença
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.heartbeat(org uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF private.member_role(org) IS NULL THEN RETURN; END IF;
  INSERT INTO public.agent_presence (organization_id, user_id, last_seen_at)
  VALUES (org, (SELECT auth.uid()), now())
  ON CONFLICT (organization_id, user_id) DO UPDATE SET last_seen_at = now();
END $$;

-- Disponível = online e com sinal nos últimos 3 minutos.
CREATE OR REPLACE FUNCTION private.is_available(org uuid, uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.agent_presence
                 WHERE organization_id = org AND user_id = uid
                   AND status = 'online' AND last_seen_at > now() - interval '3 minutes')
$$;

-- -----------------------------------------------------------------------------
-- Distribuição automática (fila de departamento em modo 'auto')
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.try_assign(ticket uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.tickets; d public.departments; pick uuid;
BEGIN
  SELECT * INTO t FROM public.tickets WHERE id = ticket;
  IF t.id IS NULL OR t.status <> 'queued' OR t.department_id IS NULL OR t.assigned_to IS NOT NULL THEN
    RETURN false;
  END IF;
  SELECT * INTO d FROM public.departments WHERE id = t.department_id;
  IF d.distribution_mode <> 'auto' THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('clubecrm:dept:' || d.id));

  -- Menos atendimentos abertos primeiro; empate: quem recebeu há mais tempo.
  SELECT dm.user_id INTO pick
  FROM public.department_members dm
  JOIN public.organization_members om
    ON om.organization_id = dm.organization_id AND om.user_id = dm.user_id AND om.status = 'active'
  JOIN public.agent_presence p ON p.organization_id = dm.organization_id AND p.user_id = dm.user_id
  WHERE dm.department_id = d.id
    AND p.status = 'online' AND p.last_seen_at > now() - interval '3 minutes'
    AND (SELECT count(*) FROM public.tickets x
         WHERE x.organization_id = d.organization_id AND x.assigned_to = dm.user_id AND x.status = 'open')
        < coalesce(p.max_concurrent, d.max_concurrent)
  ORDER BY (SELECT count(*) FROM public.tickets x
            WHERE x.organization_id = d.organization_id AND x.assigned_to = dm.user_id AND x.status = 'open'),
           p.last_assigned_at NULLS FIRST
  LIMIT 1;
  IF pick IS NULL THEN RETURN false; END IF;

  UPDATE public.tickets
  SET assigned_to = pick, status = 'open', assigned_at = now(), opened_at = coalesce(opened_at, now())
  WHERE id = ticket AND status = 'queued' AND assigned_to IS NULL
  RETURNING * INTO t;
  IF t.id IS NULL THEN RETURN false; END IF;
  UPDATE public.agent_presence SET last_assigned_at = now()
  WHERE organization_id = t.organization_id AND user_id = pick;
  INSERT INTO public.ticket_events (organization_id, ticket_id, type, meta)
  VALUES (t.organization_id, t.id, 'assigned', jsonb_build_object('to_user', pick, 'auto', true));
  PERFORM private.mirror_ticket(t);
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION private.drain_department(dept uuid)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT id FROM public.tickets
           WHERE department_id = dept AND status = 'queued' AND assigned_to IS NULL
           ORDER BY queued_at NULLS FIRST, created_at LOOP
    IF private.try_assign(r.id) THEN n := n + 1; ELSE EXIT; END IF;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION private.drain_all()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT DISTINCT t.department_id FROM public.tickets t
           JOIN public.departments d ON d.id = t.department_id AND d.distribution_mode = 'auto'
           WHERE t.status = 'queued' AND t.assigned_to IS NULL LOOP
    n := n + private.drain_department(r.department_id);
  END LOOP;
  RETURN n;
END $$;

-- Gatilho: atendimento entrou na fila de um departamento → tenta distribuir;
-- atendimento saiu de alguém (finalizado/transferido) → libera vaga.
CREATE OR REPLACE FUNCTION private.on_ticket_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'queued' AND NEW.department_id IS NOT NULL AND NEW.assigned_to IS NULL THEN
    PERFORM private.try_assign(NEW.id);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'open' AND NEW.status <> 'open' AND OLD.department_id IS NOT NULL THEN
    PERFORM private.drain_department(OLD.department_id);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS on_ticket_change ON public.tickets;
CREATE TRIGGER on_ticket_change AFTER INSERT OR UPDATE OF status, department_id, assigned_to ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION private.on_ticket_change();

CREATE OR REPLACE FUNCTION public.set_presence(org uuid, new_status text, reason uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record;
BEGIN
  IF private.member_role(org) IS NULL THEN
    RAISE EXCEPTION 'sem acesso a esta organização' USING ERRCODE = '42501';
  END IF;
  IF new_status NOT IN ('online', 'paused', 'offline') THEN
    RAISE EXCEPTION 'status inválido' USING ERRCODE = '22023';
  END IF;
  IF new_status = 'paused' AND NOT EXISTS (
       SELECT 1 FROM public.pause_reasons WHERE id = reason AND organization_id = org AND active) THEN
    RAISE EXCEPTION 'escolha o motivo da pausa' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.agent_presence (organization_id, user_id, status, pause_reason_id, status_since, last_seen_at)
  VALUES (org, (SELECT auth.uid()), new_status, CASE WHEN new_status = 'paused' THEN reason END, now(), now())
  ON CONFLICT (organization_id, user_id) DO UPDATE
    SET status = EXCLUDED.status, pause_reason_id = EXCLUDED.pause_reason_id,
        status_since = CASE WHEN agent_presence.status = EXCLUDED.status THEN agent_presence.status_since ELSE now() END,
        last_seen_at = now();
  -- Ficou disponível: puxa a fila dos departamentos dele.
  IF new_status = 'online' THEN
    FOR r IN SELECT department_id FROM public.department_members
             WHERE organization_id = org AND user_id = (SELECT auth.uid()) LOOP
      PERFORM private.drain_department(r.department_id);
    END LOOP;
  END IF;
END $$;

-- claim/transfer passam a registrar assigned_at (tempo de fila no painel).
CREATE OR REPLACE FUNCTION private.stamp_assigned_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    NEW.assigned_at := now();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS stamp_assigned_at ON public.tickets;
CREATE TRIGGER stamp_assigned_at BEFORE UPDATE OF assigned_to ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION private.stamp_assigned_at();

-- -----------------------------------------------------------------------------
-- Painel do supervisor
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.supervisor_dashboard(org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  uid uuid := (SELECT auth.uid());
  all_depts boolean;
  depts uuid[];
  day_start timestamptz := date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo';
BEGIN
  IF NOT private.has_permission(org, 'reports.view') THEN
    RAISE EXCEPTION 'sem permissão para o painel' USING ERRCODE = '42501';
  END IF;
  all_depts := private.has_permission(org, 'conversations.view_all');
  SELECT coalesce(array_agg(id), '{}') INTO depts FROM public.departments
  WHERE organization_id = org
    AND (all_depts OR id IN (SELECT department_id FROM public.department_members WHERE user_id = uid));

  RETURN jsonb_build_object(
    'team', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', om.user_id,
        'name', coalesce(pr.full_name, pr.email),
        'status', CASE WHEN p.status = 'online' AND p.last_seen_at <= now() - interval '3 minutes' THEN 'offline'
                       ELSE coalesce(p.status, 'offline') END,
        'pause_reason', pz.name,
        'status_since', p.status_since,
        'open', (SELECT count(*) FROM public.tickets x
                 WHERE x.organization_id = org AND x.assigned_to = om.user_id AND x.status = 'open')
      ) ORDER BY coalesce(pr.full_name, pr.email))
      FROM public.organization_members om
      LEFT JOIN public.profiles pr ON pr.user_id = om.user_id
      LEFT JOIN public.agent_presence p ON p.organization_id = org AND p.user_id = om.user_id
      LEFT JOIN public.pause_reasons pz ON pz.id = p.pause_reason_id
      WHERE om.organization_id = org AND om.status = 'active'
        AND (all_depts OR EXISTS (SELECT 1 FROM public.department_members dm
                                  WHERE dm.user_id = om.user_id AND dm.department_id = ANY (depts)))
    ), '[]'::jsonb),
    'queues', coalesce((
      SELECT jsonb_agg(q ORDER BY q->>'name') FROM (
        SELECT jsonb_build_object(
          'department_id', d.id, 'name', d.name, 'mode', d.distribution_mode,
          'alert_minutes', d.queue_alert_minutes,
          'queued', count(t.id),
          'oldest_queued_at', min(t.queued_at)) AS q
        FROM public.departments d
        LEFT JOIN public.tickets t ON t.department_id = d.id AND t.status = 'queued' AND t.assigned_to IS NULL
        WHERE d.id = ANY (depts)
        GROUP BY d.id
        UNION ALL
        SELECT jsonb_build_object('department_id', NULL, 'name', 'Fila geral', 'mode', 'manual',
          'alert_minutes', 5, 'queued', count(*), 'oldest_queued_at', min(coalesce(queued_at, created_at)))
        FROM public.tickets
        WHERE organization_id = org AND department_id IS NULL AND assigned_to IS NULL AND status IN ('queued', 'open')
          AND all_depts
      ) s
    ), '[]'::jsonb),
    'today', (
      SELECT jsonb_build_object(
        'opened', count(*) FILTER (WHERE created_at >= day_start),
        'closed', count(*) FILTER (WHERE closed_at >= day_start),
        -- Intervalos só contam quando fazem sentido (fim depois do início):
        -- reatribuições posteriores não podem gerar tempo negativo.
        'avg_queue_seconds', round(extract(epoch FROM avg(assigned_at - queued_at)
                             FILTER (WHERE assigned_at >= day_start AND assigned_at >= queued_at))),
        'avg_first_response_seconds', round(extract(epoch FROM avg(first_response_at - opened_at)
                             FILTER (WHERE first_response_at >= day_start AND first_response_at >= opened_at))),
        'avg_duration_seconds', round(extract(epoch FROM avg(closed_at - coalesce(opened_at, created_at))
                             FILTER (WHERE closed_at >= day_start))))
      FROM public.tickets
      WHERE organization_id = org AND (all_depts OR department_id = ANY (depts))
    )
  );
END $$;

REVOKE ALL ON FUNCTION private.is_available(uuid, uuid), private.try_assign(uuid),
  private.drain_department(uuid), private.drain_all(), private.on_ticket_change(),
  private.stamp_assigned_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.heartbeat(uuid), public.set_presence(uuid, text, uuid),
  public.supervisor_dashboard(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.heartbeat(uuid), public.set_presence(uuid, text, uuid),
  public.supervisor_dashboard(uuid) TO authenticated;

-- Rede de segurança: a cada minuto distribui o que ficou na fila (SQL direto).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'drain-queues') THEN
    PERFORM cron.unschedule('drain-queues');
  END IF;
  PERFORM cron.schedule('drain-queues', '* * * * *', 'SELECT private.drain_all()');
END $$;
