-- =============================================================================
-- E-mails do sistema (Resend) — alertas por e-mail
--  * Chave em Vault: platform:resend_api_key. Remetente em app_settings.email_from
--    (ex.: 'ClubeCRM <avisos@seudominio.com.br>'). Sem os dois, nada é enviado.
--  * Notificação de certos tipos → notify-email (pg_net + x-cron-secret).
--    emailed_at evita envio duplicado.
-- Idempotente.
-- =============================================================================

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS emailed_at timestamptz;

CREATE OR REPLACE FUNCTION private.email_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text;
BEGIN
  IF NEW.kind NOT IN ('number_health') THEN RETURN NULL; END IF;
  SELECT value INTO base FROM public.app_settings WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'platform:cron_secret';
  IF coalesce(base, '') = '' OR secret IS NULL THEN RETURN NULL; END IF;
  PERFORM net.http_post(
    url := base || '/notify-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := jsonb_build_object('notification_id', NEW.id));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.email_notification() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS email_notification ON public.notifications;
CREATE TRIGGER email_notification AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION private.email_notification();
