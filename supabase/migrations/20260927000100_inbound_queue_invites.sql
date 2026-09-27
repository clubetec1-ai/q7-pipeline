-- =============================================================================
-- ClubeCRM — fila de mensagens recebidas e aceite de convite (plano 1C-2).
-- Idempotente.
-- =============================================================================

-- Estágio do processamento: reprocessar um evento continua de onde parou, sem
-- gravar a mensagem duas vezes. claimed_at marca quem está processando.
ALTER TABLE public.inbound_events
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'received',
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inbound_events_stage_check') THEN
    ALTER TABLE public.inbound_events ADD CONSTRAINT inbound_events_stage_check
      CHECK (stage IN ('received', 'stored', 'done'));
  END IF;
  ALTER TABLE public.inbound_events DROP CONSTRAINT IF EXISTS inbound_events_status_check;
  ALTER TABLE public.inbound_events ADD CONSTRAINT inbound_events_status_check
    CHECK (status IN ('pending', 'processing', 'processed', 'failed', 'skipped'));
END $$;
DROP INDEX IF EXISTS public.inbound_events_pending_idx;
CREATE INDEX IF NOT EXISTS inbound_events_pending_idx
  ON public.inbound_events (status, created_at) WHERE status IN ('pending', 'failed', 'processing');

-- Reivindica eventos para reprocessar: pendentes/falhos (até 5 tentativas) ou
-- presos em "processing" (função caiu no meio). SKIP LOCKED evita que duas
-- execuções peguem o mesmo evento.
CREATE OR REPLACE FUNCTION public.claim_inbound_events(max_rows integer DEFAULT 20)
RETURNS SETOF public.inbound_events LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.inbound_events e
  SET status = 'processing', attempts = e.attempts + 1, claimed_at = now()
  WHERE e.id IN (
    SELECT id FROM public.inbound_events
    WHERE (status IN ('pending', 'failed') AND attempts < 5 AND created_at < now() - interval '30 seconds')
       OR (status = 'processing' AND claimed_at < now() - interval '5 minutes' AND attempts < 5)
    ORDER BY created_at
    LIMIT least(greatest(max_rows, 1), 100)
    FOR UPDATE SKIP LOCKED
  )
  RETURNING e.*
$$;
REVOKE ALL ON FUNCTION public.claim_inbound_events(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_inbound_events(integer) TO service_role;

-- O próprio convidado aceita o convite (invited → active). Não serve para
-- reativar quem foi desativado.
CREATE OR REPLACE FUNCTION public.accept_invitation(org uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.organization_members
  SET status = 'active'
  WHERE organization_id = org AND user_id = (SELECT auth.uid()) AND status = 'invited';
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM private.audit(org, 'member.accept', (SELECT auth.uid())::text, '{}'::jsonb);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.accept_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_invitation(uuid) TO authenticated;

-- Convites pendentes do próprio usuário (o convidado ainda não é membro ativo,
-- então a RLS de organizations não mostra o nome da empresa).
CREATE OR REPLACE FUNCTION public.my_invitations()
RETURNS TABLE (organization_id uuid, organization_name text, role public.org_role)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.organization_id, o.name, m.role
  FROM public.organization_members m
  JOIN public.organizations o ON o.id = m.organization_id AND o.status = 'active'
  WHERE m.user_id = (SELECT auth.uid()) AND m.status = 'invited'
$$;
REVOKE ALL ON FUNCTION public.my_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_invitations() TO authenticated;

-- Retenção: payload bruto tem dado pessoal; eventos resolvidos saem em 30 dias.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'inbound-events-retention') THEN
    PERFORM cron.unschedule('inbound-events-retention');
  END IF;
  PERFORM cron.schedule('inbound-events-retention', '17 4 * * *', $cron$
    DELETE FROM public.inbound_events
    WHERE status IN ('processed', 'skipped') AND created_at < now() - interval '30 days';
  $cron$);
END $$;
