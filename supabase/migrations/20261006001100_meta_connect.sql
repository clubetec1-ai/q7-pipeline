-- =============================================================================
-- "Conectar com o Facebook" (login da Meta) para a Página/Instagram e para o
-- número oficial do WhatsApp: o cliente entra com a conta dele e escolhe a Página
-- ou o número — sem copiar ID nem token.
--  * meta_connect_sessions: escolhas pendentes depois do login (15 min, de quem
--    fez o login); o token fica no Vault (metaconnect:<id>:token) e é apagado ao
--    concluir. As opções guardam só nomes e ids (nada de token).
--  * platform_set_meta_app: a Clubetec informa o ID do app e as configurações do
--    login (Facebook Login for Business). O App Secret já fica no Vault.
-- Idempotente.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.meta_connect_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('pages', 'whatsapp')),
  options jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (octet_length(options::text) <= 100000),
  error text CHECK (error IS NULL OR char_length(error) <= 300),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meta_connect_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_connect_sessions FROM anon, authenticated;
GRANT SELECT (id, organization_id, kind, options, error, expires_at) ON public.meta_connect_sessions TO authenticated;
GRANT ALL ON public.meta_connect_sessions TO service_role;
DROP POLICY IF EXISTS "propria" ON public.meta_connect_sessions;
CREATE POLICY "propria" ON public.meta_connect_sessions FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND private.has_permission(organization_id, 'org.settings') AND expires_at > now());

CREATE OR REPLACE FUNCTION public.service_meta_connect_forget(sess uuid)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM vault.secrets WHERE name = format('metaconnect:%s:token', sess);
  DELETE FROM public.meta_connect_sessions WHERE id = sess;
$$;
REVOKE ALL ON FUNCTION public.service_meta_connect_forget(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_meta_connect_forget(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.platform_set_meta_app(p_app_id text, p_config_pages text, p_config_whatsapp text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'só a Clubetec' USING ERRCODE = '42501'; END IF;
  IF coalesce(p_app_id, '') !~ '^[0-9]{5,25}$' THEN RAISE EXCEPTION 'ID do app inválido' USING ERRCODE = '22023'; END IF;
  IF coalesce(p_config_pages, '') !~ '^([0-9]{5,25})?$' OR coalesce(p_config_whatsapp, '') !~ '^([0-9]{5,25})?$' THEN
    RAISE EXCEPTION 'ID de configuração inválido' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.app_settings (key, value) VALUES
    ('meta_app_id', p_app_id), ('meta_login_config_pages', coalesce(p_config_pages, '')), ('meta_login_config_whatsapp', coalesce(p_config_whatsapp, ''))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  PERFORM private.audit(NULL, 'platform.meta_app', p_app_id, jsonb_build_object('pages', p_config_pages <> '', 'whatsapp', p_config_whatsapp <> ''));
END $$;
REVOKE ALL ON FUNCTION public.platform_set_meta_app(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_meta_app(text, text, text) TO authenticated;

-- O que a Plataforma mostra sobre o app da Meta (sem segredo).
CREATE OR REPLACE FUNCTION public.platform_meta_app()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'só a Clubetec' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'app_id', (SELECT value FROM public.app_settings WHERE key = 'meta_app_id'),
    'config_pages', (SELECT value FROM public.app_settings WHERE key = 'meta_login_config_pages'),
    'config_whatsapp', (SELECT value FROM public.app_settings WHERE key = 'meta_login_config_whatsapp'),
    'secret', EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'platform:meta_app_secret'),
    'verify_token', EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'meta_verify_token'));
END $$;
REVOKE ALL ON FUNCTION public.platform_meta_app() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_meta_app() TO authenticated;
