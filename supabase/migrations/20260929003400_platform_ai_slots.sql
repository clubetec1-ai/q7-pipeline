-- =============================================================================
-- IA da plataforma com Principal + 2 reservas (pedido em 03/10).
-- A Clubetec escolhe, em cada posição, o fornecedor, o modelo e a chave (no cofre:
-- platform:ai:<posição>). As Edge Functions usam a Principal e, se ela falhar, a
-- Reserva 1 e depois a Reserva 2. A última falha fica registrada para o aviso.
-- Consumo por empresa (chamadas e volume de texto) em ai_usage_daily, para a
-- Clubetec acompanhar e, depois, para a franquia de IA dos planos.
-- Nada disso é lido pelo navegador direto: só por funções do operador.
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.platform_ai_slots (
  slot text PRIMARY KEY CHECK (slot IN ('principal', 'reserva1', 'reserva2')),
  provider text NOT NULL CHECK (provider IN ('openai', 'groq', 'gemini', 'anthropic', 'openrouter', 'deepseek')),
  model text CHECK (model IS NULL OR char_length(model) BETWEEN 1 AND 80),
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 300),
  last_error_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.platform_ai_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_ai_slots FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.ai_usage_daily (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  day date NOT NULL DEFAULT current_date,
  provider text NOT NULL CHECK (char_length(provider) <= 20),
  source text NOT NULL CHECK (source IN ('plataforma', 'propria')),
  calls integer NOT NULL DEFAULT 0,
  tokens_in bigint NOT NULL DEFAULT 0,
  tokens_out bigint NOT NULL DEFAULT 0,
  audio_calls integer NOT NULL DEFAULT 0,
  PRIMARY KEY (organization_id, day, provider, source)
);
ALTER TABLE public.ai_usage_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage_daily FROM anon, authenticated;

-- A chave Groq antiga (IA da Clubetec incluída) vira a Principal, para nada parar.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.platform_ai_slots)
     AND EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'platform:groq_api_key') THEN
    INSERT INTO public.platform_ai_slots (slot, provider) VALUES ('principal', 'groq');
    PERFORM private.put_secret('platform:ai:principal', private.get_secret('platform:groq_api_key'));
  END IF;
END $$;

-- Operador: as três posições (fornecedor, modelo, se tem chave, última falha). Nunca o valor da chave.
CREATE OR REPLACE FUNCTION public.platform_ai_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'apenas operadores da plataforma' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'slot', s.slot, 'provider', s.provider, 'model', s.model,
      'has_key', EXISTS (SELECT 1 FROM vault.secrets v WHERE v.name = 'platform:ai:' || s.slot),
      'last_error', s.last_error, 'last_error_at', s.last_error_at, 'updated_at', s.updated_at)
    ORDER BY array_position(ARRAY['principal', 'reserva1', 'reserva2'], s.slot))
    FROM public.platform_ai_slots s), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.platform_ai_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_ai_status() TO authenticated;

-- Operador: grava a posição; a chave só é trocada se vier preenchida.
CREATE OR REPLACE FUNCTION public.platform_ai_set(slot_name text, provider_name text, model_name text, secret_value text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m text := nullif(trim(coalesce(model_name, '')), '');
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'apenas operadores da plataforma' USING ERRCODE = '42501'; END IF;
  IF slot_name NOT IN ('principal', 'reserva1', 'reserva2') THEN RAISE EXCEPTION 'posição inválida' USING ERRCODE = '22023'; END IF;
  IF provider_name NOT IN ('openai', 'groq', 'gemini', 'anthropic', 'openrouter', 'deepseek') THEN
    RAISE EXCEPTION 'fornecedor inválido' USING ERRCODE = '22023';
  END IF;
  IF m IS NOT NULL AND (char_length(m) > 80 OR m !~ '^[A-Za-z0-9._:/-]+$') THEN RAISE EXCEPTION 'modelo inválido' USING ERRCODE = '22023'; END IF;
  IF coalesce(length(trim(secret_value)), 0) = 0
     AND NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'platform:ai:' || slot_name) THEN
    RAISE EXCEPTION 'informe a chave desta posição' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.platform_ai_slots (slot, provider, model, updated_by)
  VALUES (slot_name, provider_name, m, auth.uid())
  ON CONFLICT (slot) DO UPDATE SET provider = EXCLUDED.provider, model = EXCLUDED.model,
    updated_at = now(), updated_by = auth.uid(), last_error = NULL, last_error_at = NULL;
  IF coalesce(length(trim(secret_value)), 0) > 0 THEN
    PERFORM private.put_secret('platform:ai:' || slot_name, trim(secret_value));
  END IF;
  PERFORM private.audit(NULL, 'platform.ai.set', slot_name, jsonb_build_object('provider', provider_name, 'model', m));
END $$;
REVOKE ALL ON FUNCTION public.platform_ai_set(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_ai_set(text, text, text, text) TO authenticated;

-- Operador: esvazia uma reserva (a Principal só troca, não some).
CREATE OR REPLACE FUNCTION public.platform_ai_clear(slot_name text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'apenas operadores da plataforma' USING ERRCODE = '42501'; END IF;
  IF slot_name NOT IN ('reserva1', 'reserva2') THEN RAISE EXCEPTION 'só as reservas podem ser esvaziadas' USING ERRCODE = '22023'; END IF;
  DELETE FROM public.platform_ai_slots WHERE slot = slot_name;
  DELETE FROM vault.secrets WHERE name = 'platform:ai:' || slot_name;
  PERFORM private.audit(NULL, 'platform.ai.clear', slot_name, '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.platform_ai_clear(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_ai_clear(text) TO authenticated;

-- Membro da empresa: a IA da Clubetec está disponível para nós? (só sim/não)
CREATE OR REPLACE FUNCTION public.platform_ai_available(org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.is_member(org)
     AND coalesce((SELECT (settings->>'ai_platform')::boolean FROM public.organizations WHERE id = org), true)
     AND (EXISTS (SELECT 1 FROM public.platform_ai_slots s JOIN vault.secrets v ON v.name = 'platform:ai:' || s.slot)
          OR EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'platform:groq_api_key'))
$$;
REVOKE ALL ON FUNCTION public.platform_ai_available(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_ai_available(uuid) TO authenticated;

-- Servidor (Edge Functions): soma o consumo do dia e registra falha de uma posição.
CREATE OR REPLACE FUNCTION public.service_ai_usage_add(org uuid, provider_name text, source_name text,
  n_calls integer, n_in integer, n_out integer, n_audio integer)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.ai_usage_daily (organization_id, day, provider, source, calls, tokens_in, tokens_out, audio_calls)
  VALUES (org, current_date, left(provider_name, 20), source_name, greatest(n_calls, 0), greatest(n_in, 0), greatest(n_out, 0), greatest(n_audio, 0))
  ON CONFLICT (organization_id, day, provider, source) DO UPDATE SET
    calls = public.ai_usage_daily.calls + EXCLUDED.calls,
    tokens_in = public.ai_usage_daily.tokens_in + EXCLUDED.tokens_in,
    tokens_out = public.ai_usage_daily.tokens_out + EXCLUDED.tokens_out,
    audio_calls = public.ai_usage_daily.audio_calls + EXCLUDED.audio_calls
$$;
REVOKE ALL ON FUNCTION public.service_ai_usage_add(uuid, text, text, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_ai_usage_add(uuid, text, text, integer, integer, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.service_ai_slot_error(slot_name text, err text)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.platform_ai_slots SET last_error = left(err, 300), last_error_at = now() WHERE slot = slot_name
$$;
REVOKE ALL ON FUNCTION public.service_ai_slot_error(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_ai_slot_error(text, text) TO service_role;

-- Operador: consumo por empresa no período (só números).
CREATE OR REPLACE FUNCTION public.platform_ai_usage(since date)
RETURNS TABLE (organization_id uuid, organization_name text, provider text, source text,
  calls bigint, tokens_in bigint, tokens_out bigint, audio_calls bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'apenas operadores da plataforma' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT u.organization_id, o.name, u.provider, u.source, sum(u.calls)::bigint, sum(u.tokens_in)::bigint,
           sum(u.tokens_out)::bigint, sum(u.audio_calls)::bigint
    FROM public.ai_usage_daily u JOIN public.organizations o ON o.id = u.organization_id
    WHERE u.day >= coalesce(since, current_date - 30)
    GROUP BY u.organization_id, o.name, u.provider, u.source
    ORDER BY sum(u.tokens_in + u.tokens_out) DESC;
END $$;
REVOKE ALL ON FUNCTION public.platform_ai_usage(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_ai_usage(date) TO authenticated;
