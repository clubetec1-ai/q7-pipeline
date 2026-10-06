-- Degraus de publicação, disjuntor, botão de parar e vigia de custo (desenho 07, fatia 7). Idempotente.
--  * Toda resposta da IA ao cliente passa pela porta única (_shared/publish-gate.ts): sombra (só sugere),
--    assistido (envia o simples, o resto vai para uma pessoa), automático (envia). Começa em sombra.
--  * Sair da sombra exige o Atendente geral (IA) ativo e com prova em dia; automático, 14 dias no assistido
--    sem tropeço. Voltar para a sombra (ou desligar) é sempre permitido.
--  * Disjuntor: 3 tropeços em 24 h (resposta segurada pela trava, avaliação ruim de atendimento com IA)
--    voltam um degrau sozinho e avisam o dono e a Clubetec.
--  * Vigia de custo: avisa uso de IA fora do normal (3× a média de 14 dias) com o motivo provável.
--  * Defesa em profundidade: ninguém logado tem TRUNCATE/TRIGGER/REFERENCES em tabela nenhuma.

-- Permissões que o app nunca usa (TRUNCATE ignora as regras de isolamento).
REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated;

ALTER TABLE public.agent_configs ADD COLUMN IF NOT EXISTS publish_mode text NOT NULL DEFAULT 'sombra';
ALTER TABLE public.agent_configs ADD COLUMN IF NOT EXISTS publish_mode_since timestamptz NOT NULL DEFAULT now();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_configs_publish_mode_check') THEN
    ALTER TABLE public.agent_configs ADD CONSTRAINT agent_configs_publish_mode_check CHECK (publish_mode IN ('sombra', 'assistido', 'automatico'));
  END IF;
END $$;
-- O navegador continua gravando o comportamento e o liga/desliga, mas não o modo (só pela função com as travas).
REVOKE INSERT, UPDATE, DELETE ON public.agent_configs FROM authenticated;
GRANT INSERT (organization_id, user_id, system_prompt, enabled, followup_inactivity_minutes, followup_max_per_conversation, groq_model, groq_api_key, created_at, updated_at)
  ON public.agent_configs TO authenticated;
GRANT UPDATE (organization_id, user_id, system_prompt, enabled, followup_inactivity_minutes, followup_max_per_conversation, groq_model, groq_api_key, created_at, updated_at)
  ON public.agent_configs TO authenticated;

-- Sugestões da IA que não foram enviadas (sombra, precisa de pessoa, segurada pela trava).
CREATE TABLE IF NOT EXISTS public.ai_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  ticket_id uuid,
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 8000),
  mode text NOT NULL CHECK (mode IN ('sombra', 'assistido', 'automatico')),
  motivo text NOT NULL CHECK (motivo IN ('sombra', 'precisa_pessoa', 'bloqueio')),
  guard text[] NOT NULL DEFAULT '{}',
  used_at timestamptz,
  used_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_suggestions_conv_idx ON public.ai_suggestions (conversation_id, created_at DESC);
ALTER TABLE public.ai_suggestions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_suggestions FROM anon, authenticated;
GRANT SELECT ON public.ai_suggestions TO authenticated;
-- Vê a sugestão quem vê a conversa (a regra de acesso da própria conversa vale dentro do EXISTS).
DROP POLICY IF EXISTS "ler: quem ve a conversa" ON public.ai_suggestions;
CREATE POLICY "ler: quem ve a conversa" ON public.ai_suggestions FOR SELECT TO authenticated
  USING (private.is_member(organization_id) AND EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.organization_id = ai_suggestions.organization_id));

CREATE OR REPLACE FUNCTION public.service_ai_suggestion_save(org uuid, p_conv uuid, p_ticket uuid, p_content text, p_mode text, p_motivo text, p_guard text[])
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE rid uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.conversations WHERE id = p_conv AND organization_id = org) THEN
    RAISE EXCEPTION 'conversa não encontrada nesta empresa' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.ai_suggestions (organization_id, conversation_id, ticket_id, content, mode, motivo, guard)
  VALUES (org, p_conv, p_ticket, left(p_content, 8000), p_mode, p_motivo, coalesce(p_guard, '{}')) RETURNING id INTO rid;
  RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.service_ai_suggestion_save(uuid, uuid, uuid, text, text, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_ai_suggestion_save(uuid, uuid, uuid, text, text, text, text[]) TO service_role;

-- Atendente marca que usou a sugestão (só quem vê a conversa).
CREATE OR REPLACE FUNCTION public.mark_ai_suggestion_used(p_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ai_suggestions WHERE id = p_id) THEN RAISE EXCEPTION 'sugestão não encontrada' USING ERRCODE = '22023'; END IF;
  PERFORM private.mark_ai_suggestion_used(p_id);
END $$;
CREATE OR REPLACE FUNCTION private.mark_ai_suggestion_used(p_id uuid)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.ai_suggestions SET used_at = now(), used_by = auth.uid() WHERE id = p_id AND used_at IS NULL
$$;
REVOKE ALL ON FUNCTION public.mark_ai_suggestion_used(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_ai_suggestion_used(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.mark_ai_suggestion_used(uuid) TO authenticated;

-- Tropeços do disjuntor.
CREATE TABLE IF NOT EXISTS public.ai_breaker_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('guard_block', 'avaliacao_ruim', 'manual', 'stepdown')),
  detail text NOT NULL DEFAULT '' CHECK (char_length(detail) <= 300),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_breaker_events_org_idx ON public.ai_breaker_events (organization_id, created_at DESC);
ALTER TABLE public.ai_breaker_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_breaker_events FROM anon, authenticated;
GRANT SELECT ON public.ai_breaker_events TO authenticated;
DROP POLICY IF EXISTS "ler: dono" ON public.ai_breaker_events;
CREATE POLICY "ler: dono" ON public.ai_breaker_events FOR SELECT TO authenticated USING (private.has_permission(organization_id, 'org.settings'));

-- Avisa dono/admin da empresa (sino; e-mail para os tipos da lista).
CREATE OR REPLACE FUNCTION private.notify_org_admins(org uuid, p_kind text, p_ref jsonb)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.notifications (organization_id, user_id, kind, ref)
  SELECT org, m.user_id, p_kind, p_ref FROM public.organization_members m
  WHERE m.organization_id = org AND m.status = 'active' AND m.role IN ('owner', 'admin')
$$;

CREATE OR REPLACE FUNCTION public.service_breaker_event(org uuid, p_kind text, p_detail text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE cur text; since timestamptz; n int; novo text;
BEGIN
  INSERT INTO public.ai_breaker_events (organization_id, kind, detail) VALUES (org, p_kind, left(coalesce(p_detail, ''), 300));
  SELECT publish_mode INTO cur FROM public.agent_configs WHERE organization_id = org FOR UPDATE;
  IF cur IS NULL OR cur = 'sombra' THEN RETURN coalesce(cur, 'sombra'); END IF;
  since := greatest(now() - interval '24 hours',
    coalesce((SELECT max(created_at) FROM public.ai_breaker_events WHERE organization_id = org AND kind = 'stepdown'), '-infinity'));
  SELECT count(*) INTO n FROM public.ai_breaker_events WHERE organization_id = org AND kind <> 'stepdown' AND created_at > since;
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
REVOKE ALL ON FUNCTION public.service_breaker_event(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_breaker_event(uuid, text, text) TO service_role;

-- Avaliação ruim de um atendimento em que a IA respondeu conta como tropeço.
CREATE OR REPLACE FUNCTION private.breaker_on_bad_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'done' AND NEW.satisfied = 'nao' AND (OLD.status IS DISTINCT FROM 'done')
     AND EXISTS (SELECT 1 FROM public.messages m WHERE m.ticket_id = NEW.ticket_id AND m.sender = 'ai') THEN
    PERFORM public.service_breaker_event(NEW.organization_id, 'avaliacao_ruim', left(coalesce(NEW.reason, ''), 200));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS breaker_on_bad_review ON public.ticket_reviews;
CREATE TRIGGER breaker_on_bad_review AFTER UPDATE OF status ON public.ticket_reviews
  FOR EACH ROW EXECUTE FUNCTION private.breaker_on_bad_review();

-- Dono: muda o degrau. Voltar para a sombra é sempre permitido; subir tem travas.
CREATE OR REPLACE FUNCTION public.set_publish_mode(org uuid, p_mode text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE cfg public.agent_configs; ag public.ai_agents;
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF p_mode NOT IN ('sombra', 'assistido', 'automatico') THEN RAISE EXCEPTION 'modo inválido' USING ERRCODE = '22023'; END IF;
  SELECT * INTO cfg FROM public.agent_configs WHERE organization_id = org FOR UPDATE;
  IF cfg.organization_id IS NULL THEN RAISE EXCEPTION 'configure o Assistente de IA primeiro' USING ERRCODE = '22023'; END IF;
  IF p_mode <> 'sombra' THEN
    SELECT * INTO ag FROM public.ai_agents WHERE organization_id = org AND key = 'exec:geral';
    IF ag.id IS NULL OR ag.status <> 'ativo' THEN
      RAISE EXCEPTION 'monte e aprove o Time de IA primeiro (Atendente geral)' USING ERRCODE = '22023';
    END IF;
    IF NOT (private.agent_proof(ag.id) ->> 'ok')::boolean THEN
      RAISE EXCEPTION 'o Atendente geral precisa passar na prova (em dia) antes de enviar mensagens' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_mode = 'automatico' AND (cfg.publish_mode <> 'assistido' OR cfg.publish_mode_since > now() - interval '14 days'
       OR EXISTS (SELECT 1 FROM public.ai_breaker_events WHERE organization_id = org AND created_at > now() - interval '14 days')) THEN
    RAISE EXCEPTION 'automático só depois de 14 dias no assistido sem nenhum tropeço' USING ERRCODE = '22023';
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

-- Vigia de custo (todo dia): uso de IA de ontem 3× acima da média dos 14 dias anteriores (mínimo 50 chamadas).
CREATE OR REPLACE FUNCTION private.cost_watch_tick()
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record; msgs_y numeric; msgs_avg numeric; motivo text; n int := 0;
BEGIN
  FOR r IN
    SELECT u.organization_id AS org,
           sum(u.calls) FILTER (WHERE u.day = current_date - 1) AS ontem,
           coalesce(sum(u.calls) FILTER (WHERE u.day BETWEEN current_date - 15 AND current_date - 2), 0) / 14.0 AS media
    FROM public.ai_usage_daily u WHERE u.day >= current_date - 15
    GROUP BY u.organization_id
  LOOP
    CONTINUE WHEN coalesce(r.ontem, 0) < 50 OR r.ontem <= 3 * greatest(r.media, 1);
    SELECT count(*) INTO msgs_y FROM public.messages WHERE organization_id = r.org AND direction = 'inbound'
      AND created_at >= current_date - 1 AND created_at < current_date;
    SELECT count(*) / 14.0 INTO msgs_avg FROM public.messages WHERE organization_id = r.org AND direction = 'inbound'
      AND created_at >= current_date - 15 AND created_at < current_date - 1;
    motivo := CASE WHEN msgs_y >= 2 * greatest(msgs_avg, 1) THEN 'mais atendimentos que o normal (o gasto acompanha o movimento)'
                   ELSE 'uso de IA fora do normal sem aumento de atendimentos — possível conversa em laço, documento grande repetido ou configuração; vale conferir e, se for o caso, pausar o agente' END;
    PERFORM private.notify_org_admins(r.org, 'cost_alert', jsonb_build_object('ontem', r.ontem, 'media', round(r.media, 1), 'motivo', motivo));
    PERFORM private.notify_platform_operators('cost_alert', jsonb_build_object('org', r.org, 'ontem', r.ontem, 'media', round(r.media, 1), 'motivo', motivo));
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cost-watch';
    PERFORM cron.schedule('cost-watch', '30 12 * * *', 'SELECT private.cost_watch_tick()');
  END IF;
END $$;

-- E-mail também para a volta de degrau do disjuntor e para o vigia de custo.
CREATE OR REPLACE FUNCTION private.email_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text;
BEGIN
  IF NEW.kind NOT IN ('number_health', 'email_health', 'security_alert', 'brain_weekly', 'brain_goal', 'brain_reminder',
                      'support_ticket', 'support_received', 'support_status',
                      'breaker_stepdown', 'cost_alert') THEN RETURN NULL; END IF;
  IF NEW.kind LIKE 'brain_%' THEN
    IF NOT coalesce((SELECT (settings ->> 'brain_email')::boolean FROM public.organizations WHERE id = NEW.organization_id), false) THEN RETURN NULL; END IF;
    IF NEW.kind = 'brain_reminder' AND NOT coalesce((NEW.ref ->> 'escalado')::boolean, false) THEN RETURN NULL; END IF;
  END IF;
  SELECT value INTO base FROM public.app_settings WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'platform:cron_secret';
  IF coalesce(base, '') = '' OR secret IS NULL THEN RETURN NULL; END IF;
  PERFORM net.http_post(
    url := base || '/notify-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := jsonb_build_object('notification_id', NEW.id));
  RETURN NULL;
END $$;
