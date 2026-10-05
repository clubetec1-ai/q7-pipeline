-- =============================================================================
-- API aberta e webhooks (docs/design/05-api-webhooks.md), fatia A1 (banco).
--  * api_keys: chave por empresa com permissões; o banco guarda só o SHA-256;
--  * webhook_endpoints + webhook_deliveries: fila de eventos assinados para sistemas
--    externos (n8n, Make, Zapier…); gatilhos nos eventos do atendimento;
--  * RPCs do dono (criar/revogar chave, salvar/testar/apagar endpoint) e do servidor
--    (achar a chave, pegar entregas, gravar resultado). Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 60),
  prefix text NOT NULL CHECK (prefix ~ '^dca_[0-9a-f]{6}$'),
  key_hash text NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] NOT NULL CHECK (cardinality(scopes) >= 1
    AND scopes <@ ARRAY['contacts:read', 'contacts:write', 'messages:send', 'conversations:read', 'funnel:write']),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS api_keys_org_idx ON public.api_keys (organization_id);
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.api_keys FROM anon, authenticated;
GRANT SELECT (id, organization_id, name, prefix, scopes, created_by, created_at, last_used_at, revoked_at) ON public.api_keys TO authenticated;
GRANT ALL ON public.api_keys TO service_role;
DROP POLICY IF EXISTS "org: ver" ON public.api_keys;
CREATE POLICY "org: ver" ON public.api_keys FOR SELECT TO authenticated USING (private.has_permission(organization_id, 'org.settings'));

CREATE OR REPLACE FUNCTION public.create_api_key(org uuid, p_name text, p_scopes text[])
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE k text; nid uuid;
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF (SELECT count(*) FROM public.api_keys WHERE organization_id = org AND revoked_at IS NULL) >= 20 THEN
    RAISE EXCEPTION 'limite de 20 chaves ativas; revogue alguma antes' USING ERRCODE = '22023';
  END IF;
  k := 'dca_' || encode(extensions.gen_random_bytes(20), 'hex');
  INSERT INTO public.api_keys (organization_id, name, prefix, key_hash, scopes, created_by)
  VALUES (org, btrim(p_name), left(k, 10), encode(extensions.digest(k, 'sha256'), 'hex'), p_scopes, (SELECT auth.uid()))
  RETURNING id INTO nid;
  PERFORM private.audit(org, 'api_key.created', nid::text, jsonb_build_object('name', btrim(p_name), 'scopes', p_scopes));
  RETURN jsonb_build_object('id', nid, 'key', k);
END $$;
REVOKE ALL ON FUNCTION public.create_api_key(uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_api_key(uuid, text, text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_api_key(key_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE k public.api_keys;
BEGIN
  SELECT * INTO k FROM public.api_keys WHERE id = key_id;
  IF k.id IS NULL OR NOT private.has_permission(k.organization_id, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  UPDATE public.api_keys SET revoked_at = coalesce(revoked_at, now()) WHERE id = key_id;
  PERFORM private.audit(k.organization_id, 'api_key.revoked', key_id::text, jsonb_build_object('name', k.name));
END $$;
REVOKE ALL ON FUNCTION public.revoke_api_key(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_api_key(uuid) TO authenticated;

-- Servidor: acha a chave pelo hash (só ativa, empresa ativa) e marca o uso.
CREATE OR REPLACE FUNCTION public.service_api_key_lookup(hash text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE k public.api_keys;
BEGIN
  SELECT a.* INTO k FROM public.api_keys a JOIN public.organizations o ON o.id = a.organization_id AND o.status = 'active'
  WHERE a.key_hash = hash AND a.revoked_at IS NULL;
  IF k.id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.api_keys SET last_used_at = now() WHERE id = k.id AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute');
  RETURN jsonb_build_object('key_id', k.id, 'organization_id', k.organization_id, 'scopes', k.scopes, 'name', k.name);
END $$;
REVOKE ALL ON FUNCTION public.service_api_key_lookup(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_api_key_lookup(text) TO service_role;

-- ---------------------------------------------------------------- webhooks
CREATE TABLE IF NOT EXISTS public.webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  url text NOT NULL CHECK (url ~ '^https://[A-Za-z0-9.-]+(:[0-9]{2,5})?(/[^\s]*)?$' AND char_length(url) <= 500
    AND url !~ '^https://(\d{1,3}\.){3}\d{1,3}' AND url !~* '^https://(localhost|[^/]*\.(local|internal|localhost))(:|/|$)'),
  events text[] NOT NULL CHECK (cardinality(events) >= 1 AND events <@ ARRAY['contact.created', 'conversation.created',
    'conversation.stage_changed', 'ticket.closed', 'message.received']),
  active boolean NOT NULL DEFAULT true,
  failures integer NOT NULL DEFAULT 0,
  last_status integer,
  last_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);
CREATE INDEX IF NOT EXISTS webhook_endpoints_org_idx ON public.webhook_endpoints (organization_id) WHERE active;
ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhook_endpoints FROM anon, authenticated;
GRANT SELECT ON public.webhook_endpoints TO authenticated;
GRANT ALL ON public.webhook_endpoints TO service_role;
DROP POLICY IF EXISTS "org: ver" ON public.webhook_endpoints;
CREATE POLICY "org: ver" ON public.webhook_endpoints FOR SELECT TO authenticated USING (private.has_permission(organization_id, 'org.settings'));

CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL,
  endpoint_id uuid NOT NULL,
  event text NOT NULL,
  payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 16000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_at timestamptz NOT NULL DEFAULT now(),
  response_code integer,
  error text CHECK (error IS NULL OR char_length(error) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CONSTRAINT webhook_deliveries_endpoint_fk FOREIGN KEY (endpoint_id, organization_id)
    REFERENCES public.webhook_endpoints (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx ON public.webhook_deliveries (next_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS webhook_deliveries_endpoint_idx ON public.webhook_deliveries (endpoint_id, created_at DESC);
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webhook_deliveries FROM anon, authenticated;
GRANT SELECT ON public.webhook_deliveries TO authenticated;
GRANT ALL ON public.webhook_deliveries TO service_role;
DROP POLICY IF EXISTS "org: ver" ON public.webhook_deliveries;
CREATE POLICY "org: ver" ON public.webhook_deliveries FOR SELECT TO authenticated USING (private.has_permission(organization_id, 'org.settings'));

CREATE OR REPLACE FUNCTION public.save_webhook_endpoint(org uuid, endpoint uuid, p_url text, p_events text[], p_active boolean)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE nid uuid; sec text;
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF endpoint IS NULL THEN
    IF (SELECT count(*) FROM public.webhook_endpoints WHERE organization_id = org) >= 10 THEN
      RAISE EXCEPTION 'limite de 10 endereços de webhook' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.webhook_endpoints (organization_id, url, events, active) VALUES (org, btrim(p_url), p_events, coalesce(p_active, true))
    RETURNING id INTO nid;
    sec := 'whsec_' || encode(extensions.gen_random_bytes(24), 'hex');
    PERFORM private.put_secret('webhook:' || nid || ':secret', sec);
    PERFORM private.audit(org, 'webhook.created', nid::text, jsonb_build_object('events', p_events));
    RETURN jsonb_build_object('id', nid, 'secret', sec);
  END IF;
  UPDATE public.webhook_endpoints SET url = btrim(p_url), events = p_events, active = coalesce(p_active, true),
    failures = CASE WHEN coalesce(p_active, true) THEN 0 ELSE failures END
  WHERE id = endpoint AND organization_id = org RETURNING id INTO nid;
  IF nid IS NULL THEN RAISE EXCEPTION 'endereço não encontrado' USING ERRCODE = '42501'; END IF;
  PERFORM private.audit(org, 'webhook.saved', nid::text, jsonb_build_object('events', p_events, 'active', p_active));
  RETURN jsonb_build_object('id', nid);
END $$;
REVOKE ALL ON FUNCTION public.save_webhook_endpoint(uuid, uuid, text, text[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_webhook_endpoint(uuid, uuid, text, text[], boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_webhook_endpoint(endpoint uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e public.webhook_endpoints;
BEGIN
  SELECT * INTO e FROM public.webhook_endpoints WHERE id = endpoint;
  IF e.id IS NULL OR NOT private.has_permission(e.organization_id, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.webhook_endpoints WHERE id = endpoint;
  DELETE FROM vault.secrets WHERE name = 'webhook:' || endpoint || ':secret';
  PERFORM private.audit(e.organization_id, 'webhook.deleted', endpoint::text, '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.delete_webhook_endpoint(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_webhook_endpoint(uuid) TO authenticated;

-- Enfileira um evento para os endereços ativos da empresa que pediram esse evento.
CREATE OR REPLACE FUNCTION private.enqueue_webhook(org uuid, ev text, data jsonb)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.webhook_deliveries (organization_id, endpoint_id, event, payload)
  SELECT org, e.id, ev, jsonb_build_object('event', ev, 'organization_id', org, 'created_at', now(), 'data', data)
  FROM public.webhook_endpoints e WHERE e.organization_id = org AND e.active AND ev = ANY (e.events)
$$;
REVOKE ALL ON FUNCTION private.enqueue_webhook(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.test_webhook_endpoint(endpoint uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e public.webhook_endpoints;
BEGIN
  SELECT * INTO e FROM public.webhook_endpoints WHERE id = endpoint;
  IF e.id IS NULL OR NOT private.has_permission(e.organization_id, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.webhook_deliveries (organization_id, endpoint_id, event, payload)
  VALUES (e.organization_id, e.id, 'ping', jsonb_build_object('event', 'ping', 'organization_id', e.organization_id, 'created_at', now(),
          'data', jsonb_build_object('message', 'Teste do Deixa com a IA')));
END $$;
REVOKE ALL ON FUNCTION public.test_webhook_endpoint(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.test_webhook_endpoint(uuid) TO authenticated;

-- Gatilhos dos eventos (só fazem algo quando a empresa tem endereço ativo).
CREATE OR REPLACE FUNCTION private.webhook_on_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE org uuid := NEW.organization_id;
BEGIN
  IF org IS NULL OR NOT EXISTS (SELECT 1 FROM public.webhook_endpoints WHERE organization_id = org AND active) THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME = 'contacts' THEN
    PERFORM private.enqueue_webhook(org, 'contact.created',
      jsonb_build_object('id', NEW.id, 'name', NEW.name, 'phone', NEW.phone, 'email', NEW.email));
  ELSIF TG_TABLE_NAME = 'conversations' AND TG_OP = 'INSERT' THEN
    PERFORM private.enqueue_webhook(org, 'conversation.created',
      jsonb_build_object('id', NEW.id, 'channel', NEW.channel, 'contact_id', NEW.contact_id, 'contact_name', NEW.contact_name,
        'contact_phone', NEW.contact_phone, 'contact_email', NEW.contact_email));
  ELSIF TG_TABLE_NAME = 'conversations' AND NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    PERFORM private.enqueue_webhook(org, 'conversation.stage_changed',
      jsonb_build_object('id', NEW.id, 'contact_id', NEW.contact_id, 'contact_name', NEW.contact_name, 'contact_phone', NEW.contact_phone,
        'stage_id', NEW.stage_id, 'stage', (SELECT name FROM public.pipeline_stages WHERE id = NEW.stage_id AND organization_id = org),
        'previous_stage_id', OLD.stage_id));
  ELSIF TG_TABLE_NAME = 'tickets' AND NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
    PERFORM private.enqueue_webhook(org, 'ticket.closed',
      jsonb_build_object('id', NEW.id, 'protocol', NEW.protocol, 'conversation_id', NEW.conversation_id,
        'close_reason', (SELECT name FROM public.close_reasons WHERE id = NEW.close_reason_id AND organization_id = org), 'closed_at', NEW.closed_at));
  ELSIF TG_TABLE_NAME = 'messages' AND NEW.direction = 'inbound' THEN
    PERFORM private.enqueue_webhook(org, 'message.received',
      jsonb_build_object('id', NEW.id, 'conversation_id', NEW.conversation_id, 'type', coalesce(NEW.type, 'text'),
        'text', left(NEW.content, 4000), 'created_at', NEW.created_at));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS contacts_webhook ON public.contacts;
CREATE TRIGGER contacts_webhook AFTER INSERT ON public.contacts FOR EACH ROW EXECUTE FUNCTION private.webhook_on_change();
DROP TRIGGER IF EXISTS conversations_webhook_ins ON public.conversations;
CREATE TRIGGER conversations_webhook_ins AFTER INSERT ON public.conversations FOR EACH ROW EXECUTE FUNCTION private.webhook_on_change();
DROP TRIGGER IF EXISTS conversations_webhook_stage ON public.conversations;
CREATE TRIGGER conversations_webhook_stage AFTER UPDATE OF stage_id ON public.conversations FOR EACH ROW EXECUTE FUNCTION private.webhook_on_change();
DROP TRIGGER IF EXISTS tickets_webhook ON public.tickets;
CREATE TRIGGER tickets_webhook AFTER UPDATE OF status ON public.tickets FOR EACH ROW EXECUTE FUNCTION private.webhook_on_change();
DROP TRIGGER IF EXISTS messages_webhook ON public.messages;
CREATE TRIGGER messages_webhook AFTER INSERT ON public.messages FOR EACH ROW WHEN (NEW.direction = 'inbound') EXECUTE FUNCTION private.webhook_on_change();

-- Servidor: pega até N entregas vencidas (cada uma uma vez) com o endereço.
CREATE OR REPLACE FUNCTION public.service_webhook_claim(lim integer)
RETURNS TABLE (id bigint, organization_id uuid, endpoint_id uuid, url text, event text, payload jsonb, attempts integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Entrega presa em "enviando" (função caiu) volta para a fila.
  UPDATE public.webhook_deliveries SET status = 'pending' WHERE status = 'sending' AND next_at < now() - interval '5 minutes';
  RETURN QUERY
  WITH due AS (
    SELECT d.id FROM public.webhook_deliveries d
    WHERE d.status = 'pending' AND d.next_at <= now()
    ORDER BY d.next_at LIMIT least(greatest(coalesce(lim, 50), 1), 200)
    FOR UPDATE SKIP LOCKED)
  UPDATE public.webhook_deliveries d SET status = 'sending', next_at = now()
  FROM due, public.webhook_endpoints e
  WHERE d.id = due.id AND e.id = d.endpoint_id AND e.organization_id = d.organization_id
  RETURNING d.id, d.organization_id, d.endpoint_id, e.url, d.event, d.payload, d.attempts;
END $$;
REVOKE ALL ON FUNCTION public.service_webhook_claim(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_webhook_claim(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.service_webhook_result(delivery bigint, ok boolean, code integer, err text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.webhook_deliveries; e public.webhook_endpoints;
BEGIN
  SELECT * INTO d FROM public.webhook_deliveries WHERE id = delivery;
  IF d.id IS NULL THEN RETURN; END IF;
  IF ok THEN
    UPDATE public.webhook_deliveries SET status = 'sent', attempts = attempts + 1, response_code = code, error = NULL, sent_at = now() WHERE id = delivery;
    UPDATE public.webhook_endpoints SET failures = 0, last_status = code, last_at = now() WHERE id = d.endpoint_id;
    RETURN;
  END IF;
  UPDATE public.webhook_deliveries SET attempts = attempts + 1, response_code = code, error = left(err, 300),
    status = CASE WHEN attempts + 1 >= 6 THEN 'failed' ELSE 'pending' END,
    next_at = now() + (ARRAY[interval '1 minute', interval '5 minutes', interval '15 minutes', interval '1 hour', interval '4 hours', interval '12 hours'])[least(attempts + 1, 6)]
  WHERE id = delivery;
  UPDATE public.webhook_endpoints SET failures = failures + 1, last_status = code, last_at = now() WHERE id = d.endpoint_id RETURNING * INTO e;
  IF e.failures >= 20 AND e.active THEN
    UPDATE public.webhook_endpoints SET active = false WHERE id = e.id;
    INSERT INTO public.notifications (organization_id, user_id, kind, ref)
    SELECT e.organization_id, m.user_id, 'webhook_paused', jsonb_build_object('url', left(e.url, 120))
    FROM public.organization_members m WHERE m.organization_id = e.organization_id AND m.status = 'active' AND m.role IN ('owner', 'admin');
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.service_webhook_result(bigint, boolean, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_webhook_result(bigint, boolean, integer, text) TO service_role;

-- Cron a cada minuto: só chama o envio quando há fila; limpa o que tem mais de 30 dias.
CREATE OR REPLACE FUNCTION private.webhooks_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text;
BEGIN
  DELETE FROM public.webhook_deliveries WHERE created_at < now() - interval '30 days';
  IF NOT EXISTS (SELECT 1 FROM public.webhook_deliveries WHERE status = 'pending' AND next_at <= now()) THEN RETURN; END IF;
  SELECT value INTO base FROM public.app_settings WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'platform:cron_secret';
  IF coalesce(base, '') = '' OR secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := base || '/webhooks-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
END $$;
REVOKE ALL ON FUNCTION private.webhooks_tick() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'webhooks-dispatch') THEN PERFORM cron.unschedule('webhooks-dispatch'); END IF;
    PERFORM cron.schedule('webhooks-dispatch', '* * * * *', 'SELECT private.webhooks_tick()');
  END IF;
END $$;
