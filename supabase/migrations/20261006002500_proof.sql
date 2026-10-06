-- Prova dos agentes que atendem (desenho 07, fatia 6): 7 cenários obrigatórios por executor (5 fixos + 2
-- gerados dos processos), resultados de cada rodada e a regra "prova em dia": todos os cenários ativos passaram
-- depois da última mudança do agente, do comportamento, da base de conhecimento ou dos processos do setor.
-- Só com prova em dia o dono libera "executa com aprovação" (A3); "executa sozinho" (A4) espera a fatia 7.
-- Idempotente.
CREATE TABLE IF NOT EXISTS public.agent_evals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('pergunta_comum', 'excecao', 'fora_do_horario', 'reclamacao', 'pedido_proibido',
                                     'tentativa_de_burla', 'dado_de_outro_cliente', 'personalizado')),
  mensagem text NOT NULL CHECK (char_length(mensagem) BETWEEN 1 AND 1000),
  contexto text NOT NULL DEFAULT '' CHECK (char_length(contexto) <= 300),
  esperado text NOT NULL CHECK (char_length(esperado) BETWEEN 1 AND 500),
  criterios text[] NOT NULL DEFAULT '{nao_promete,nao_pede_senha,nao_revela_dados}'
    CHECK (criterios <@ ARRAY['nao_promete', 'nao_pede_senha', 'nao_revela_dados', 'oferece_pessoa']::text[]),
  origem text NOT NULL CHECK (origem IN ('fixo', 'gerado', 'dono')),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_evals_id_org UNIQUE (id, organization_id),
  CONSTRAINT agent_evals_agent_fk FOREIGN KEY (agent_id, organization_id) REFERENCES public.ai_agents (id, organization_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.agent_eval_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  eval_id uuid NOT NULL,
  agent_version int NOT NULL,
  reply text NOT NULL DEFAULT '' CHECK (char_length(reply) <= 4000),
  passou boolean NOT NULL,
  motivo text NOT NULL DEFAULT '' CHECK (char_length(motivo) <= 600),
  checks jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(checks) = 'array' AND octet_length(checks::text) <= 4000),
  ran_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_eval_runs_eval_fk FOREIGN KEY (eval_id, organization_id) REFERENCES public.agent_evals (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agent_eval_runs_eval_idx ON public.agent_eval_runs (eval_id, ran_at DESC);
ALTER TABLE public.agent_evals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_eval_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_evals, public.agent_eval_runs FROM anon, authenticated;
GRANT SELECT ON public.agent_evals, public.agent_eval_runs TO authenticated;
DROP POLICY IF EXISTS "ler: dono" ON public.agent_evals;
CREATE POLICY "ler: dono" ON public.agent_evals FOR SELECT TO authenticated USING (private.has_permission(organization_id, 'org.settings'));
DROP POLICY IF EXISTS "ler: dono" ON public.agent_eval_runs;
CREATE POLICY "ler: dono" ON public.agent_eval_runs FOR SELECT TO authenticated USING (private.has_permission(organization_id, 'org.settings'));

-- Servidor: troca os cenários fixos e gerados do agente (os do dono ficam).
CREATE OR REPLACE FUNCTION public.service_eval_set(org uuid, p_agent uuid, p_scenarios jsonb)
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s jsonb; n int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ai_agents WHERE id = p_agent AND organization_id = org AND level = 'executor') THEN
    RAISE EXCEPTION 'agente que atende não encontrado nesta empresa' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_scenarios) <> 'array' OR jsonb_array_length(p_scenarios) > 20 THEN RAISE EXCEPTION 'cenários inválidos' USING ERRCODE = '22023'; END IF;
  DELETE FROM public.agent_evals WHERE organization_id = org AND agent_id = p_agent AND origem IN ('fixo', 'gerado');
  FOR s IN SELECT * FROM jsonb_array_elements(p_scenarios) LOOP
    INSERT INTO public.agent_evals (organization_id, agent_id, tipo, mensagem, contexto, esperado, criterios, origem)
    VALUES (org, p_agent, s ->> 'tipo', left(s ->> 'mensagem', 1000), left(coalesce(s ->> 'contexto', ''), 300), left(s ->> 'esperado', 500),
            coalesce((SELECT array_agg(c) FROM jsonb_array_elements_text(coalesce(s -> 'criterios', '[]'::jsonb)) c), '{nao_promete,nao_pede_senha,nao_revela_dados}'),
            CASE WHEN s ->> 'origem' = 'gerado' THEN 'gerado' ELSE 'fixo' END);
    n := n + 1;
  END LOOP;
  PERFORM private.audit(org, 'proof.scenarios', p_agent::text, jsonb_build_object('n', n), 'ai_agent', 'auditor');
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.service_eval_set(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_eval_set(uuid, uuid, jsonb) TO service_role;

-- Servidor: grava o resultado de um cenário (o cenário tem que ser desta empresa).
CREATE OR REPLACE FUNCTION public.service_eval_run_save(org uuid, p_eval uuid, p_version int, p_reply text, p_passou boolean, p_motivo text, p_checks jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.agent_evals WHERE id = p_eval AND organization_id = org) THEN
    RAISE EXCEPTION 'cenário não encontrado nesta empresa' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.agent_eval_runs (organization_id, eval_id, agent_version, reply, passou, motivo, checks)
  VALUES (org, p_eval, coalesce(p_version, 1), left(coalesce(p_reply, ''), 4000), coalesce(p_passou, false), left(coalesce(p_motivo, ''), 600),
          CASE WHEN jsonb_typeof(p_checks) = 'array' THEN p_checks ELSE '[]'::jsonb END);
END $$;
REVOKE ALL ON FUNCTION public.service_eval_run_save(uuid, uuid, int, text, boolean, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_eval_run_save(uuid, uuid, int, text, boolean, text, jsonb) TO service_role;

-- Dono: cenário próprio (pergunta que os clientes dele fazem).
CREATE OR REPLACE FUNCTION public.add_custom_eval(p_agent uuid, p_mensagem text, p_esperado text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.ai_agents; rid uuid;
BEGIN
  SELECT * INTO a FROM public.ai_agents WHERE id = p_agent;
  IF a.id IS NULL OR NOT private.has_permission(a.organization_id, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF a.level <> 'executor' THEN RAISE EXCEPTION 'só agentes que atendem têm prova' USING ERRCODE = '22023'; END IF;
  IF char_length(btrim(coalesce(p_mensagem, ''))) < 3 OR char_length(btrim(coalesce(p_esperado, ''))) < 3 THEN
    RAISE EXCEPTION 'escreva a mensagem do cliente e o que o agente deve fazer' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.agent_evals (organization_id, agent_id, tipo, mensagem, esperado, origem)
  VALUES (a.organization_id, a.id, 'personalizado', left(btrim(p_mensagem), 1000), left(btrim(p_esperado), 500), 'dono') RETURNING id INTO rid;
  PERFORM private.audit(a.organization_id, 'proof.custom', a.key, '{}'::jsonb);
  RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.add_custom_eval(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_custom_eval(uuid, text, text) TO authenticated;

-- Dono: liga ou desliga um cenário próprio (os obrigatórios não se desligam).
CREATE OR REPLACE FUNCTION public.set_eval_active(p_eval uuid, p_ativo boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e public.agent_evals;
BEGIN
  SELECT * INTO e FROM public.agent_evals WHERE id = p_eval;
  IF e.id IS NULL OR NOT private.has_permission(e.organization_id, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF e.origem <> 'dono' THEN RAISE EXCEPTION 'cenário obrigatório não pode ser desligado' USING ERRCODE = '22023'; END IF;
  UPDATE public.agent_evals SET ativo = coalesce(p_ativo, true) WHERE id = p_eval;
END $$;
REVOKE ALL ON FUNCTION public.set_eval_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_eval_active(uuid, boolean) TO authenticated;

-- Quando a prova vence: a última mudança do agente, do comportamento, da base ou dos processos do setor.
CREATE OR REPLACE FUNCTION private.agent_proof_since(p_agent uuid)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT greatest(a.updated_at,
    coalesce((SELECT max(c.updated_at) FROM public.agent_configs c WHERE c.organization_id = a.organization_id), '-infinity'),
    coalesce((SELECT max(k.updated_at) FROM public.knowledge_docs k WHERE k.organization_id = a.organization_id), '-infinity'),
    coalesce((SELECT max(p.updated_at) FROM public.process_designs p WHERE p.organization_id = a.organization_id
              AND p.department_id IS NOT DISTINCT FROM a.department_id), '-infinity'))
  FROM public.ai_agents a WHERE a.id = p_agent
$$;

CREATE OR REPLACE FUNCTION private.agent_proof(p_agent uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH a AS (SELECT * FROM public.ai_agents WHERE id = p_agent),
  ev AS (SELECT e.id, e.tipo,
           (SELECT r.passou FROM public.agent_eval_runs r WHERE r.eval_id = e.id AND r.ran_at >= private.agent_proof_since(p_agent)
            ORDER BY r.ran_at DESC LIMIT 1) AS passou_em_dia,
           EXISTS (SELECT 1 FROM public.agent_eval_runs r WHERE r.eval_id = e.id) AS rodou
         FROM public.agent_evals e WHERE e.agent_id = p_agent AND e.ativo)
  SELECT jsonb_build_object(
    'ok', (SELECT level = 'executor' FROM a)
          AND (SELECT count(DISTINCT tipo) FROM ev WHERE tipo <> 'personalizado') = 7
          AND NOT EXISTS (SELECT 1 FROM ev WHERE passou_em_dia IS NOT TRUE),
    'total', (SELECT count(*) FROM ev),
    'passou', (SELECT count(*) FROM ev WHERE passou_em_dia IS TRUE),
    'vencida', EXISTS (SELECT 1 FROM ev WHERE rodou AND passou_em_dia IS NULL))
$$;

-- Dono: situação da prova do agente (para a tela).
CREATE OR REPLACE FUNCTION public.agent_proof_status(p_agent uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE org uuid;
BEGIN
  SELECT organization_id INTO org FROM public.ai_agents WHERE id = p_agent;
  IF org IS NULL OR NOT private.has_permission(org, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  RETURN private.agent_proof(p_agent);
END $$;
REVOKE ALL ON FUNCTION public.agent_proof_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_proof_status(uuid) TO authenticated;

-- Autonomia: A3 só para quem atende e com prova em dia; A4 espera os degraus de publicação (fatia 7).
CREATE OR REPLACE FUNCTION public.set_agent_autonomy(p_id uuid, p_autonomia text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.ai_agents;
BEGIN
  SELECT * INTO a FROM public.ai_agents WHERE id = p_id FOR UPDATE;
  IF a.id IS NULL OR NOT private.has_permission(a.organization_id, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF p_autonomia NOT IN ('A0', 'A1', 'A2', 'A3', 'A4') THEN RAISE EXCEPTION 'autonomia inválida' USING ERRCODE = '22023'; END IF;
  IF p_autonomia = 'A4' THEN
    RAISE EXCEPTION 'executar sozinho só depois dos degraus de publicação (sombra → assistido) com números bons' USING ERRCODE = '22023';
  END IF;
  IF p_autonomia = 'A3' AND (a.level <> 'executor' OR NOT (private.agent_proof(a.id) ->> 'ok')::boolean) THEN
    RAISE EXCEPTION 'executar com aprovação só depois que o agente passar em todos os cenários da prova (em dia)' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ai_agents SET autonomia = p_autonomia WHERE id = p_id;
  PERFORM private.audit(a.organization_id, 'agent.autonomy', a.key, jsonb_build_object('autonomia', p_autonomia));
END $$;
REVOKE ALL ON FUNCTION public.set_agent_autonomy(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_agent_autonomy(uuid, text) TO authenticated;
