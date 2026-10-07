-- Modelo de IA por tipo de agente (pedido do dono, 07/10): o sistema sugere o modelo pela capacidade que cada agente
-- precisa (qualidade, segurança e menos tokens) e a equipe Clubetec pode trocar por fornecedor. Vazio = sugerido.
-- Só a equipe da plataforma vê e muda; as funções leem pelo servidor. Idempotente.
CREATE TABLE IF NOT EXISTS public.platform_ai_agent_models (
  agent text NOT NULL CHECK (agent IN ('atendimento', 'entrevista', 'arquiteto', 'avaliador', 'guardiao', 'avaliacao_atendimento',
                                       'relatorios', 'cerebro', 'plataforma', 'integracoes')),
  provider text NOT NULL CHECK (provider IN ('openai', 'groq', 'gemini', 'anthropic', 'openrouter', 'deepseek')),
  model text NOT NULL CHECK (model ~ '^[A-Za-z0-9_.:/-]{2,100}$'),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent, provider)
);
ALTER TABLE public.platform_ai_agent_models ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_ai_agent_models FROM anon, authenticated;
GRANT SELECT ON public.platform_ai_agent_models TO authenticated;
DROP POLICY IF EXISTS "ler: equipe da plataforma" ON public.platform_ai_agent_models;
CREATE POLICY "ler: equipe da plataforma" ON public.platform_ai_agent_models FOR SELECT TO authenticated USING (private.is_platform_operator());

CREATE OR REPLACE FUNCTION public.platform_ai_agent_model_set(p_agent text, p_provider text, p_model text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m text := nullif(btrim(coalesce(p_model, '')), '');
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF m IS NULL THEN
    DELETE FROM public.platform_ai_agent_models WHERE agent = p_agent AND provider = p_provider;
  ELSE
    INSERT INTO public.platform_ai_agent_models (agent, provider, model, updated_by)
    VALUES (p_agent, p_provider, m, auth.uid())
    ON CONFLICT (agent, provider) DO UPDATE SET model = EXCLUDED.model, updated_by = EXCLUDED.updated_by, updated_at = now();
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.platform_ai_agent_model_set(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_ai_agent_model_set(text, text, text) TO authenticated;
