-- =============================================================================
-- Cérebro: e-mail opcional (organizations.settings.brain_email, desligado por padrão).
-- Com a opção ligada, também vão por e-mail (para a própria pessoa avisada):
--   brain_weekly (resumo pronto, para dono/admin), brain_goal (meta fora do rumo) e
--   brain_reminder escalado ao dono. Os demais avisos seguem como antes.
-- Idempotente.
-- =============================================================================
CREATE OR REPLACE FUNCTION private.email_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text;
BEGIN
  IF NEW.kind NOT IN ('number_health', 'email_health', 'security_alert', 'brain_weekly', 'brain_goal', 'brain_reminder') THEN RETURN NULL; END IF;
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
