-- Revisão de segurança da arquitetura "empresa completa com IA" (desenho 07, fatia 10). Correções do revisor:
--  1. Documento "Como funciona" sai do atendimento quando o processo muda, é arquivado ou apagado (a IA não segue regra velha).
--  2. Disjuntor: no máximo um tropeço por conversa em 24 h conta (um cliente sozinho não derruba o degrau da empresa).
--  3. Degraus: descer é sempre permitido; subir exige o Atendente geral não reprovado pelo Guardião. Pausar o Atendente geral
--     volta a IA para a sombra. Ativar um agente exige que o Guardião não o tenha reprovado.
--  4. Rede: o dono pode descartar uma pergunta; pergunta esperando o dono vence em 14 dias (a fila nunca trava).
--  5. LGPD: sugestões da IA são apagadas na anonimização do contato e expurgadas (usadas há 30 dias ou criadas há 90);
--     perguntas da rede encerradas há 90 dias também.
--  6. Funções internas: sem EXECUTE para PUBLIC/anon/authenticated; marcar sugestão confere a empresa.
-- Idempotente.

-- 1. Documento do processo implantado acompanha o processo.
CREATE OR REPLACE FUNCTION private.process_doc_follow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d uuid;
BEGIN
  d := nullif(OLD.implementation ->> 'doc_id', '')::uuid;
  IF TG_OP = 'DELETE' THEN
    IF d IS NOT NULL THEN DELETE FROM public.knowledge_docs WHERE id = d AND organization_id = OLD.organization_id; END IF;
    RETURN OLD;
  END IF;
  IF OLD.implementation IS NOT NULL AND (NEW.status <> 'aprovado' OR NEW.version <> OLD.version) THEN
    IF d IS NOT NULL THEN DELETE FROM public.knowledge_docs WHERE id = d AND organization_id = OLD.organization_id; END IF;
    NEW.implementation := NULL;
    NEW.implemented_at := NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.process_doc_follow() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS process_doc_follow_upd ON public.process_designs;
CREATE TRIGGER process_doc_follow_upd BEFORE UPDATE ON public.process_designs FOR EACH ROW EXECUTE FUNCTION private.process_doc_follow();
DROP TRIGGER IF EXISTS process_doc_follow_del ON public.process_designs;
CREATE TRIGGER process_doc_follow_del AFTER DELETE ON public.process_designs FOR EACH ROW EXECUTE FUNCTION private.process_doc_follow();

-- 2. Disjuntor por conversa.
ALTER TABLE public.ai_breaker_events ADD COLUMN IF NOT EXISTS conversation_id uuid;
DROP FUNCTION IF EXISTS public.service_breaker_event(uuid, text, text);
CREATE OR REPLACE FUNCTION public.service_breaker_event(org uuid, p_kind text, p_detail text, p_conv uuid DEFAULT NULL)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE cur text; since timestamptz; n int; novo text;
BEGIN
  INSERT INTO public.ai_breaker_events (organization_id, kind, detail, conversation_id) VALUES (org, p_kind, left(coalesce(p_detail, ''), 300), p_conv);
  SELECT publish_mode INTO cur FROM public.agent_configs WHERE organization_id = org FOR UPDATE;
  IF cur IS NULL OR cur = 'sombra' THEN RETURN coalesce(cur, 'sombra'); END IF;
  since := greatest(now() - interval '24 hours',
    coalesce((SELECT max(created_at) FROM public.ai_breaker_events WHERE organization_id = org AND kind = 'stepdown'), '-infinity'));
  -- Tropeços da mesma conversa contam uma vez só.
  SELECT count(DISTINCT coalesce(conversation_id::text, id::text)) INTO n FROM public.ai_breaker_events
  WHERE organization_id = org AND kind <> 'stepdown' AND created_at > since;
  IF n < 3 THEN RETURN cur; END IF;
  novo := CASE cur WHEN 'automatico' THEN 'assistido' ELSE 'sombra' END;
  UPDATE public.agent_configs SET publish_mode = novo, publish_mode_since = now() WHERE organization_id = org;
  UPDATE public.ai_agents SET autonomia = CASE novo WHEN 'assistido' THEN 'A3' ELSE 'A1' END WHERE organization_id = org AND key = 'exec:geral';
  INSERT INTO public.ai_breaker_events (organization_id, kind, detail) VALUES (org, 'stepdown', cur || ' → ' || novo);
  PERFORM private.notify_org_admins(org, 'breaker_stepdown', jsonb_build_object('de', cur, 'para', novo, 'tropecos', n));
  PERFORM private.notify_platform_operators('breaker_stepdown', jsonb_build_object('org', org, 'de', cur, 'para', novo));
  PERFORM private.audit(org, 'ai.breaker_stepdown', NULL, jsonb_build_object('de', cur, 'para', novo, 'tropecos', n), 'ai_agent', 'disjuntor');
  RETURN novo;
END $$;
REVOKE ALL ON FUNCTION public.service_breaker_event(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_breaker_event(uuid, text, text, uuid) TO service_role;

-- 3. Degraus.
CREATE OR REPLACE FUNCTION public.set_publish_mode(org uuid, p_mode text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE cfg public.agent_configs; ag public.ai_agents; rk jsonb := '{"sombra":0,"assistido":1,"automatico":2}';
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF p_mode NOT IN ('sombra', 'assistido', 'automatico') THEN RAISE EXCEPTION 'modo inválido' USING ERRCODE = '22023'; END IF;
  SELECT * INTO cfg FROM public.agent_configs WHERE organization_id = org FOR UPDATE;
  IF cfg.organization_id IS NULL THEN RAISE EXCEPTION 'configure o Assistente de IA primeiro' USING ERRCODE = '22023'; END IF;
  -- Descer de degrau é sempre permitido; as travas valem só para subir.
  IF (rk ->> p_mode)::int > (rk ->> cfg.publish_mode)::int THEN
    SELECT * INTO ag FROM public.ai_agents WHERE organization_id = org AND key = 'exec:geral';
    IF ag.id IS NULL OR ag.status <> 'ativo' THEN
      RAISE EXCEPTION 'monte e aprove o Time de IA primeiro (Atendente geral)' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.guardian_reviews WHERE organization_id = org AND subject_type = 'agente' AND subject_id = ag.id AND status <> 'reprovado') THEN
      RAISE EXCEPTION 'o Guardião de segurança precisa aprovar o Atendente geral antes' USING ERRCODE = '22023';
    END IF;
    IF NOT (private.agent_proof(ag.id) ->> 'ok')::boolean THEN
      RAISE EXCEPTION 'o Atendente geral precisa passar na prova (em dia) antes de enviar mensagens' USING ERRCODE = '22023';
    END IF;
    IF p_mode = 'automatico' AND (cfg.publish_mode <> 'assistido' OR cfg.publish_mode_since > now() - interval '14 days'
         OR EXISTS (SELECT 1 FROM public.ai_breaker_events WHERE organization_id = org AND created_at > now() - interval '14 days')) THEN
      RAISE EXCEPTION 'automático só depois de 14 dias no assistido sem nenhum tropeço' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_mode <> cfg.publish_mode THEN
    UPDATE public.agent_configs SET publish_mode = p_mode, publish_mode_since = now() WHERE organization_id = org;
    UPDATE public.ai_agents SET autonomia = CASE p_mode WHEN 'automatico' THEN 'A4' WHEN 'assistido' THEN 'A3' ELSE 'A1' END
    WHERE organization_id = org AND key = 'exec:geral';
  END IF;
  PERFORM private.audit(org, 'ai.publish_mode', NULL, jsonb_build_object('de', cfg.publish_mode, 'para', p_mode));
END $$;
REVOKE ALL ON FUNCTION public.set_publish_mode(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_publish_mode(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_agent_status(p_id uuid, p_status text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.ai_agents;
BEGIN
  SELECT * INTO a FROM public.ai_agents WHERE id = p_id FOR UPDATE;
  IF a.id IS NULL OR NOT private.has_permission(a.organization_id, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('ativo', 'pausado') THEN RAISE EXCEPTION 'situação inválida' USING ERRCODE = '22023'; END IF;
  IF p_status = 'ativo' AND EXISTS (SELECT 1 FROM public.guardian_reviews WHERE organization_id = a.organization_id
       AND subject_type = 'agente' AND subject_id = a.id AND status = 'reprovado') THEN
    RAISE EXCEPTION 'o Guardião de segurança reprovou este agente: monte o time de novo' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ai_agents SET status = p_status WHERE id = p_id;
  -- Pausar quem atende para a IA de verdade: volta para a sombra (só sugere).
  IF p_status = 'pausado' AND a.key = 'exec:geral' THEN
    UPDATE public.agent_configs SET publish_mode = 'sombra', publish_mode_since = now()
    WHERE organization_id = a.organization_id AND publish_mode <> 'sombra';
    UPDATE public.ai_agents SET autonomia = 'A1' WHERE id = p_id;
  END IF;
  PERFORM private.audit(a.organization_id, 'agent.status', a.key, jsonb_build_object('status', p_status));
END $$;
REVOKE ALL ON FUNCTION public.set_agent_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_agent_status(uuid, text) TO authenticated;

-- 4. Rede: descartar pergunta e vencimento das que esperam o dono.
CREATE OR REPLACE FUNCTION public.dismiss_agent_task(p_task uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.agent_tasks;
BEGIN
  SELECT * INTO t FROM public.agent_tasks WHERE id = p_task FOR UPDATE;
  IF t.id IS NULL OR NOT private.has_permission(t.organization_id, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF t.status <> 'aberta' THEN RETURN; END IF;
  UPDATE public.agent_tasks SET status = 'expirada', answered_by = auth.uid(), done_at = now() WHERE id = p_task;
  PERFORM private.audit(t.organization_id, 'network.dismiss', p_task::text, '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.dismiss_agent_task(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dismiss_agent_task(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.agent_network_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t record; base text; secret text;
BEGIN
  -- Pergunta esperando o dono há mais de 14 dias vence (a fila de 30 abertas nunca trava).
  UPDATE public.agent_tasks SET status = 'expirada', done_at = now()
  WHERE status = 'aberta' AND to_agent IS NULL AND created_at < now() - interval '14 days';
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

-- 5. LGPD: anonimização e expurgo.
CREATE OR REPLACE FUNCTION private.ai_suggestions_on_anonymize()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.anonymized_at IS NOT NULL AND OLD.anonymized_at IS NULL THEN
    UPDATE public.ai_suggestions s SET content = '[removido — LGPD]'
    WHERE s.organization_id = NEW.organization_id
      AND s.conversation_id IN (SELECT c.id FROM public.conversations c WHERE c.organization_id = NEW.organization_id AND c.contact_id = NEW.id);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.ai_suggestions_on_anonymize() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS ai_suggestions_on_anonymize ON public.contacts;
CREATE TRIGGER ai_suggestions_on_anonymize AFTER UPDATE OF anonymized_at ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION private.ai_suggestions_on_anonymize();

CREATE OR REPLACE FUNCTION private.ai_housekeeping_tick()
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM public.ai_suggestions WHERE (used_at IS NOT NULL AND used_at < now() - interval '30 days') OR created_at < now() - interval '90 days';
  DELETE FROM public.agent_tasks WHERE status <> 'aberta' AND coalesce(done_at, created_at) < now() - interval '90 days';
$$;
REVOKE ALL ON FUNCTION private.ai_housekeeping_tick() FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ai-housekeeping';
    PERFORM cron.schedule('ai-housekeeping', '45 6 * * *', 'SELECT private.ai_housekeeping_tick()');
  END IF;
END $$;

-- 6. Funções internas fechadas.
REVOKE ALL ON FUNCTION private.coverage_write(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.agent_proof(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.agent_proof_since(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.notify_org_admins(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.cost_watch_tick() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION private.mark_ai_suggestion_used(p_id uuid)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.ai_suggestions SET used_at = now(), used_by = auth.uid()
  WHERE id = p_id AND used_at IS NULL AND private.is_member(organization_id)
$$;
REVOKE ALL ON FUNCTION private.mark_ai_suggestion_used(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.mark_ai_suggestion_used(uuid) TO authenticated;
