-- =============================================================================
-- 3B-2 — Bloco HTTP, ferramentas da IA e provedor por agente
--  * Segredos do bloco HTTP: Vault (org:<org>:http:<nome>), referência em
--    org_secrets ('http:<nome>'); o navegador só grava/apaga e vê os nomes.
--  * Limite de 60 chamadas HTTP/min por organização (service_http_take).
--  * Chaves de outros provedores de IA pelo mesmo set_org_secret.
--  * Publicar fluxo com bloco HTTP registra as URLs no audit_log.
-- Idempotente.
-- =============================================================================

-- Chaves aceitas por set_org_secret (+ provedores de IA).
CREATE OR REPLACE FUNCTION public.set_org_secret(org uuid, secret_key text, secret_value text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE full_name text := format('org:%s:%s', org, secret_key);
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN
    RAISE EXCEPTION 'sem permissão para alterar segredos desta organização' USING ERRCODE = '42501';
  END IF;
  IF secret_key NOT IN ('groq_api_key', 'uazapi_admin_token', 'meta_app_secret',
                        'openai_api_key', 'openrouter_api_key', 'gemini_api_key',
                        'anthropic_api_key', 'deepseek_api_key') THEN
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

-- Quais chaves de IA existem (só booleanos; nunca o valor).
CREATE OR REPLACE FUNCTION public.ai_keys_status(org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT coalesce(jsonb_object_agg(replace(name, '_api_key', ''), true), '{}'::jsonb)
          FROM public.org_secrets WHERE organization_id = org AND name LIKE '%\_api\_key');
END $$;

-- Segredos do bloco HTTP.
CREATE OR REPLACE FUNCTION public.set_http_secret(org uuid, secret_key text, secret_value text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE full_name text := format('org:%s:http:%s', org, secret_key);
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  IF secret_key !~ '^[a-z0-9_]{1,40}$' THEN
    RAISE EXCEPTION 'nome inválido (letras minúsculas, números e _)' USING ERRCODE = '22023';
  END IF;
  IF coalesce(length(trim(secret_value)), 0) = 0 OR length(secret_value) > 4000 THEN
    RAISE EXCEPTION 'valor do segredo vazio ou grande demais' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_secrets WHERE organization_id = org AND name = 'http:' || secret_key)
     AND (SELECT count(*) FROM public.org_secrets WHERE organization_id = org AND name LIKE 'http:%') >= 50 THEN
    RAISE EXCEPTION 'limite de 50 segredos' USING ERRCODE = '22023';
  END IF;
  PERFORM private.put_secret(full_name, secret_value);
  INSERT INTO public.org_secrets (organization_id, name, secret_name, updated_by, updated_at)
  VALUES (org, 'http:' || secret_key, full_name, (SELECT auth.uid()), now())
  ON CONFLICT (organization_id, name)
  DO UPDATE SET secret_name = EXCLUDED.secret_name, updated_by = EXCLUDED.updated_by, updated_at = now();
  PERFORM private.audit(org, 'secret.set', 'http:' || secret_key, '{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.delete_http_secret(org uuid, secret_key text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE full_name text := format('org:%s:http:%s', org, secret_key);
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.org_secrets WHERE organization_id = org AND name = 'http:' || secret_key;
  DELETE FROM vault.secrets WHERE name = full_name;
  PERFORM private.audit(org, 'secret.deleted', 'http:' || secret_key, '{}'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.list_http_secrets(org uuid)
RETURNS TABLE (name text, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT substr(s.name, 6), s.updated_at FROM public.org_secrets s
    WHERE s.organization_id = org AND s.name LIKE 'http:%' ORDER BY 1;
END $$;

REVOKE ALL ON FUNCTION public.ai_keys_status(uuid), public.set_http_secret(uuid, text, text),
  public.delete_http_secret(uuid, text), public.list_http_secrets(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_keys_status(uuid), public.set_http_secret(uuid, text, text),
  public.delete_http_secret(uuid, text), public.list_http_secrets(uuid) TO authenticated;

-- Limite de chamadas HTTP por organização (60/min). Só backend.
CREATE TABLE IF NOT EXISTS public.flow_http_usage (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  minute timestamptz NOT NULL,
  n integer NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, minute)
);
ALTER TABLE public.flow_http_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.flow_http_usage FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.service_http_take(org uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE used integer;
BEGIN
  INSERT INTO public.flow_http_usage (organization_id, minute, n)
  VALUES (org, date_trunc('minute', now()), 1)
  ON CONFLICT (organization_id, minute) DO UPDATE SET n = public.flow_http_usage.n + 1
  RETURNING n INTO used;
  DELETE FROM public.flow_http_usage WHERE organization_id = org AND minute < now() - interval '10 minutes';
  RETURN used <= 60;
END $$;
REVOKE ALL ON FUNCTION public.service_http_take(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_http_take(uuid) TO service_role;

-- Publicar fluxo com bloco HTTP: registra os destinos (modelo, sem segredos resolvidos).
CREATE OR REPLACE FUNCTION private.audit_flow_http_targets()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE urls jsonb;
BEGIN
  IF NEW.status <> 'published' THEN RETURN NULL; END IF;
  SELECT jsonb_agg(DISTINCT n -> 'data' ->> 'url') INTO urls
  FROM jsonb_array_elements(NEW.graph -> 'nodes') n WHERE n ->> 'type' = 'http';
  IF urls IS NOT NULL THEN
    INSERT INTO public.audit_log (organization_id, actor_id, action, target, meta)
    VALUES (NEW.organization_id, NEW.published_by, 'flow.http_targets', NEW.flow_id::text,
            jsonb_build_object('version', NEW.version, 'urls', urls));
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.audit_flow_http_targets() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS audit_flow_http_targets ON public.flow_versions;
CREATE TRIGGER audit_flow_http_targets AFTER INSERT ON public.flow_versions
  FOR EACH ROW EXECUTE FUNCTION private.audit_flow_http_targets();
