-- =============================================================================
-- Chamados: número de protocolo (CH-000001) e resposta automática ao cliente.
--  * protocol: gerado no banco ao abrir (sequência própria; o navegador não escolhe).
--  * Ao abrir: aviso + e-mail para a equipe Clubetec (todos os chamados, não só os
--    urgentes) e confirmação automática para quem abriu ("recebemos, protocolo nº…"),
--    com o prazo do SLA quando ele estiver definido em app_settings.support_sla
--    ({"urgente":2,"alta":8,"media":24,"baixa":72} em horas — ainda não definido).
--  * Mudança de situação/resposta da equipe também vai por e-mail para quem abriu.
-- Idempotente.
-- =============================================================================
CREATE SEQUENCE IF NOT EXISTS public.service_request_protocol_seq;
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS protocol text;
UPDATE public.service_requests SET protocol = 'CH-' || lpad(nextval('public.service_request_protocol_seq')::text, 6, '0')
WHERE protocol IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS service_requests_protocol_key ON public.service_requests (protocol);
REVOKE ALL ON SEQUENCE public.service_request_protocol_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.service_request_defaults()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  NEW.protocol := 'CH-' || lpad(nextval('public.service_request_protocol_seq')::text, 6, '0');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.service_request_defaults() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS service_request_defaults ON public.service_requests;
CREATE TRIGGER service_request_defaults BEFORE INSERT ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION private.service_request_defaults();

-- Chamado novo → equipe Clubetec (sino + e-mail) e confirmação automática para quem abriu.
CREATE OR REPLACE FUNCTION private.on_service_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE sla int;
BEGIN
  PERFORM private.notify_platform_operators('support_ticket', jsonb_strip_nulls(jsonb_build_object(
    'id', NEW.id, 'protocol', NEW.protocol, 'org', (SELECT name FROM public.organizations WHERE id = NEW.organization_id),
    'topic', left(NEW.topic, 120), 'urgency', NEW.urgency, 'source', NEW.source)));
  IF NEW.created_by IS NOT NULL AND EXISTS (SELECT 1 FROM public.organization_members
      WHERE organization_id = NEW.organization_id AND user_id = NEW.created_by AND status = 'active') THEN
    BEGIN -- SLA mal escrito nunca impede o chamado de ser aberto
      SELECT CASE WHEN (value::jsonb ->> NEW.urgency) ~ '^[0-9]{1,4}$' THEN (value::jsonb ->> NEW.urgency)::int END INTO sla
      FROM public.app_settings WHERE key = 'support_sla';
    EXCEPTION WHEN others THEN sla := NULL;
    END;
    INSERT INTO public.notifications (organization_id, user_id, kind, ref)
    VALUES (NEW.organization_id, NEW.created_by, 'support_received', jsonb_strip_nulls(jsonb_build_object(
      'id', NEW.id, 'protocol', NEW.protocol, 'topic', left(NEW.topic, 120), 'urgency', NEW.urgency, 'sla_hours', sla)));
  END IF;
  RETURN NULL;
END $$;

-- E-mail: todo chamado para a equipe; confirmação e mudanças para quem abriu.
CREATE OR REPLACE FUNCTION private.email_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text;
BEGIN
  IF NEW.kind NOT IN ('number_health', 'email_health', 'security_alert', 'brain_weekly', 'brain_goal', 'brain_reminder',
                      'support_ticket', 'support_received', 'support_status') THEN RETURN NULL; END IF;
  IF NEW.kind LIKE 'brain_%' THEN
    IF NOT coalesce((SELECT (settings ->> 'brain_email')::boolean FROM public.organizations WHERE id = NEW.organization_id), false) THEN RETURN NULL; END IF;
    IF NEW.kind = 'brain_reminder' AND NOT coalesce((NEW.ref ->> 'escalado')::boolean, false) THEN RETURN NULL; END IF;
  END IF;
  SELECT value INTO base FROM public.app_settings WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'platform:cron_secret';
  IF coalesce(base, '') = '' OR secret IS NULL THEN RETURN NULL; END IF;
  PERFORM net.http_post(
    url := base || '/notify-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := jsonb_build_object('notification_id', NEW.id));
  RETURN NULL;
END $$;

-- Aviso de mudança leva o protocolo.
CREATE OR REPLACE FUNCTION public.platform_set_request_status(request uuid, new_status text, p_reply text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.service_requests;
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF new_status NOT IN ('open', 'in_progress', 'done', 'canceled') THEN RAISE EXCEPTION 'situação inválida' USING ERRCODE = '22023'; END IF;
  UPDATE public.service_requests
  SET status = new_status, reply = coalesce(nullif(left(btrim(coalesce(p_reply, '')), 2000), ''), reply), updated_at = now()
  WHERE id = request RETURNING * INTO r;
  IF r.id IS NULL THEN RAISE EXCEPTION 'pedido não encontrado' USING ERRCODE = '22023'; END IF;
  IF r.created_by IS NOT NULL AND EXISTS (SELECT 1 FROM public.organization_members
                                          WHERE organization_id = r.organization_id AND user_id = r.created_by AND status = 'active') THEN
    INSERT INTO public.notifications (organization_id, user_id, kind, ref)
    VALUES (r.organization_id, r.created_by, 'support_status', jsonb_strip_nulls(jsonb_build_object(
      'id', r.id, 'protocol', r.protocol, 'topic', left(r.topic, 120), 'status', new_status, 'reply', left(r.reply, 200))));
  END IF;
  PERFORM private.audit(r.organization_id, 'platform.request_status', request::text, jsonb_build_object('status', new_status, 'reply', p_reply IS NOT NULL));
END $$;
REVOKE ALL ON FUNCTION public.platform_set_request_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_request_status(uuid, text, text) TO authenticated;
