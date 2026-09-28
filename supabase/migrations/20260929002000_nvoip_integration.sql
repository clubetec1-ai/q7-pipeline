-- =============================================================================
-- Telefonia Nvoip, fase 2 (pedido em 29/09)
--  * Credencial OAuth (Client ID + segredo) por empresa, só no Vault; o dono/admin
--    cola em Integrações. O navegador nunca lê de volta.
--  * Clique-para-ligar pela API: a Nvoip toca o ramal (MicroSIP) e depois o cliente.
--  * Histórico de ligações puxado a cada 5 min (cron) → tabela calls, ligado ao
--    cliente e ao ramal/atendente; perdida vira aviso para o atendente do ramal.
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.voice_integrations (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'nvoip' CHECK (provider IN ('nvoip')),
  enabled boolean NOT NULL DEFAULT true,
  has_credentials boolean NOT NULL DEFAULT false,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS update_voice_integrations_updated_at ON public.voice_integrations;
CREATE TRIGGER update_voice_integrations_updated_at BEFORE UPDATE ON public.voice_integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
ALTER TABLE public.voice_integrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.voice_integrations FROM anon, authenticated;
GRANT SELECT ON public.voice_integrations TO authenticated;
DROP POLICY IF EXISTS voice_integrations_select ON public.voice_integrations;
CREATE POLICY voice_integrations_select ON public.voice_integrations FOR SELECT TO authenticated
  USING (private.has_permission(organization_id, 'org.settings') OR private.is_platform_operator());

-- Dono/admin grava a credencial (vazio = mantém). enabled=false desliga sem apagar.
CREATE OR REPLACE FUNCTION public.set_voice_integration(org uuid, p_client_id text, p_client_secret text, p_enabled boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  IF length(coalesce(p_client_id, '')) > 200 OR length(coalesce(p_client_secret, '')) > 500 THEN
    RAISE EXCEPTION 'valor longo demais' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.voice_integrations (organization_id) VALUES (org) ON CONFLICT (organization_id) DO NOTHING;
  IF coalesce(trim(p_client_id), '') <> '' THEN PERFORM private.put_secret(format('org:%s:nvoip_client_id', org), trim(p_client_id)); END IF;
  IF coalesce(trim(p_client_secret), '') <> '' THEN PERFORM private.put_secret(format('org:%s:nvoip_client_secret', org), trim(p_client_secret)); END IF;
  UPDATE public.voice_integrations SET enabled = coalesce(p_enabled, true), last_error = NULL,
    has_credentials = EXISTS (SELECT 1 FROM vault.secrets WHERE name = format('org:%s:nvoip_client_id', org))
                  AND EXISTS (SELECT 1 FROM vault.secrets WHERE name = format('org:%s:nvoip_client_secret', org))
  WHERE organization_id = org;
  PERFORM private.audit(org, 'voice.integration_set', 'nvoip',
    jsonb_build_object('enabled', coalesce(p_enabled, true), 'credentials_changed', coalesce(trim(p_client_id), '') || coalesce(trim(p_client_secret), '') <> ''));
END $$;
REVOKE ALL ON FUNCTION public.set_voice_integration(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_voice_integration(uuid, text, text, boolean) TO authenticated;

-- Ligações vindas da central.
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS provider_call_id text,
  ADD COLUMN IF NOT EXISTS recording_url text;
CREATE UNIQUE INDEX IF NOT EXISTS calls_provider_call_uidx ON public.calls (organization_id, provider_call_id) WHERE provider_call_id IS NOT NULL;

-- Ramal pode ligar pela API? (entra no my_extension para o telefone decidir)
CREATE OR REPLACE FUNCTION public.my_extension(org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e public.pbx_extensions;
BEGIN
  IF NOT private.has_permission(org, 'conversations.attend') THEN RETURN NULL; END IF;
  SELECT * INTO e FROM public.pbx_extensions WHERE organization_id = org AND user_id = (SELECT auth.uid());
  IF e.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id', e.id, 'number', e.number, 'sip_user', e.sip_user, 'sip_domain', e.sip_domain,
    'wss_url', e.wss_url, 'provider', e.provider, 'mode', e.mode, 'has_password', e.has_password,
    'click_to_call', EXISTS (SELECT 1 FROM public.voice_integrations v WHERE v.organization_id = org
                             AND v.enabled AND v.has_credentials AND v.provider = e.provider),
    'password', CASE WHEN e.mode = 'webrtc' AND e.wss_url IS NOT NULL
                     THEN private.get_secret(format('ext:%s:password', e.id)) END);
END $$;

-- Grava uma ligação da central (Edge Function, service_role). Idempotente pelo id da central.
CREATE OR REPLACE FUNCTION public.service_upsert_call(
  org uuid, p_provider_call_id text, p_direction text, p_phone text, p_ext_number text, p_status text,
  p_started_at timestamptz, p_answered_at timestamptz, p_ended_at timestamptz, p_duration integer,
  p_recording_url text, p_user uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  ex public.pbx_extensions; ct uuid; rid uuid; was text;
BEGIN
  IF coalesce(p_provider_call_id, '') = '' OR length(digits) < 2 OR p_direction NOT IN ('in', 'out')
     OR p_status NOT IN ('ringing', 'answered', 'missed', 'ended', 'failed') THEN
    RETURN NULL;
  END IF;
  SELECT * INTO ex FROM public.pbx_extensions WHERE organization_id = org
    AND (number = regexp_replace(coalesce(p_ext_number, ''), '\D', '', 'g') OR sip_user = coalesce(p_ext_number, ''))
  LIMIT 1;
  IF length(digits) >= 8 THEN
    SELECT id INTO ct FROM public.contacts
    WHERE organization_id = org AND anonymized_at IS NULL
      AND right(regexp_replace(phone, '\D', '', 'g'), 8) = right(digits, 8)
    ORDER BY (regexp_replace(phone, '\D', '', 'g') LIKE '%' || right(digits, 10)) DESC, updated_at DESC LIMIT 1;
  END IF;
  SELECT id, status INTO rid, was FROM public.calls WHERE organization_id = org AND provider_call_id = p_provider_call_id;
  IF rid IS NULL THEN
    INSERT INTO public.calls (organization_id, extension_id, user_id, direction, phone, contact_id, status, source,
      started_at, answered_at, ended_at, duration_s, provider_call_id, recording_url)
    VALUES (org, ex.id, coalesce(p_user, ex.user_id), p_direction, left(digits, 20), ct, p_status, 'pbx',
      coalesce(p_started_at, now()), p_answered_at, p_ended_at, CASE WHEN p_duration BETWEEN 0 AND 86400 THEN p_duration END,
      p_provider_call_id, nullif(p_recording_url, ''))
    RETURNING id INTO rid;
  ELSE
    UPDATE public.calls SET status = p_status, answered_at = coalesce(answered_at, p_answered_at),
      ended_at = coalesce(p_ended_at, ended_at),
      duration_s = coalesce(CASE WHEN p_duration BETWEEN 0 AND 86400 THEN p_duration END, duration_s),
      recording_url = coalesce(nullif(p_recording_url, ''), recording_url),
      extension_id = coalesce(extension_id, ex.id), user_id = coalesce(user_id, p_user, ex.user_id)
    WHERE id = rid;
  END IF;
  -- Perdida (entrada não atendida): avisa o atendente do ramal uma vez.
  IF p_direction = 'in' AND p_status = 'missed' AND was IS DISTINCT FROM 'missed' AND coalesce(ex.user_id, p_user) IS NOT NULL THEN
    INSERT INTO public.notifications (organization_id, user_id, kind, ref)
    VALUES (org, coalesce(ex.user_id, p_user), 'missed_call', jsonb_build_object('call_id', rid, 'phone', left(digits, 20), 'contact_id', ct));
  END IF;
  RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.service_upsert_call(uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz, integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_upsert_call(uuid, text, text, text, text, text, timestamptz, timestamptz, timestamptz, integer, text, uuid) TO service_role;

-- Cron: sincroniza o histórico a cada 5 min, só se houver integração ativa.
CREATE OR REPLACE FUNCTION private.calls_sync_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.voice_integrations WHERE enabled AND has_credentials) THEN RETURN; END IF;
  SELECT value INTO base FROM public.app_settings WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'platform:cron_secret';
  IF coalesce(base, '') = '' OR secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := base || '/calls-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
END $$;
REVOKE ALL ON FUNCTION private.calls_sync_tick() FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'calls-sync') THEN PERFORM cron.unschedule('calls-sync'); END IF;
  PERFORM cron.schedule('calls-sync', '*/5 * * * *', 'SELECT private.calls_sync_tick()');
END $$;
