-- =============================================================================
-- Aviso por e-mail quando a IA da plataforma troca para a reserva (pedido em 03/10).
-- E-mail de segurança configurável em Plataforma → Conectores (sem ele, vai para os
-- operadores da plataforma). No máximo 1 aviso por posição a cada 30 minutos.
-- Idempotente.
-- =============================================================================

ALTER TABLE public.platform_ai_slots ADD COLUMN IF NOT EXISTS last_alert_at timestamptz;

-- Servidor: true = pode avisar agora (e já marca o horário do aviso).
CREATE OR REPLACE FUNCTION public.service_ai_failover_alert(slot_name text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.platform_ai_slots SET last_alert_at = now()
  WHERE slot = slot_name AND (last_alert_at IS NULL OR last_alert_at < now() - interval '30 minutes');
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.service_ai_failover_alert(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_ai_failover_alert(text) TO service_role;

-- Servidor: para quem mandar (e-mail de segurança, ou os operadores da plataforma).
CREATE OR REPLACE FUNCTION public.service_platform_alert_recipients()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN coalesce((SELECT value FROM public.app_settings WHERE key = 'security_email'), '') <> ''
    THEN ARRAY[(SELECT value FROM public.app_settings WHERE key = 'security_email')]
    ELSE coalesce((SELECT array_agg(p.email) FROM public.platform_operators o JOIN public.profiles p ON p.user_id = o.user_id
                   WHERE p.email IS NOT NULL), '{}') END
$$;
REVOKE ALL ON FUNCTION public.service_platform_alert_recipients() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_platform_alert_recipients() TO service_role;

-- Operador: lê e grava o e-mail de segurança.
CREATE OR REPLACE FUNCTION public.platform_security_email()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'apenas operadores da plataforma' USING ERRCODE = '42501'; END IF;
  RETURN (SELECT value FROM public.app_settings WHERE key = 'security_email');
END $$;
REVOKE ALL ON FUNCTION public.platform_security_email() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_security_email() TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_set_security_email(email text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e text := lower(trim(coalesce(email, '')));
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'apenas operadores da plataforma' USING ERRCODE = '42501'; END IF;
  IF e <> '' AND (char_length(e) > 200 OR e !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') THEN RAISE EXCEPTION 'e-mail inválido' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.app_settings (key, value, updated_by) VALUES ('security_email', nullif(e, ''), auth.uid())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = auth.uid(), updated_at = now();
  PERFORM private.audit(NULL, 'platform.security_email', 'app_settings', '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.platform_set_security_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_security_email(text) TO authenticated;
