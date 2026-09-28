-- =============================================================================
-- Avaliação automática do atendimento (pedido em 28/09)
--  * Ao finalizar um atendimento com pessoa (humano), entra na fila de avaliação.
--    A cada minuto, review-tickets (pg_net + x-cron-secret) lê o histórico com a
--    IA da empresa e grava: satisfeito ou não, nota 0–10 para o atendente, motivo,
--    feedback para o atendente e falhas de processo com sugestão.
--  * Liga/desliga por empresa (settings.auto_review, padrão DESLIGADO — a equipe
--    deve ser avisada de que os atendimentos são avaliados).
--  * Quem vê: o próprio atendente (as dele) e a supervisão (reports.view; quem não
--    vê tudo só vê os departamentos dele). Navegador nunca grava nem apaga.
--  * Guarda só a análise — o texto da conversa não é copiado.
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ticket_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL UNIQUE REFERENCES public.tickets(id) ON DELETE CASCADE,
  agent_id uuid,
  department_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'skipped', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  satisfied text CHECK (satisfied IS NULL OR satisfied IN ('sim', 'nao', 'indefinido')),
  score integer CHECK (score IS NULL OR score BETWEEN 0 AND 10),
  reason text,
  agent_feedback text,
  process_issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  model text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE INDEX IF NOT EXISTS ticket_reviews_org_idx ON public.ticket_reviews (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ticket_reviews_pending_idx ON public.ticket_reviews (created_at) WHERE status = 'pending';

ALTER TABLE public.ticket_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ticket_reviews FROM anon, authenticated;
GRANT SELECT ON public.ticket_reviews TO authenticated;
DROP POLICY IF EXISTS "org: ver" ON public.ticket_reviews;
CREATE POLICY "org: ver" ON public.ticket_reviews FOR SELECT TO authenticated USING (
  private.is_member(organization_id) AND (
    agent_id = (SELECT auth.uid())
    OR (private.has_permission(organization_id, 'reports.view')
        AND (private.has_permission(organization_id, 'conversations.view_all')
             OR department_id IS NULL OR private.in_department(department_id)))));

-- Finalizou com pessoa → fila de avaliação (se a empresa ligou).
CREATE OR REPLACE FUNCTION private.enqueue_ticket_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'closed' AND OLD.status <> 'closed' AND OLD.assigned_to IS NOT NULL
     AND coalesce((SELECT (settings ->> 'auto_review')::boolean FROM public.organizations WHERE id = NEW.organization_id), false) THEN
    INSERT INTO public.ticket_reviews (organization_id, ticket_id, agent_id, department_id)
    VALUES (NEW.organization_id, NEW.id, OLD.assigned_to, coalesce(NEW.department_id, OLD.department_id))
    ON CONFLICT (ticket_id) DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.enqueue_ticket_review() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enqueue_ticket_review ON public.tickets;
CREATE TRIGGER enqueue_ticket_review AFTER UPDATE OF status ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION private.enqueue_ticket_review();

-- Liga/desliga (dono/admin).
CREATE OR REPLACE FUNCTION public.set_auto_review(org uuid, enabled boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  UPDATE public.organizations SET settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object('auto_review', enabled)
  WHERE id = org;
  INSERT INTO public.audit_log (organization_id, actor_id, action, target, meta)
  VALUES (org, auth.uid(), 'reviews.toggle', NULL, jsonb_build_object('enabled', enabled));
END $$;
REVOKE ALL ON FUNCTION public.set_auto_review(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_auto_review(uuid, boolean) TO authenticated;

-- Cron: review-tickets a cada minuto, só se houver avaliação pendente.
CREATE OR REPLACE FUNCTION private.review_tickets_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ticket_reviews WHERE status = 'pending') THEN RETURN; END IF;
  SELECT value INTO base FROM public.app_settings WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'platform:cron_secret';
  IF coalesce(base, '') = '' OR secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := base || '/review-tickets',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
END $$;
REVOKE ALL ON FUNCTION private.review_tickets_tick() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'review-tickets') THEN
    PERFORM cron.unschedule('review-tickets');
  END IF;
  PERFORM cron.schedule('review-tickets', '* * * * *', 'SELECT private.review_tickets_tick()');
END $$;
