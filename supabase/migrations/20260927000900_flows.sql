-- =============================================================================
-- ClubeCRM — fluxos de atendimento (etapa 3A).
-- Spec: docs/superpowers/specs/2026-09-24-construtor-de-fluxo-design.md §4–§6
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.flow_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  flow_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  graph jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb
    CHECK (pg_column_size(graph) < 512 * 1024),
  published_at timestamptz,
  published_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (flow_id, organization_id) REFERENCES public.flows (id, organization_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS flow_versions_one_draft ON public.flow_versions (flow_id) WHERE status = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS flow_versions_one_published ON public.flow_versions (flow_id) WHERE status = 'published';

CREATE TABLE IF NOT EXISTS public.flow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  flow_version_id uuid NOT NULL REFERENCES public.flow_versions(id) ON DELETE CASCADE,
  current_node_id text,
  state text NOT NULL DEFAULT 'running'
    CHECK (state IN ('running', 'waiting_input', 'waiting_timer', 'ai', 'done', 'cancelled', 'error')),
  vars jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  wait_until timestamptz,
  ai_turns integer NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS flow_runs_one_active ON public.flow_runs (ticket_id)
  WHERE state IN ('running', 'waiting_input', 'waiting_timer', 'ai');

CREATE TABLE IF NOT EXISTS public.flow_run_steps (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.flow_runs(id) ON DELETE CASCADE,
  flow_version_id uuid NOT NULL,
  node_id text NOT NULL,
  outcome text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS flow_run_steps_version_idx ON public.flow_run_steps (flow_version_id, node_id);

ALTER TABLE public.whatsapp_instances ADD COLUMN IF NOT EXISTS flow_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_instances_flow_fk') THEN
    ALTER TABLE public.whatsapp_instances ADD CONSTRAINT whatsapp_instances_flow_fk
      FOREIGN KEY (flow_id, organization_id) REFERENCES public.flows (id, organization_id) ON DELETE SET NULL (flow_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS update_flows_updated_at ON public.flows;
CREATE TRIGGER update_flows_updated_at BEFORE UPDATE ON public.flows
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_flow_versions_updated_at ON public.flow_versions;
CREATE TRIGGER update_flow_versions_updated_at BEFORE UPDATE ON public.flow_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- -----------------------------------------------------------------------------
-- RLS: ler com org.settings ou reports.view; escrever com org.settings.
-- Runs e passos: só backend (leitura para estatística fica para a 3B).
-- -----------------------------------------------------------------------------
ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flow_run_steps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.flows, public.flow_versions, public.flow_runs, public.flow_run_steps FROM anon;
REVOKE ALL ON public.flow_runs, public.flow_run_steps FROM authenticated;
-- Publicar é só pela RPC (valida e audita); o navegador grava apenas rascunho.
REVOKE UPDATE ON public.flow_versions FROM authenticated;
GRANT UPDATE (graph, updated_by) ON public.flow_versions TO authenticated;

DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public'
           AND tablename IN ('flows', 'flow_versions') LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;
CREATE POLICY "org: ver" ON public.flows FOR SELECT TO authenticated
  USING (private.has_permission(organization_id, 'org.settings') OR private.has_permission(organization_id, 'reports.view'));
CREATE POLICY "org: gerenciar" ON public.flows FOR ALL TO authenticated
  USING (private.has_permission(organization_id, 'org.settings'))
  WITH CHECK (private.has_permission(organization_id, 'org.settings'));
CREATE POLICY "org: ver" ON public.flow_versions FOR SELECT TO authenticated
  USING (private.has_permission(organization_id, 'org.settings') OR private.has_permission(organization_id, 'reports.view'));
CREATE POLICY "org: rascunho" ON public.flow_versions FOR INSERT TO authenticated
  WITH CHECK (status = 'draft' AND private.has_permission(organization_id, 'org.settings'));
CREATE POLICY "org: editar rascunho" ON public.flow_versions FOR UPDATE TO authenticated
  USING (status = 'draft' AND private.has_permission(organization_id, 'org.settings'))
  WITH CHECK (status = 'draft' AND private.has_permission(organization_id, 'org.settings'));

-- -----------------------------------------------------------------------------
-- Publicar: valida o mínimo no servidor (um início, tipos conhecidos, arestas
-- válidas), arquiva a versão anterior e audita.
-- -----------------------------------------------------------------------------
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
                             'ai_agent', 'tag', 'transfer', 'close') LIMIT 1;
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

-- -----------------------------------------------------------------------------
-- Ações do motor sobre o atendimento (service_role): fila, transferir, finalizar.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.service_ticket_route(ticket uuid, action text,
  dept uuid DEFAULT NULL, to_user uuid DEFAULT NULL, reason uuid DEFAULT NULL)
RETURNS public.tickets LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.tickets;
BEGIN
  SELECT * INTO t FROM public.tickets WHERE id = ticket;
  IF t.id IS NULL OR t.status = 'closed' THEN RETURN t; END IF;
  IF dept IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.departments WHERE id = dept AND organization_id = t.organization_id) THEN
    dept := NULL;
  END IF;
  IF action = 'close' THEN
    IF reason IS NULL OR NOT EXISTS (SELECT 1 FROM public.close_reasons WHERE id = reason AND organization_id = t.organization_id) THEN
      SELECT id INTO reason FROM public.close_reasons WHERE organization_id = t.organization_id AND active ORDER BY name LIMIT 1;
    END IF;
    UPDATE public.tickets SET status = 'closed', closed_at = now(), close_reason_id = reason WHERE id = ticket RETURNING * INTO t;
  ELSIF action = 'transfer' AND to_user IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = t.organization_id AND user_id = to_user AND status = 'active') THEN
    UPDATE public.tickets SET status = 'open', assigned_to = to_user, department_id = dept, opened_at = coalesce(opened_at, now())
    WHERE id = ticket RETURNING * INTO t;
  ELSE -- 'queue' ou 'transfer' para departamento
    UPDATE public.tickets SET status = 'queued', assigned_to = NULL, department_id = dept, queued_at = now()
    WHERE id = ticket RETURNING * INTO t;
  END IF;
  INSERT INTO public.ticket_events (organization_id, ticket_id, type, meta)
  VALUES (t.organization_id, t.id, CASE WHEN action = 'close' THEN 'closed' ELSE 'transferred' END,
          jsonb_build_object('by', 'flow', 'to_department', dept, 'to_user', to_user));
  PERFORM private.mirror_ticket(t);
  RETURN t;
END $$;
REVOKE ALL ON FUNCTION public.service_ticket_route(uuid, text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_ticket_route(uuid, text, uuid, uuid, uuid) TO service_role;

-- Atendimento saiu de 'bot' (humano assumiu, transferência, fim) → para o fluxo.
CREATE OR REPLACE FUNCTION private.cancel_flow_on_ticket()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.status = 'bot' AND NEW.status <> 'bot' THEN
    UPDATE public.flow_runs SET state = 'cancelled', finished_at = now(), vars = '{}'::jsonb
    WHERE ticket_id = NEW.id AND state IN ('running', 'waiting_input', 'waiting_timer', 'ai');
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.cancel_flow_on_ticket() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS cancel_flow_on_ticket ON public.tickets;
CREATE TRIGGER cancel_flow_on_ticket AFTER UPDATE OF status ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION private.cancel_flow_on_ticket();

-- Retenção dos passos (só ids e resultado; 30 dias).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'flow-steps-retention') THEN
    PERFORM cron.unschedule('flow-steps-retention');
  END IF;
  PERFORM cron.schedule('flow-steps-retention', '23 4 * * *',
    $c$DELETE FROM public.flow_run_steps WHERE created_at < now() - interval '30 days'$c$);
END $$;
