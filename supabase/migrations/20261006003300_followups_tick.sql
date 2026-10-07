-- Cota das funções (achado da análise de 06/10): a rotina dos retornos chamava a função run-followups todo minuto,
-- mesmo sem nada para enviar (~1.200 chamadas/dia à toa). Agora o banco só chama quando há retorno vencido, como as
-- outras rotinas. Idempotente.
CREATE OR REPLACE FUNCTION private.run_followups_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.followups WHERE status = 'pending' AND send_at <= now()) THEN RETURN; END IF;
  SELECT value INTO base FROM public.app_settings WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'platform:cron_secret';
  IF coalesce(base, '') = '' OR secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := base || '/run-followups',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
END $$;
REVOKE ALL ON FUNCTION private.run_followups_tick() FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS followups_pending_due_idx ON public.followups (send_at) WHERE status = 'pending';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'run-followups-every-minute';
    PERFORM cron.schedule('run-followups-every-minute', '* * * * *', 'SELECT private.run_followups_tick()');
  END IF;
END $$;
