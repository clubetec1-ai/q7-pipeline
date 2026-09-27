-- =============================================================================
-- ClubeCRM — segredos no Supabase Vault, referenciados sempre por nome.
-- Spec: docs/superpowers/specs/2026-09-24-multi-tenant-equipes-design.md §6.3
-- Nomes: org:<org_id>:<chave> · instance:<instance_id>:token · platform:<chave>
-- O navegador só grava (RPC); ler é exclusivo do service_role (Edge Functions).
-- Idempotente. As colunas antigas em texto continuam até o 1C trocar a leitura.
-- =============================================================================

-- Cria ou atualiza um segredo pelo nome.
CREATE OR REPLACE FUNCTION private.put_secret(secret_name text, secret_value text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE sid uuid;
BEGIN
  SELECT id INTO sid FROM vault.secrets WHERE name = secret_name;
  IF sid IS NULL THEN
    PERFORM vault.create_secret(secret_value, secret_name, 'ClubeCRM');
  ELSE
    PERFORM vault.update_secret(sid, secret_value);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.get_secret(secret_name text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = secret_name LIMIT 1
$$;

-- Porta de leitura para as Edge Functions (só o schema public é exposto pela
-- API). EXECUTE apenas para service_role: o navegador não tem caminho de leitura.
CREATE OR REPLACE FUNCTION public.service_get_secret(secret_name text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.get_secret(secret_name)
$$;

CREATE OR REPLACE FUNCTION public.set_org_secret(org uuid, secret_key text, secret_value text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE full_name text := format('org:%s:%s', org, secret_key);
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN
    RAISE EXCEPTION 'sem permissão para alterar segredos desta organização' USING ERRCODE = '42501';
  END IF;
  IF secret_key NOT IN ('groq_api_key', 'uazapi_admin_token', 'meta_app_secret') THEN
    RAISE EXCEPTION 'segredo desconhecido: %', secret_key USING ERRCODE = '22023';
  END IF;
  IF coalesce(length(trim(secret_value)), 0) = 0 THEN
    RAISE EXCEPTION 'valor do segredo vazio' USING ERRCODE = '22023';
  END IF;
  PERFORM private.put_secret(full_name, secret_value);
  INSERT INTO public.org_secrets (organization_id, name, secret_name, updated_by, updated_at)
  VALUES (org, secret_key, full_name, (SELECT auth.uid()), now())
  ON CONFLICT (organization_id, name)
  DO UPDATE SET secret_name = EXCLUDED.secret_name, updated_by = EXCLUDED.updated_by, updated_at = now();
  PERFORM private.audit(org, 'secret.set', secret_key, '{}'::jsonb);
END $$;

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
  UPDATE public.whatsapp_instances SET secret_name = full_name WHERE id = instance;
  PERFORM private.audit(org, 'secret.set', 'instance:' || instance, '{}'::jsonb);
END $$;

REVOKE ALL ON FUNCTION private.put_secret(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.get_secret(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.service_get_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.get_secret(text), public.service_get_secret(text) TO service_role;
REVOKE ALL ON FUNCTION public.set_org_secret(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_instance_secret(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_org_secret(uuid, text, text),
  public.set_instance_secret(uuid, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- Cópia dos segredos atuais para o Vault, conferindo cada um.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  n text;
BEGIN
  FOR r IN SELECT organization_id, groq_api_key FROM public.agent_configs
           WHERE coalesce(groq_api_key, '') <> '' LOOP
    n := format('org:%s:groq_api_key', r.organization_id);
    PERFORM private.put_secret(n, r.groq_api_key);
    IF private.get_secret(n) IS DISTINCT FROM r.groq_api_key THEN
      RAISE EXCEPTION 'conferência do Vault falhou para %', n;
    END IF;
    INSERT INTO public.org_secrets (organization_id, name, secret_name)
    VALUES (r.organization_id, 'groq_api_key', n)
    ON CONFLICT (organization_id, name) DO UPDATE SET secret_name = EXCLUDED.secret_name;
  END LOOP;

  FOR r IN SELECT id, instance_token FROM public.whatsapp_instances
           WHERE coalesce(instance_token, '') <> '' LOOP
    n := format('instance:%s:token', r.id);
    PERFORM private.put_secret(n, r.instance_token);
    IF private.get_secret(n) IS DISTINCT FROM r.instance_token THEN
      RAISE EXCEPTION 'conferência do Vault falhou para %', n;
    END IF;
    UPDATE public.whatsapp_instances SET secret_name = n WHERE id = r.id;
  END LOOP;

  FOR r IN SELECT key, value FROM public.app_settings
           WHERE key IN ('meta_verify_token', 'meta_app_secret', 'uazapi_admin_token')
             AND coalesce(value, '') <> '' LOOP
    n := 'platform:' || r.key;
    PERFORM private.put_secret(n, r.value);
    IF private.get_secret(n) IS DISTINCT FROM r.value THEN
      RAISE EXCEPTION 'conferência do Vault falhou para %', n;
    END IF;
  END LOOP;
END $$;
