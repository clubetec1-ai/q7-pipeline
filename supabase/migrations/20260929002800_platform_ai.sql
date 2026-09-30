-- =============================================================================
-- IA da Clubetec incluída (teste de ponta a ponta, 01/10)
-- Empresa nova não tinha como fazer o 1º passo (Diagnóstico) sem cadastrar uma
-- chave de IA. Agora a Clubetec cadastra UMA chave Groq da plataforma (cofre,
-- platform:groq_api_key) e ela é usada quando a empresa ainda não tem chave
-- própria (a empresa pode recusar com settings.ai_platform = false).
-- O limite de chamadas por empresa (service_ai_take) continua valendo; o limite
-- mensal por plano entra na fase de venda.
-- Idempotente.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_platform_secret(secret_key text, secret_value text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_operator() THEN
    RAISE EXCEPTION 'apenas operadores da plataforma' USING ERRCODE = '42501';
  END IF;
  IF secret_key NOT IN ('uazapi_admin_token', 'groq_api_key') THEN
    RAISE EXCEPTION 'segredo desconhecido' USING ERRCODE = '22023';
  END IF;
  IF coalesce(length(trim(secret_value)), 0) = 0 THEN
    RAISE EXCEPTION 'valor do segredo vazio' USING ERRCODE = '22023';
  END IF;
  PERFORM private.put_secret('platform:' || secret_key, secret_value);
  PERFORM private.audit(NULL, 'secret.set', 'platform:' || secret_key, '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.set_platform_secret(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_platform_secret(text, text) TO authenticated;

-- Operador: quais segredos da plataforma existem (só sim/não, nunca o valor).
CREATE OR REPLACE FUNCTION public.platform_secret_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'apenas operadores da plataforma' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'uazapi_admin_token', EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'platform:uazapi_admin_token'),
    'groq_api_key', EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'platform:groq_api_key'));
END $$;
REVOKE ALL ON FUNCTION public.platform_secret_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_secret_status() TO authenticated;

-- Membro da empresa: a IA da Clubetec está disponível para nós? (só sim/não)
CREATE OR REPLACE FUNCTION public.platform_ai_available(org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.is_member(org)
     AND coalesce((SELECT (settings->>'ai_platform')::boolean FROM public.organizations WHERE id = org), true)
     AND EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'platform:groq_api_key')
$$;
REVOKE ALL ON FUNCTION public.platform_ai_available(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_ai_available(uuid) TO authenticated;
