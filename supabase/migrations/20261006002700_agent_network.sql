-- Rede de agentes (desenho 07, fatia 8): os agentes trocam perguntas, revisões, propostas e alertas pela
-- hierarquia (agente → superior → … → cérebro → dono). Cada nível tenta responder com o que o próprio crachá
-- permite ver; sem resposta no prazo (ou acima de 3 níveis), sobe. O que chega ao dono aparece no Diagnóstico
-- ("Perguntas do time de IA") e a resposta entra na etapa certa. Só o servidor cria e move tarefas; o dono só
-- responde. Idempotente.
CREATE TABLE IF NOT EXISTS public.agent_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  from_agent uuid,
  to_agent uuid,
  kind text NOT NULL CHECK (kind IN ('pedir_informacao', 'revisar', 'propor', 'alertar')),
  pergunta text NOT NULL CHECK (char_length(pergunta) BETWEEN 1 AND 500),
  contexto text NOT NULL DEFAULT '' CHECK (char_length(contexto) <= 1000),
  etapa text CHECK (etapa IS NULL OR etapa ~ '^[a-z_]{2,20}$'),
  status text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'respondida', 'expirada')),
  resposta text CHECK (resposta IS NULL OR char_length(resposta) <= 2000),
  fonte text CHECK (fonte IS NULL OR fonte IN ('diagnostico', 'processos', 'base_conhecimento', 'dono')),
  answered_by_agent uuid,
  answered_by uuid,
  depth int NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 4),
  calls_used int NOT NULL DEFAULT 0,
  due_at timestamptz NOT NULL DEFAULT now() + interval '1 day',
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz,
  CONSTRAINT agent_tasks_from_fk FOREIGN KEY (from_agent, organization_id) REFERENCES public.ai_agents (id, organization_id) ON DELETE SET NULL (from_agent),
  CONSTRAINT agent_tasks_to_fk FOREIGN KEY (to_agent, organization_id) REFERENCES public.ai_agents (id, organization_id) ON DELETE SET NULL (to_agent)
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_tasks_open_uq ON public.agent_tasks (organization_id, lower(pergunta)) WHERE status = 'aberta';
CREATE INDEX IF NOT EXISTS agent_tasks_work_idx ON public.agent_tasks (status, to_agent, due_at);
ALTER TABLE public.agent_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_tasks FROM anon, authenticated;
GRANT SELECT ON public.agent_tasks TO authenticated;
DROP POLICY IF EXISTS "ler: dono ou responsavel do setor" ON public.agent_tasks;
CREATE POLICY "ler: dono ou responsavel do setor" ON public.agent_tasks FOR SELECT TO authenticated
  USING (private.has_permission(organization_id, 'org.settings')
         OR EXISTS (SELECT 1 FROM public.ai_agents ag WHERE ag.id = agent_tasks.to_agent AND ag.department_id IS NOT NULL
                    AND private.can_approve_process(ag.organization_id, ag.department_id)));

-- Servidor: cria a tarefa e manda para o superior de quem pergunta (sem superior: direto ao dono).
CREATE OR REPLACE FUNCTION public.service_agent_task_create(org uuid, p_from_key text, p_kind text, p_pergunta text, p_contexto text, p_etapa text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE src public.ai_agents; rid uuid; q text := left(btrim(coalesce(p_pergunta, '')), 500);
BEGIN
  SELECT * INTO src FROM public.ai_agents WHERE organization_id = org AND key = p_from_key;
  IF src.id IS NULL OR q = '' THEN RETURN NULL; END IF;
  SELECT id INTO rid FROM public.agent_tasks WHERE organization_id = org AND status = 'aberta' AND lower(pergunta) = lower(q);
  IF rid IS NOT NULL THEN RETURN rid; END IF;
  IF (SELECT count(*) FROM public.agent_tasks WHERE organization_id = org AND status = 'aberta') >= 30 THEN RETURN NULL; END IF;
  INSERT INTO public.agent_tasks (organization_id, from_agent, to_agent, kind, pergunta, contexto, etapa)
  VALUES (org, src.id, src.parent_id, p_kind, q, left(coalesce(p_contexto, ''), 1000),
          CASE WHEN p_etapa ~ '^[a-z_]{2,20}$' THEN p_etapa ELSE NULL END)
  RETURNING id INTO rid;
  IF src.parent_id IS NULL THEN
    PERFORM private.notify_org_admins(org, 'agent_question', jsonb_build_object('task', rid, 'pergunta', q));
  END IF;
  PERFORM private.audit(org, 'network.task', rid::text, jsonb_build_object('kind', p_kind, 'from', p_from_key), 'ai_agent', p_from_key);
  RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.service_agent_task_create(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_agent_task_create(uuid, text, text, text, text, text) TO service_role;

-- Servidor: um agente respondeu com o que o crachá dele vê.
CREATE OR REPLACE FUNCTION public.service_agent_task_answer(org uuid, p_task uuid, p_resposta text, p_fonte text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.agent_tasks;
BEGIN
  SELECT * INTO t FROM public.agent_tasks WHERE id = p_task AND organization_id = org FOR UPDATE;
  IF t.id IS NULL OR t.status <> 'aberta' OR t.to_agent IS NULL THEN RAISE EXCEPTION 'tarefa indisponível' USING ERRCODE = '22023'; END IF;
  UPDATE public.agent_tasks SET status = 'respondida', resposta = left(p_resposta, 2000), fonte = p_fonte,
    answered_by_agent = t.to_agent, done_at = now() WHERE id = p_task;
  PERFORM private.audit(org, 'network.answered', p_task::text, jsonb_build_object('fonte', p_fonte), 'ai_agent', 'rede');
END $$;
REVOKE ALL ON FUNCTION public.service_agent_task_answer(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_agent_task_answer(uuid, uuid, text, text) TO service_role;

-- Servidor: sobe um nível (do cérebro, ou acima de 3 níveis, vai para o dono).
CREATE OR REPLACE FUNCTION public.service_agent_task_escalate(org uuid, p_task uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.agent_tasks; up uuid;
BEGIN
  SELECT * INTO t FROM public.agent_tasks WHERE id = p_task AND organization_id = org FOR UPDATE;
  IF t.id IS NULL OR t.status <> 'aberta' OR t.to_agent IS NULL THEN RETURN; END IF;
  SELECT parent_id INTO up FROM public.ai_agents WHERE id = t.to_agent;
  IF up IS NULL OR t.depth + 1 >= 3 THEN up := NULL; END IF;
  UPDATE public.agent_tasks SET to_agent = up, depth = least(t.depth + 1, 4), due_at = now() + interval '1 day' WHERE id = p_task;
  IF up IS NULL THEN
    PERFORM private.notify_org_admins(org, 'agent_question', jsonb_build_object('task', p_task, 'pergunta', t.pergunta));
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.service_agent_task_escalate(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_agent_task_escalate(uuid, uuid) TO service_role;

-- Servidor: pega as tarefas que estão com agentes de IA (para a função da rede tentar responder).
CREATE OR REPLACE FUNCTION public.service_agent_tasks_claim(p_limit int)
RETURNS SETOF public.agent_tasks LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.agent_tasks SET calls_used = calls_used + 1
  WHERE id IN (SELECT id FROM public.agent_tasks WHERE status = 'aberta' AND to_agent IS NOT NULL
               ORDER BY created_at LIMIT least(coalesce(p_limit, 10), 20) FOR UPDATE SKIP LOCKED)
  RETURNING *
$$;
REVOKE ALL ON FUNCTION public.service_agent_tasks_claim(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_agent_tasks_claim(int) TO service_role;

-- Dono: responde a pergunta que chegou até ele; a resposta entra no texto da etapa do Diagnóstico.
CREATE OR REPLACE FUNCTION public.answer_agent_task(p_task uuid, p_resposta text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.agent_tasks; r text := left(btrim(coalesce(p_resposta, '')), 2000); k text;
BEGIN
  SELECT * INTO t FROM public.agent_tasks WHERE id = p_task FOR UPDATE;
  IF t.id IS NULL OR NOT private.has_permission(t.organization_id, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF t.status <> 'aberta' OR t.to_agent IS NOT NULL THEN RAISE EXCEPTION 'esta pergunta não está esperando você' USING ERRCODE = '22023'; END IF;
  IF r = '' THEN RAISE EXCEPTION 'escreva ou fale a resposta' USING ERRCODE = '22023'; END IF;
  UPDATE public.agent_tasks SET status = 'respondida', resposta = r, fonte = 'dono', answered_by = auth.uid(), done_at = now() WHERE id = p_task;
  k := coalesce(t.etapa, 'empresa');
  INSERT INTO public.company_profiles (organization_id) VALUES (t.organization_id) ON CONFLICT (organization_id) DO NOTHING;
  UPDATE public.company_profiles
  SET steps = jsonb_set(coalesce(steps, '{}'::jsonb), ARRAY[k],
        coalesce(steps -> k, '{}'::jsonb) || jsonb_build_object('raw',
          btrim(coalesce(steps -> k ->> 'raw', '') || E'\n\nPergunta do time de IA: ' || t.pergunta || E'\nResposta: ' || r)))
  WHERE organization_id = t.organization_id;
  PERFORM private.audit(t.organization_id, 'network.owner_answer', p_task::text, jsonb_build_object('etapa', k));
END $$;
REVOKE ALL ON FUNCTION public.answer_agent_task(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.answer_agent_task(uuid, text) TO authenticated;

-- A cada 5 min: tarefa vencida com agente sobe um nível; se há tarefa com agente, chama a função da rede.
CREATE OR REPLACE FUNCTION private.agent_network_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t record; base text; secret text;
BEGIN
  FOR t IN SELECT id, organization_id FROM public.agent_tasks WHERE status = 'aberta' AND to_agent IS NOT NULL AND (due_at < now() OR calls_used >= 2) LIMIT 50 LOOP
    PERFORM public.service_agent_task_escalate(t.organization_id, t.id);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.agent_tasks WHERE status = 'aberta' AND to_agent IS NOT NULL) THEN RETURN; END IF;
  SELECT value INTO base FROM public.app_settings WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'platform:cron_secret';
  IF coalesce(base, '') = '' OR secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(url := base || '/agent-network',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
END $$;
REVOKE ALL ON FUNCTION private.agent_network_tick() FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'agent-network';
    PERFORM cron.schedule('agent-network', '*/5 * * * *', 'SELECT private.agent_network_tick()');
  END IF;
END $$;
