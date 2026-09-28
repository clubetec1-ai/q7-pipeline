-- =============================================================================
-- Transbordo entre setores (pedido em 28/09)
--  * departments.overflow_to: setores que ajudam; overflow_after_minutes: depois
--    de quantos minutos de espera na fila (NULL = desligado).
--  * Enquanto a fila do setor tiver atendimento esperando além do tempo, quem é
--    dos setores ajudantes (e pode atender) VÊ e pode ASSUMIR só os atendimentos
--    SEM responsável daquele setor. Nada muda para conversas já atribuídas.
--  * Distribuição automática: se ninguém do setor estiver livre, passa para
--    alguém disponível dos setores ajudantes.
--  * tickets.overflow_at + evento 'overflow' marcam quando a ajuda foi aberta.
-- Idempotente.
-- =============================================================================

ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS overflow_to uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS overflow_after_minutes integer;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS overflow_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'departments_overflow_check') THEN
    ALTER TABLE public.departments ADD CONSTRAINT departments_overflow_check CHECK (
      (overflow_after_minutes IS NULL OR overflow_after_minutes BETWEEN 1 AND 240)
      AND cardinality(overflow_to) <= 10);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS tickets_dept_queue_idx ON public.tickets (department_id, queued_at)
  WHERE status = 'queued' AND assigned_to IS NULL;

-- Setores ajudantes: só da mesma organização e nunca o próprio setor.
CREATE OR REPLACE FUNCTION private.department_overflow_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  NEW.overflow_to := ARRAY(SELECT DISTINCT x FROM unnest(coalesce(NEW.overflow_to, '{}')) x WHERE x <> NEW.id);
  IF EXISTS (SELECT 1 FROM unnest(NEW.overflow_to) x
             WHERE NOT EXISTS (SELECT 1 FROM public.departments d
                               WHERE d.id = x AND d.organization_id = NEW.organization_id)) THEN
    RAISE EXCEPTION 'setor ajudante inválido' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.department_overflow_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS department_overflow_guard ON public.departments;
CREATE TRIGGER department_overflow_guard BEFORE INSERT OR UPDATE OF overflow_to ON public.departments
  FOR EACH ROW EXECUTE FUNCTION private.department_overflow_guard();

-- O setor está pedindo ajuda agora? (fila parada além do tempo configurado)
CREATE OR REPLACE FUNCTION private.dept_overflowing(dept uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.departments d
    JOIN public.tickets t ON t.department_id = d.id AND t.status = 'queued' AND t.assigned_to IS NULL
    WHERE d.id = dept AND d.overflow_after_minutes IS NOT NULL AND cardinality(d.overflow_to) > 0
      AND coalesce(t.queued_at, t.created_at) < now() - make_interval(mins => d.overflow_after_minutes))
$$;

-- A pessoa é de um setor ajudante deste setor?
CREATE OR REPLACE FUNCTION private.is_overflow_helper(dept uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.departments d
    JOIN public.department_members dm ON dm.department_id = ANY (d.overflow_to)
    WHERE d.id = dept AND dm.user_id = (SELECT auth.uid()))
$$;
-- Só usadas por dentro de can_see_conversation (SECURITY DEFINER).
REVOKE ALL ON FUNCTION private.dept_overflowing(uuid), private.is_overflow_helper(uuid) FROM PUBLIC, anon, authenticated;

-- Visibilidade de conversa (spec §5.3) + ajuda de outro setor (só sem responsável).
CREATE OR REPLACE FUNCTION private.can_see_conversation(org uuid, dept uuid, assignee uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  perms text[] := private.effective_permissions(org);
  uid uuid := (SELECT auth.uid());
  mode text;
BEGIN
  IF cardinality(perms) = 0 THEN RETURN false; END IF;
  IF 'conversations.view_all' = ANY (perms) THEN RETURN true; END IF;
  IF assignee = uid THEN RETURN true; END IF;
  -- Fila geral: sem departamento e sem responsável.
  IF dept IS NULL AND assignee IS NULL THEN
    RETURN 'conversations.attend' = ANY (perms);
  END IF;
  IF dept IS NULL THEN RETURN false; END IF;
  IF NOT private.in_department(dept) THEN
    -- Transbordo: setor ajudante vê a fila (sem responsável) enquanto o setor pede ajuda.
    RETURN assignee IS NULL AND 'conversations.attend' = ANY (perms)
       AND private.is_overflow_helper(dept) AND private.dept_overflowing(dept);
  END IF;
  IF 'conversations.view_department' = ANY (perms) THEN RETURN true; END IF;
  SELECT coalesce(settings ->> 'agent_visibility', 'own_and_queue') INTO mode
  FROM public.organizations WHERE id = org;
  RETURN mode = 'department' OR assignee IS NULL;
END $$;

-- Distribuição automática: setor primeiro; se ninguém livre e o atendimento já
-- passou do tempo, alguém disponível dos setores ajudantes.
CREATE OR REPLACE FUNCTION private.try_assign(ticket uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.tickets; d public.departments; pick uuid; helpers uuid[] := '{}';
BEGIN
  SELECT * INTO t FROM public.tickets WHERE id = ticket;
  IF t.id IS NULL OR t.status <> 'queued' OR t.department_id IS NULL OR t.assigned_to IS NOT NULL THEN
    RETURN false;
  END IF;
  SELECT * INTO d FROM public.departments WHERE id = t.department_id;
  IF d.distribution_mode <> 'auto' THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('clubecrm:dept:' || d.id));
  IF d.overflow_after_minutes IS NOT NULL
     AND coalesce(t.queued_at, t.created_at) < now() - make_interval(mins => d.overflow_after_minutes) THEN
    helpers := d.overflow_to;
  END IF;

  -- Setor primeiro; depois menos atendimentos abertos; empate: quem recebeu há mais tempo.
  SELECT x.user_id INTO pick FROM (
    SELECT DISTINCT ON (dm.user_id) dm.user_id, (dm.department_id <> d.id) AS helper, p.last_assigned_at,
           (SELECT count(*) FROM public.tickets o
            WHERE o.organization_id = d.organization_id AND o.assigned_to = dm.user_id AND o.status = 'open') AS load,
           coalesce(p.max_concurrent, d.max_concurrent) AS cap
    FROM public.department_members dm
    JOIN public.organization_members om
      ON om.organization_id = dm.organization_id AND om.user_id = dm.user_id AND om.status = 'active'
    JOIN public.agent_presence p ON p.organization_id = dm.organization_id AND p.user_id = dm.user_id
    WHERE (dm.department_id = d.id OR dm.department_id = ANY (helpers))
      AND dm.organization_id = d.organization_id
      AND p.status = 'online' AND p.last_seen_at > now() - interval '3 minutes'
    ORDER BY dm.user_id, (dm.department_id <> d.id)
  ) x
  WHERE x.load < x.cap
  ORDER BY x.helper, x.load, x.last_assigned_at NULLS FIRST
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
  VALUES (t.organization_id, t.id, 'assigned', jsonb_build_object('to_user', pick, 'auto', true,
          'helper', NOT EXISTS (SELECT 1 FROM public.department_members m WHERE m.department_id = d.id AND m.user_id = pick)));
  PERFORM private.mirror_ticket(t);
  RETURN true;
END $$;

-- A cada minuto (drain-queues): marca quem passou do tempo e redistribui.
CREATE OR REPLACE FUNCTION private.drain_all()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    UPDATE public.tickets t SET overflow_at = now()
    FROM public.departments d
    WHERE d.id = t.department_id AND t.status = 'queued' AND t.assigned_to IS NULL AND t.overflow_at IS NULL
      AND d.overflow_after_minutes IS NOT NULL AND cardinality(d.overflow_to) > 0
      AND coalesce(t.queued_at, t.created_at) < now() - make_interval(mins => d.overflow_after_minutes)
    RETURNING t.id, t.organization_id, d.overflow_to
  LOOP
    INSERT INTO public.ticket_events (organization_id, ticket_id, type, meta)
    VALUES (r.organization_id, r.id, 'overflow', jsonb_build_object('helpers', to_jsonb(r.overflow_to)));
  END LOOP;
  FOR r IN SELECT DISTINCT t.department_id FROM public.tickets t
           JOIN public.departments d ON d.id = t.department_id AND d.distribution_mode = 'auto'
           WHERE t.status = 'queued' AND t.assigned_to IS NULL LOOP
    n := n + private.drain_department(r.department_id);
  END LOOP;
  RETURN n;
END $$;

-- Saiu da fila (assumido, transferido, finalizado): limpa a marca de ajuda.
CREATE OR REPLACE FUNCTION private.clear_overflow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.overflow_at IS NOT NULL AND (NEW.status <> 'queued' OR NEW.assigned_to IS NOT NULL
     OR NEW.department_id IS DISTINCT FROM OLD.department_id) THEN
    NEW.overflow_at := NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.clear_overflow() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS clear_overflow ON public.tickets;
CREATE TRIGGER clear_overflow BEFORE UPDATE OF status, assigned_to, department_id ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION private.clear_overflow();
