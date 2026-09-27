-- =============================================================================
-- 2E — Assumir com permissão e avisos de protocolo
--  * take_over_ticket: assumir atendimento que está com outra pessoa exige
--    conversations.reassign; registra de quem foi tirado e notifica essa pessoa.
--  * Avisos ao cliente saem de um só lugar (ticket-greeting, via pg_net) a
--    partir dos eventos do atendimento: protocolo na abertura, saudação de quem
--    assumiu e aviso de transferência — cada um liga/desliga em settings.
-- Idempotente.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.take_over_ticket(ticket uuid)
RETURNS public.tickets LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.tickets; prev uuid;
BEGIN
  SELECT * INTO t FROM public.tickets WHERE id = ticket FOR UPDATE;
  IF t.id IS NULL OR t.status = 'closed'
     OR NOT private.can_see_conversation(t.organization_id, t.department_id, t.assigned_to)
     OR NOT private.has_permission(t.organization_id, 'conversations.reassign') THEN
    RAISE EXCEPTION 'sem permissão para assumir este atendimento' USING ERRCODE = '42501';
  END IF;
  prev := t.assigned_to;
  IF prev = (SELECT auth.uid()) THEN RETURN t; END IF;
  UPDATE public.tickets SET assigned_to = (SELECT auth.uid()), status = 'open', opened_at = coalesce(opened_at, now())
  WHERE id = ticket RETURNING * INTO t;
  PERFORM private.ticket_event(t, 'taken_over',
    jsonb_build_object('from_user', prev, 'to_user', (SELECT auth.uid())));
  PERFORM private.mirror_ticket(t);
  RETURN t;
END $$;
REVOKE ALL ON FUNCTION public.take_over_ticket(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.take_over_ticket(uuid) TO authenticated;

-- Notificações: quem recebe o atendimento e quem perdeu (assumido por outro).
CREATE OR REPLACE FUNCTION private.notify_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target uuid; t public.tickets;
BEGIN
  target := CASE
    WHEN NEW.type IN ('assigned', 'transferred') THEN (NEW.meta ->> 'to_user')::uuid
    WHEN NEW.type = 'taken_over' THEN (NEW.meta ->> 'from_user')::uuid
  END;
  IF target IS NULL OR target = NEW.actor_id THEN RETURN NULL; END IF;
  SELECT * INTO t FROM public.tickets WHERE id = NEW.ticket_id;
  INSERT INTO public.notifications (organization_id, user_id, kind, ref)
  VALUES (NEW.organization_id, target, NEW.type,
          jsonb_strip_nulls(jsonb_build_object('conversation_id', t.conversation_id, 'ticket_id', t.id,
            'protocol', t.protocol, 'note', NEW.meta ->> 'note', 'by', NEW.actor_id)));
  RETURN NULL;
END $$;

-- Avisos ao cliente: o banco só diz qual evento aconteceu; a função decide
-- o texto pelas configurações da organização.
CREATE OR REPLACE FUNCTION private.greet_async()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text;
BEGIN
  IF NOT (NEW.type IN ('assigned', 'taken_over', 'transferred')
          OR (NEW.type = 'created' AND coalesce((NEW.meta ->> 'backfill')::boolean, false) = false)) THEN
    RETURN NULL;
  END IF;
  SELECT value INTO base FROM public.app_settings WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'platform:cron_secret';
  IF coalesce(base, '') = '' OR secret IS NULL THEN RETURN NULL; END IF;
  PERFORM net.http_post(
    url := base || '/ticket-greeting',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := jsonb_build_object('ticket_id', NEW.ticket_id, 'event_id', NEW.id));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.greet_async(), private.notify_assignment() FROM PUBLIC, anon, authenticated;
