-- =============================================================================
-- ClubeCRM — remove as cópias em texto dos segredos (plano 1C, Task 7).
-- As Edge Functions já leem só do Vault. Antes de anular, confere que cada
-- valor existe no Vault igual; se algum faltar, aborta sem mudar nada.
-- Idempotente.
-- =============================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id, instance_token FROM public.whatsapp_instances
           WHERE coalesce(instance_token, '') <> '' LOOP
    IF private.get_secret(format('instance:%s:token', r.id)) IS DISTINCT FROM r.instance_token THEN
      RAISE EXCEPTION 'token do número % não está no Vault; nada foi anulado', r.id;
    END IF;
  END LOOP;
  FOR r IN SELECT organization_id, groq_api_key FROM public.agent_configs
           WHERE coalesce(groq_api_key, '') <> '' LOOP
    IF private.get_secret(format('org:%s:groq_api_key', r.organization_id)) IS DISTINCT FROM r.groq_api_key THEN
      RAISE EXCEPTION 'chave da Groq da organização % não está no Vault; nada foi anulado', r.organization_id;
    END IF;
  END LOOP;

  UPDATE public.whatsapp_instances SET instance_token = NULL WHERE instance_token IS NOT NULL;
  UPDATE public.agent_configs SET groq_api_key = NULL WHERE groq_api_key IS NOT NULL;
END $$;

-- As colunas ficam (vazias) para não quebrar código antigo, mas nada volta a
-- gravar segredo nelas: o trigger descarta o valor em todo INSERT/UPDATE.
-- (REVOKE por coluna não bastaria: o GRANT de UPDATE na tabela cobre todas.)
-- Remoção definitiva das colunas numa migration futura, com confirmação.
CREATE OR REPLACE FUNCTION private.drop_plaintext_secret()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'whatsapp_instances' THEN
    NEW.instance_token := NULL;
  ELSIF TG_TABLE_NAME = 'agent_configs' THEN
    NEW.groq_api_key := NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.drop_plaintext_secret() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS drop_plaintext_secret ON public.whatsapp_instances;
CREATE TRIGGER drop_plaintext_secret BEFORE INSERT OR UPDATE ON public.whatsapp_instances
  FOR EACH ROW EXECUTE FUNCTION private.drop_plaintext_secret();
DROP TRIGGER IF EXISTS drop_plaintext_secret ON public.agent_configs;
CREATE TRIGGER drop_plaintext_secret BEFORE INSERT OR UPDATE ON public.agent_configs
  FOR EACH ROW EXECUTE FUNCTION private.drop_plaintext_secret();
