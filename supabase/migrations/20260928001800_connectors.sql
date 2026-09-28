-- =============================================================================
-- Conectores prontos (OAuth + receitas de várias chamadas) — começa pelo Bling
--  * org_connections: conexão por organização (status, validade do token);
--    tokens no Vault (conn:<org>:<conector>:access / :refresh). Só backend grava.
--  * oauth_states: "state" de uso único e curto (anti-CSRF) do login OAuth.
--  * Credenciais do APLICATIVO (da Clubetec) no Vault: platform:<conector>:client_id
--    / :client_secret — gravadas só por operador da plataforma.
--  * publish_flow aceita o bloco 'connector'.
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.org_connections (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connector text NOT NULL CHECK (connector ~ '^[a-z0-9_]{2,30}$'),
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error', 'disconnected')),
  error text,
  token_expires_at timestamptz,
  connected_by uuid,
  connected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, connector)
);
ALTER TABLE public.org_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.org_connections FROM anon, authenticated;
GRANT SELECT ON public.org_connections TO authenticated;
DROP POLICY IF EXISTS "org: dono/admin" ON public.org_connections;
CREATE POLICY "org: dono/admin" ON public.org_connections FOR SELECT TO authenticated
  USING (private.has_permission(organization_id, 'org.settings'));

CREATE TABLE IF NOT EXISTS public.oauth_states (
  state text PRIMARY KEY CHECK (char_length(state) >= 32),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connector text NOT NULL,
  user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
);
ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.oauth_states FROM anon, authenticated;

-- Segredos que as Edge Functions gravam (+ tokens de conectores).
CREATE OR REPLACE FUNCTION public.service_put_secret(secret_name text, secret_value text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF secret_name !~ '^instance:[0-9a-f-]{36}:(token|webhook|app_secret)$'
     AND secret_name !~ '^org:[0-9a-f-]{36}:(groq_api_key|uazapi_admin_token|meta_app_secret|asaas_api_key|asaas_webhook_token)$'
     AND secret_name !~ '^conn:[0-9a-f-]{36}:[a-z0-9_]{2,30}:(access|refresh)$' THEN
    RAISE EXCEPTION 'nome de segredo não permitido' USING ERRCODE = '22023';
  END IF;
  IF coalesce(length(secret_value), 0) = 0 THEN
    RAISE EXCEPTION 'valor do segredo vazio' USING ERRCODE = '22023';
  END IF;
  PERFORM private.put_secret(secret_name, secret_value);
END $$;
REVOKE ALL ON FUNCTION public.service_put_secret(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_put_secret(text, text) TO service_role;

-- Operador cadastra o aplicativo do conector (client_id / client_secret).
CREATE OR REPLACE FUNCTION public.platform_set_connector_app(connector text, client_id text, client_secret text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF connector !~ '^[a-z0-9_]{2,30}$' OR char_length(coalesce(client_id, '')) < 8 OR char_length(coalesce(client_secret, '')) < 8 THEN
    RAISE EXCEPTION 'dados do aplicativo inválidos' USING ERRCODE = '22023';
  END IF;
  PERFORM private.put_secret(format('platform:%s:client_id', connector), client_id);
  PERFORM private.put_secret(format('platform:%s:client_secret', connector), client_secret);
  PERFORM private.audit(NULL, 'platform.connector_app', connector, '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.platform_set_connector_app(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_connector_app(text, text, text) TO authenticated;

-- Quais aplicativos de conector já estão cadastrados (só booleanos).
CREATE OR REPLACE FUNCTION public.connector_apps_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_object_agg(split_part(name, ':', 2), true), '{}'::jsonb)
  FROM vault.secrets WHERE name ~ '^platform:[a-z0-9_]+:client_id$'
$$;
REVOKE ALL ON FUNCTION public.connector_apps_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.connector_apps_status() TO authenticated;

-- publish_flow aceita o bloco 'connector'.
CREATE OR REPLACE FUNCTION public.publish_flow(flow uuid)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.flow_versions; nextv integer; bad text;
BEGIN
  SELECT * INTO d FROM public.flow_versions WHERE flow_id = flow AND status = 'draft';
  IF d.id IS NULL OR NOT private.has_permission(d.organization_id, 'org.settings') THEN
    RAISE EXCEPTION 'rascunho não encontrado' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(d.graph -> 'nodes') n WHERE n ->> 'type' = 'start') <> 1 THEN
    RAISE EXCEPTION 'o fluxo precisa de exatamente um bloco Início' USING ERRCODE = '22023';
  END IF;
  SELECT n ->> 'type' INTO bad FROM jsonb_array_elements(d.graph -> 'nodes') n
  WHERE n ->> 'type' NOT IN ('start', 'message', 'menu', 'question', 'condition', 'business_hours',
                             'ai_agent', 'tag', 'transfer', 'close',
                             'wait', 'survey', 'http', 'record', 'connector') LIMIT 1;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'bloco desconhecido: %', bad USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(d.graph -> 'edges') e
             WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d.graph -> 'nodes') n WHERE n ->> 'id' = e ->> 'source')
                OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d.graph -> 'nodes') n WHERE n ->> 'id' = e ->> 'target')) THEN
    RAISE EXCEPTION 'há ligações para blocos que não existem' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(max(version), 0) + 1 INTO nextv FROM public.flow_versions WHERE flow_id = flow;
  UPDATE public.flow_versions SET status = 'archived' WHERE flow_id = flow AND status = 'published';
  INSERT INTO public.flow_versions (organization_id, flow_id, version, status, graph, published_at, published_by)
  VALUES (d.organization_id, flow, nextv, 'published', d.graph, now(), (SELECT auth.uid()));
  PERFORM private.audit(d.organization_id, 'flow.published', flow::text, jsonb_build_object('version', nextv));
  RETURN nextv;
END $$;
REVOKE ALL ON FUNCTION public.publish_flow(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_flow(uuid) TO authenticated;
