-- =============================================================================
-- Webhooks: uma função de gatilho por tabela (a função única referenciava campos que
-- só existem em algumas tabelas — "record new has no field status"). Mesmo
-- comportamento: só enfileira quando a empresa tem endereço ativo. Idempotente.
-- =============================================================================
CREATE OR REPLACE FUNCTION private.webhook_has_endpoint(org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT org IS NOT NULL AND EXISTS (SELECT 1 FROM public.webhook_endpoints WHERE organization_id = org AND active)
$$;
REVOKE ALL ON FUNCTION private.webhook_has_endpoint(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.webhook_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF private.webhook_has_endpoint(NEW.organization_id) THEN
    PERFORM private.enqueue_webhook(NEW.organization_id, 'contact.created',
      jsonb_build_object('id', NEW.id, 'name', NEW.name, 'phone', NEW.phone, 'email', NEW.email));
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION private.webhook_conversation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.webhook_has_endpoint(NEW.organization_id) THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM private.enqueue_webhook(NEW.organization_id, 'conversation.created',
      jsonb_build_object('id', NEW.id, 'channel', NEW.channel, 'contact_id', NEW.contact_id, 'contact_name', NEW.contact_name,
        'contact_phone', NEW.contact_phone, 'contact_email', NEW.contact_email));
  ELSIF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    PERFORM private.enqueue_webhook(NEW.organization_id, 'conversation.stage_changed',
      jsonb_build_object('id', NEW.id, 'contact_id', NEW.contact_id, 'contact_name', NEW.contact_name, 'contact_phone', NEW.contact_phone,
        'stage_id', NEW.stage_id, 'stage', (SELECT name FROM public.pipeline_stages WHERE id = NEW.stage_id AND organization_id = NEW.organization_id),
        'previous_stage_id', OLD.stage_id));
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION private.webhook_ticket()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' AND private.webhook_has_endpoint(NEW.organization_id) THEN
    PERFORM private.enqueue_webhook(NEW.organization_id, 'ticket.closed',
      jsonb_build_object('id', NEW.id, 'protocol', NEW.protocol, 'conversation_id', NEW.conversation_id,
        'close_reason', (SELECT name FROM public.close_reasons WHERE id = NEW.close_reason_id AND organization_id = NEW.organization_id),
        'closed_at', NEW.closed_at));
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION private.webhook_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF private.webhook_has_endpoint(NEW.organization_id) THEN
    PERFORM private.enqueue_webhook(NEW.organization_id, 'message.received',
      jsonb_build_object('id', NEW.id, 'conversation_id', NEW.conversation_id, 'type', coalesce(NEW.type, 'text'),
        'text', left(NEW.content, 4000), 'created_at', NEW.created_at));
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS contacts_webhook ON public.contacts;
CREATE TRIGGER contacts_webhook AFTER INSERT ON public.contacts FOR EACH ROW EXECUTE FUNCTION private.webhook_contact();
DROP TRIGGER IF EXISTS conversations_webhook_ins ON public.conversations;
CREATE TRIGGER conversations_webhook_ins AFTER INSERT ON public.conversations FOR EACH ROW EXECUTE FUNCTION private.webhook_conversation();
DROP TRIGGER IF EXISTS conversations_webhook_stage ON public.conversations;
CREATE TRIGGER conversations_webhook_stage AFTER UPDATE OF stage_id ON public.conversations FOR EACH ROW EXECUTE FUNCTION private.webhook_conversation();
DROP TRIGGER IF EXISTS tickets_webhook ON public.tickets;
CREATE TRIGGER tickets_webhook AFTER UPDATE OF status ON public.tickets FOR EACH ROW EXECUTE FUNCTION private.webhook_ticket();
DROP TRIGGER IF EXISTS messages_webhook ON public.messages;
CREATE TRIGGER messages_webhook AFTER INSERT ON public.messages FOR EACH ROW WHEN (NEW.direction = 'inbound') EXECUTE FUNCTION private.webhook_message();
DROP FUNCTION IF EXISTS private.webhook_on_change();
