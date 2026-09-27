-- =============================================================================
-- ClubeCRM — apoio às Edge Functions multi-tenant (plano 1C, Task 1).
-- Idempotente.
-- =============================================================================

-- Hash do token do número: permite achar a instância pelo token que a Uazapi
-- manda no payload sem guardar o token em texto (o valor fica só no Vault).
ALTER TABLE public.whatsapp_instances ADD COLUMN IF NOT EXISTS token_hash text;
CREATE INDEX IF NOT EXISTS whatsapp_instances_token_hash_idx ON public.whatsapp_instances (token_hash);
UPDATE public.whatsapp_instances
SET token_hash = encode(extensions.digest(instance_token, 'sha256'), 'hex')
WHERE coalesce(instance_token, '') <> '' AND token_hash IS NULL;

CREATE OR REPLACE FUNCTION public.set_instance_secret(instance uuid, secret_value text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  org uuid;
  full_name text := format('instance:%s:token', instance);
BEGIN
  SELECT organization_id INTO org FROM public.whatsapp_instances WHERE id = instance;
  IF org IS NULL OR NOT private.has_permission(org, 'org.settings') THEN
    RAISE EXCEPTION 'sem permissão para alterar este número' USING ERRCODE = '42501';
  END IF;
  IF coalesce(length(trim(secret_value)), 0) = 0 THEN
    RAISE EXCEPTION 'valor do segredo vazio' USING ERRCODE = '22023';
  END IF;
  PERFORM private.put_secret(full_name, secret_value);
  UPDATE public.whatsapp_instances
  SET secret_name = full_name,
      token_hash = encode(extensions.digest(secret_value, 'sha256'), 'hex')
  WHERE id = instance;
  PERFORM private.audit(org, 'secret.set', 'instance:' || instance, '{}'::jsonb);
END $$;

-- Escrita e consulta de existência de segredo para as Edge Functions.
-- EXECUTE só para service_role; nomes restritos aos padrões conhecidos.
CREATE OR REPLACE FUNCTION public.service_put_secret(secret_name text, secret_value text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF secret_name !~ '^instance:[0-9a-f-]{36}:(token|webhook|app_secret)$'
     AND secret_name !~ '^org:[0-9a-f-]{36}:(groq_api_key|uazapi_admin_token|meta_app_secret)$' THEN
    RAISE EXCEPTION 'nome de segredo não permitido' USING ERRCODE = '22023';
  END IF;
  IF coalesce(length(secret_value), 0) = 0 THEN
    RAISE EXCEPTION 'valor do segredo vazio' USING ERRCODE = '22023';
  END IF;
  PERFORM private.put_secret(secret_name, secret_value);
END $$;

CREATE OR REPLACE FUNCTION public.service_has_secret(secret_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM vault.secrets WHERE name = secret_name)
$$;

REVOKE ALL ON FUNCTION public.service_put_secret(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.service_has_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_put_secret(text, text), public.service_has_secret(text) TO service_role;

-- Segredo do cron: só quem o conhece dispara o run-followups (antes bastava a
-- anon key, que é pública).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'platform:cron_secret') THEN
    PERFORM vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
      'platform:cron_secret', 'ClubeCRM: cabeçalho x-cron-secret');
  END IF;
END $$;

-- O job lê o segredo do Vault a cada execução: nada de chave no texto do job.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'run-followups-every-minute') THEN
    PERFORM cron.unschedule('run-followups-every-minute');
  END IF;
  PERFORM cron.schedule('run-followups-every-minute', '* * * * *', $cron$
    SELECT net.http_post(
      url := 'https://ulmndwlralgjbwlebxmo.supabase.co/functions/v1/run-followups',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets
                          WHERE name = 'platform:cron_secret')),
      body := jsonb_build_object('time', now())
    ) AS request_id;
  $cron$);
END $$;
