-- =============================================================================
-- 3B-1 — Espera, pesquisa pós-atendimento, opt-out e estatísticas do fluxo
--  * run-flows: cron a cada minuto retoma runs com wait_until vencido (só chama
--    a função quando existe algum).
--  * Pós-finalização: humano finalizou → run do post_close_flow_id da MESMA org.
--    Nunca bloqueia o fechamento do atendimento.
--  * Opt-out (LGPD): contacts.opted_out_at; só o backend grava; desfazer é RPC
--    com permissão e auditoria.
-- Idempotente.
-- =============================================================================

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS opted_out_at timestamptz;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS rating smallint;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS rating_comment text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tickets_rating_range') THEN
    ALTER TABLE public.tickets ADD CONSTRAINT tickets_rating_range CHECK (rating BETWEEN 0 AND 10);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS flow_runs_due_idx ON public.flow_runs (wait_until)
  WHERE state IN ('waiting_input', 'waiting_timer') AND wait_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS flow_runs_conversation_active_idx ON public.flow_runs (conversation_id)
  WHERE state IN ('running', 'waiting_input', 'waiting_timer', 'ai');

-- Cron: só acorda a Edge Function quando há run vencido.
CREATE OR REPLACE FUNCTION private.run_flows_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.flow_runs
                 WHERE state IN ('waiting_input', 'waiting_timer') AND wait_until <= now()) THEN
    RETURN;
  END IF;
  SELECT value INTO base FROM public.app_settings WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'platform:cron_secret';
  IF coalesce(base, '') = '' OR secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := base || '/run-flows',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION private.run_flows_tick() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'run-flows') THEN
    PERFORM cron.unschedule('run-flows');
  END IF;
  PERFORM cron.schedule('run-flows', '* * * * *', 'SELECT private.run_flows_tick()');
END $$;

-- Humano finalizou → pesquisa/fluxo pós-atendimento (spec fluxo §6.3).
CREATE OR REPLACE FUNCTION private.start_post_close_flow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE fid text; vid uuid; g jsonb; start_id text; opted timestamptz;
BEGIN
  IF NOT (OLD.status = 'open' AND NEW.status = 'closed') THEN RETURN NULL; END IF;
  BEGIN
    SELECT settings ->> 'post_close_flow_id' INTO fid FROM public.organizations WHERE id = NEW.organization_id;
    IF fid IS NULL OR fid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NULL; END IF;
    SELECT ct.opted_out_at INTO opted FROM public.conversations c
      JOIN public.contacts ct ON ct.id = c.contact_id WHERE c.id = NEW.conversation_id;
    IF opted IS NOT NULL THEN RETURN NULL; END IF;
    -- Só fluxo da própria organização (settings não é fonte de confiança).
    SELECT id, graph INTO vid, g FROM public.flow_versions
      WHERE flow_id = fid::uuid AND organization_id = NEW.organization_id AND status = 'published';
    IF vid IS NULL THEN RETURN NULL; END IF;
    SELECT n ->> 'id' INTO start_id FROM jsonb_array_elements(g -> 'nodes') n WHERE n ->> 'type' = 'start' LIMIT 1;
    IF start_id IS NULL THEN RETURN NULL; END IF;
    INSERT INTO public.flow_runs (organization_id, ticket_id, conversation_id, flow_version_id, current_node_id, state, wait_until)
    SELECT NEW.organization_id, NEW.id, NEW.conversation_id, vid, start_id, 'waiting_timer', now()
    WHERE NOT EXISTS (SELECT 1 FROM public.flow_runs WHERE ticket_id = NEW.id
                      AND state IN ('running', 'waiting_input', 'waiting_timer', 'ai'));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pos-atendimento nao iniciado: %', SQLERRM;
  END;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.start_post_close_flow() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS start_post_close_flow ON public.tickets;
CREATE TRIGGER start_post_close_flow AFTER UPDATE OF status ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION private.start_post_close_flow();

-- Atendimento novo na conversa encerra o pós-atendimento pendente.
CREATE OR REPLACE FUNCTION private.cancel_post_close_on_new_ticket()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.flow_runs SET state = 'cancelled', finished_at = now(), vars = '{}'::jsonb, wait_until = NULL
  WHERE conversation_id = NEW.conversation_id AND ticket_id <> NEW.id
    AND state IN ('running', 'waiting_input', 'waiting_timer', 'ai');
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.cancel_post_close_on_new_ticket() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS cancel_post_close_on_new_ticket ON public.tickets;
CREATE TRIGGER cancel_post_close_on_new_ticket AFTER INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION private.cancel_post_close_on_new_ticket();

-- Desfazer opt-out a pedido do cliente: permissão de atender + auditoria.
CREATE OR REPLACE FUNCTION public.clear_opt_out(contact uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE o uuid;
BEGIN
  SELECT organization_id INTO o FROM public.contacts WHERE id = contact;
  IF o IS NULL OR NOT private.has_permission(o, 'conversations.attend') THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  UPDATE public.contacts SET opted_out_at = NULL WHERE id = contact AND opted_out_at IS NOT NULL;
  IF FOUND THEN
    INSERT INTO public.audit_log (organization_id, actor_id, action, target)
    VALUES (o, (SELECT auth.uid()), 'contact.opt_out_cleared', contact::text);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.clear_opt_out(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_opt_out(uuid) TO authenticated;

-- Estatísticas por bloco e saída (só ids e contagens).
CREATE OR REPLACE FUNCTION public.flow_stats(flow uuid, period integer DEFAULT 7)
RETURNS TABLE (node_id text, outcome text, n bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE o uuid;
BEGIN
  SELECT f.organization_id INTO o FROM public.flows f WHERE f.id = flow;
  IF o IS NULL OR NOT (private.has_permission(o, 'org.settings') OR private.has_permission(o, 'reports.view')) THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT s.node_id, s.outcome, count(*)
    FROM public.flow_run_steps s
    JOIN public.flow_versions v ON v.id = s.flow_version_id AND v.organization_id = o
    WHERE v.flow_id = flow AND s.organization_id = o
      AND s.created_at > now() - make_interval(days => least(greatest(period, 1), 30))
    GROUP BY s.node_id, s.outcome;
END $$;
REVOKE ALL ON FUNCTION public.flow_stats(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.flow_stats(uuid, integer) TO authenticated;
