-- =============================================================================
-- ClubeCRM — aviso ao cliente de quem assumiu o atendimento.
-- O botão "Assumir" envia pela tela (send-message). Distribuição automática e
-- transferência direta para uma pessoa disparam a Edge Function
-- ticket-greeting pelo pg_net (assíncrono, não trava a transação).
-- Texto por organização: organizations.settings.claim_greeting ({nome}); vazio
-- desliga. Idempotente.
-- =============================================================================

CREATE OR REPLACE FUNCTION private.greet_async()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text;
BEGIN
  IF NOT (NEW.type = 'assigned' OR (NEW.type = 'transferred' AND NEW.meta ->> 'to_user' IS NOT NULL)) THEN
    RETURN NULL;
  END IF;
  -- URL das funções deste projeto (app_settings da plataforma). Sem ela, não avisa.
  SELECT value INTO base FROM public.app_settings WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'platform:cron_secret';
  IF coalesce(base, '') = '' OR secret IS NULL THEN RETURN NULL; END IF;
  PERFORM net.http_post(
    url := base || '/ticket-greeting',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := jsonb_build_object('ticket_id', NEW.ticket_id));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.greet_async() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS greet_async ON public.ticket_events;
CREATE TRIGGER greet_async AFTER INSERT ON public.ticket_events
  FOR EACH ROW EXECUTE FUNCTION private.greet_async();
