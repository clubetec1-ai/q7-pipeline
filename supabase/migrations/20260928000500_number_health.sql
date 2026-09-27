-- =============================================================================
-- Saúde dos números (spec números §9)
--  * check-numbers: cron a cada 15 min (pg_net + x-cron-secret) consulta Meta /
--    Uazapi e grava health_status ('ok' | 'warning' | 'critical').
--  * Piorou (saúde ou desconexão) → notificação para owner/admin, uma por
--    mudança de estado (gatilho compara OLD/NEW; checagem igual não repete).
--  * number_activity: último evento recebido por número (tela Números).
-- Idempotente.
-- =============================================================================

CREATE OR REPLACE FUNCTION private.health_rank(h text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE h WHEN 'critical' THEN 2 WHEN 'warning' THEN 1 ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION private.notify_number_health()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'disabled' THEN RETURN NULL; END IF; -- desligado por alguém da equipe
  IF private.health_rank(NEW.health_status) > private.health_rank(OLD.health_status)
     OR (NEW.status = 'disconnected' AND OLD.status NOT IN ('disconnected', 'disabled')) THEN
    INSERT INTO public.notifications (organization_id, user_id, kind, ref)
    SELECT NEW.organization_id, m.user_id, 'number_health',
           jsonb_strip_nulls(jsonb_build_object('instance_id', NEW.id, 'name', NEW.name,
             'health', NEW.health_status, 'status', NEW.status, 'error', left(NEW.health_error, 200)))
    FROM public.organization_members m
    WHERE m.organization_id = NEW.organization_id AND m.status = 'active' AND m.role IN ('owner', 'admin');
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.notify_number_health() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS notify_number_health ON public.whatsapp_instances;
CREATE TRIGGER notify_number_health AFTER UPDATE OF health_status, status ON public.whatsapp_instances
  FOR EACH ROW EXECUTE FUNCTION private.notify_number_health();

-- Webhook de conexão da Uazapi também reflete na saúde.
CREATE OR REPLACE FUNCTION private.health_from_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'disconnected' THEN
      NEW.health_status := 'critical';
      NEW.health_error := coalesce(NEW.health_error, 'Número desconectado');
    ELSIF NEW.status = 'connected' AND OLD.status = 'disconnected' THEN
      NEW.health_status := 'ok';
      NEW.health_error := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.health_from_status() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS health_from_status ON public.whatsapp_instances;
CREATE TRIGGER health_from_status BEFORE UPDATE OF status ON public.whatsapp_instances
  FOR EACH ROW EXECUTE FUNCTION private.health_from_status();

-- Cron: check-numbers a cada 15 minutos.
CREATE OR REPLACE FUNCTION private.check_numbers_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text;
BEGIN
  SELECT value INTO base FROM public.app_settings WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'platform:cron_secret';
  IF coalesce(base, '') = '' OR secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := base || '/check-numbers',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
END $$;
REVOKE ALL ON FUNCTION private.check_numbers_tick() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-numbers') THEN
    PERFORM cron.unschedule('check-numbers');
  END IF;
  PERFORM cron.schedule('check-numbers', '*/15 * * * *', 'SELECT private.check_numbers_tick()');
END $$;

-- Último evento recebido por número (só org.settings).
CREATE OR REPLACE FUNCTION public.number_activity(org uuid)
RETURNS TABLE (instance_id uuid, last_inbound_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT c.instance_id, max(c.last_inbound_at) FROM public.conversations c
    WHERE c.organization_id = org AND c.instance_id IS NOT NULL GROUP BY c.instance_id;
END $$;
REVOKE ALL ON FUNCTION public.number_activity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.number_activity(uuid) TO authenticated;
