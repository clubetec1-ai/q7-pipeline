-- =============================================================================
-- Chamados de suporte (service_requests vira o "ticket"):
--  * urgency (baixa/media/alta/urgente), source (manual/assistente/integracao), page
--    (tela onde a pessoa estava) e transcript (conversa com o assistente, quando foi ele
--    que abriu o chamado por "não resolveu").
--  * Chamado novo avisa os operadores da Clubetec (sino; e-mail se alta/urgente).
--  * Mudança de situação avisa quem abriu (sino) e grava resposta da equipe (reply).
-- Idempotente.
-- =============================================================================
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS urgency text NOT NULL DEFAULT 'media';
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS page text;
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS transcript jsonb;
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS reply text;
ALTER TABLE public.service_requests ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_requests_urgency_check') THEN
    ALTER TABLE public.service_requests ADD CONSTRAINT service_requests_urgency_check CHECK (urgency IN ('baixa', 'media', 'alta', 'urgente'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_requests_source_check') THEN
    ALTER TABLE public.service_requests ADD CONSTRAINT service_requests_source_check CHECK (source IN ('manual', 'assistente', 'integracao'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_requests_extra_check') THEN
    ALTER TABLE public.service_requests ADD CONSTRAINT service_requests_extra_check CHECK (
      (page IS NULL OR char_length(page) <= 80) AND (reply IS NULL OR char_length(reply) <= 2000)
      AND (transcript IS NULL OR (jsonb_typeof(transcript) = 'array' AND octet_length(transcript::text) <= 20000)));
  END IF;
END $$;
-- O navegador escolhe urgência e tela no chamado manual; origem, conversa e resposta só pelo servidor.
REVOKE INSERT ON public.service_requests FROM authenticated;
GRANT INSERT (organization_id, guide_id, topic, message, created_by, urgency, page) ON public.service_requests TO authenticated;

-- Chamado novo → operadores da Clubetec.
CREATE OR REPLACE FUNCTION private.on_service_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.notify_platform_operators('support_ticket', jsonb_strip_nulls(jsonb_build_object(
    'id', NEW.id, 'org', (SELECT name FROM public.organizations WHERE id = NEW.organization_id),
    'topic', left(NEW.topic, 120), 'urgency', NEW.urgency, 'source', NEW.source)));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.on_service_request() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS on_service_request ON public.service_requests;
CREATE TRIGGER on_service_request AFTER INSERT ON public.service_requests FOR EACH ROW EXECUTE FUNCTION private.on_service_request();

-- Operador muda a situação e pode responder; quem abriu é avisado.
DROP FUNCTION IF EXISTS public.platform_set_request_status(uuid, text);
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
      'id', r.id, 'topic', left(r.topic, 120), 'status', new_status, 'reply', left(r.reply, 200))));
  END IF;
  PERFORM private.audit(r.organization_id, 'platform.request_status', request::text, jsonb_build_object('status', new_status, 'reply', p_reply IS NOT NULL));
END $$;
REVOKE ALL ON FUNCTION public.platform_set_request_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_request_status(uuid, text, text) TO authenticated;

-- E-mail para os operadores quando o chamado é alta/urgente.
CREATE OR REPLACE FUNCTION private.email_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text;
BEGIN
  IF NEW.kind NOT IN ('number_health', 'email_health', 'security_alert', 'brain_weekly', 'brain_goal', 'brain_reminder', 'support_ticket') THEN RETURN NULL; END IF;
  IF NEW.kind = 'support_ticket' AND coalesce(NEW.ref ->> 'urgency', '') NOT IN ('alta', 'urgente') THEN RETURN NULL; END IF;
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
