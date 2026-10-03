-- =============================================================================
-- Atendente preferencial (pedido em 03/10): se o setor ligar a opção, o cliente
-- que já foi atendido por uma pessoa do setor nos últimos N dias volta direto
-- para essa pessoa (WhatsApp ou e-mail: o cliente é o mesmo contato), desde que
-- ela esteja online e abaixo do limite de atendimentos. Senão, segue a fila
-- normal. Vale até na fila manual. Fica registrado no histórico do atendimento.
-- Idempotente.
-- =============================================================================

ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS preferred_agent boolean NOT NULL DEFAULT false;
ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS preferred_days integer NOT NULL DEFAULT 90;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'departments_preferred_days_check') THEN
    ALTER TABLE public.departments ADD CONSTRAINT departments_preferred_days_check CHECK (preferred_days BETWEEN 1 AND 365);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.try_assign(ticket uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.tickets; d public.departments; pick uuid; pref uuid; preferred boolean := false; helpers uuid[] := '{}';
BEGIN
  SELECT * INTO t FROM public.tickets WHERE id = ticket;
  IF t.id IS NULL OR t.status <> 'queued' OR t.department_id IS NULL OR t.assigned_to IS NOT NULL THEN
    RETURN false;
  END IF;
  SELECT * INTO d FROM public.departments WHERE id = t.department_id;
  PERFORM pg_advisory_xact_lock(hashtext('clubecrm:dept:' || d.id));

  -- Atendente preferencial: quem atendeu este mesmo cliente por último, se estiver livre.
  IF d.preferred_agent THEN
    SELECT o.assigned_to INTO pref
    FROM public.tickets o
    JOIN public.conversations c ON c.id = o.conversation_id
    JOIN public.conversations cur ON cur.id = t.conversation_id
    WHERE o.organization_id = t.organization_id AND o.id <> t.id AND o.assigned_to IS NOT NULL
      AND cur.contact_id IS NOT NULL AND c.contact_id = cur.contact_id
      AND o.created_at > now() - make_interval(days => d.preferred_days)
    ORDER BY coalesce(o.closed_at, o.updated_at) DESC
    LIMIT 1;
    IF pref IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.department_members dm
      JOIN public.organization_members om ON om.organization_id = dm.organization_id AND om.user_id = dm.user_id AND om.status = 'active'
      JOIN public.agent_presence p ON p.organization_id = dm.organization_id AND p.user_id = dm.user_id
      WHERE dm.department_id = d.id AND dm.user_id = pref
        AND p.status = 'online' AND p.last_seen_at > now() - interval '3 minutes'
        AND (SELECT count(*) FROM public.tickets x
             WHERE x.organization_id = d.organization_id AND x.assigned_to = pref AND x.status = 'open')
            < coalesce(p.max_concurrent, d.max_concurrent)
    ) THEN
      pick := pref; preferred := true;
    END IF;
  END IF;

  IF pick IS NULL THEN
    IF d.distribution_mode <> 'auto' THEN RETURN false; END IF;
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
  END IF;

  UPDATE public.tickets
  SET assigned_to = pick, status = 'open', assigned_at = now(), opened_at = coalesce(opened_at, now())
  WHERE id = ticket AND status = 'queued' AND assigned_to IS NULL
  RETURNING * INTO t;
  IF t.id IS NULL THEN RETURN false; END IF;
  UPDATE public.agent_presence SET last_assigned_at = now()
  WHERE organization_id = t.organization_id AND user_id = pick;
  INSERT INTO public.ticket_events (organization_id, ticket_id, type, meta)
  VALUES (t.organization_id, t.id, 'assigned', jsonb_build_object('to_user', pick, 'auto', true, 'preferred', preferred,
          'helper', NOT EXISTS (SELECT 1 FROM public.department_members m WHERE m.department_id = d.id AND m.user_id = pick)));
  PERFORM private.mirror_ticket(t);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION private.try_assign(uuid) FROM PUBLIC, anon, authenticated;
-- O gatilho on_ticket_change já chama try_assign para todo atendimento que entra na fila de um
-- setor (manual ou automático); a fila manual só ignora a distribuição, não o preferencial.
