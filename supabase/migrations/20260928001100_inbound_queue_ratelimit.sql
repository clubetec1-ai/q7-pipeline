-- =============================================================================
-- 1C-2 — fila de mensagens recebidas em uso e limite de IA por organização
--  * process-inbound: cron a cada minuto, só chama se houver evento a reprocessar.
--  * service_ai_take: respostas de IA por minuto por organização
--    (settings.ai_rate_limit_per_minute, padrão 30). Excedeu → a mensagem fica na
--    fila e a resposta é refeita depois (um cliente com pico não atrasa os outros).
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.org_rate_usage (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  bucket text NOT NULL,
  minute timestamptz NOT NULL,
  n integer NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, bucket, minute)
);
ALTER TABLE public.org_rate_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.org_rate_usage FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.service_ai_take(org uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE used integer; lim integer;
BEGIN
  SELECT coalesce(nullif(settings ->> 'ai_rate_limit_per_minute', '')::integer, 30) INTO lim
  FROM public.organizations WHERE id = org;
  INSERT INTO public.org_rate_usage (organization_id, bucket, minute, n)
  VALUES (org, 'ai', date_trunc('minute', now()), 1)
  ON CONFLICT (organization_id, bucket, minute) DO UPDATE SET n = public.org_rate_usage.n + 1
  RETURNING n INTO used;
  DELETE FROM public.org_rate_usage WHERE organization_id = org AND minute < now() - interval '10 minutes';
  RETURN used <= greatest(coalesce(lim, 30), 1);
EXCEPTION WHEN invalid_text_representation THEN
  RETURN true; -- configuração inválida não pode parar o atendimento
END $$;
REVOKE ALL ON FUNCTION public.service_ai_take(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_ai_take(uuid) TO service_role;

CREATE OR REPLACE FUNCTION private.process_inbound_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.inbound_events
                 WHERE ((status IN ('pending', 'failed') AND created_at < now() - interval '30 seconds')
                        OR (status = 'processing' AND claimed_at < now() - interval '5 minutes'))
                   AND attempts < 5) THEN
    RETURN;
  END IF;
  SELECT value INTO base FROM public.app_settings WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'platform:cron_secret';
  IF coalesce(base, '') = '' OR secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := base || '/process-inbound',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
END $$;
REVOKE ALL ON FUNCTION private.process_inbound_tick() FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-inbound') THEN PERFORM cron.unschedule('process-inbound'); END IF;
  PERFORM cron.schedule('process-inbound', '* * * * *', 'SELECT private.process_inbound_tick()');
END $$;
