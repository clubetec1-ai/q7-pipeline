-- =============================================================================
-- E-mail completo (Fase 1, item 4): a IA pode responder e-mails, por caixa.
--  * email_accounts.ai_reply (desligado por padrão; o dono liga em Números → E-mails);
--  * service_ticket_for_inbound: e-mail novo nasce "com a IA" (bot) só quando a caixa
--    tem ai_reply, o agente da empresa está ligado e o módulo de IA está ativo;
--    senão continua indo para a fila das pessoas (igual a antes).
-- Idempotente.
-- =============================================================================
ALTER TABLE public.email_accounts ADD COLUMN IF NOT EXISTS ai_reply boolean NOT NULL DEFAULT false;
GRANT UPDATE (ai_reply) ON public.email_accounts TO authenticated;

CREATE OR REPLACE FUNCTION public.service_ticket_for_inbound(conv uuid, from_me boolean)
RETURNS public.tickets LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c public.conversations;
  t public.tickets;
  ai_on boolean;
  dept uuid;
BEGIN
  SELECT * INTO c FROM public.conversations WHERE id = conv FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'conversa inexistente'; END IF;
  SELECT * INTO t FROM public.tickets WHERE conversation_id = conv AND status <> 'closed';

  IF t.id IS NULL THEN
    IF c.channel = 'email' THEN
      SELECT department_id, coalesce(ai_reply, false) INTO dept, ai_on FROM public.email_accounts WHERE id = c.email_account_id;
      ai_on := coalesce(ai_on, false)
        AND coalesce((SELECT enabled FROM public.agent_configs WHERE organization_id = c.organization_id), false)
        AND private.module_on(c.organization_id, 'ia');
    ELSE
      SELECT coalesce(enabled, false) INTO ai_on FROM public.agent_configs WHERE organization_id = c.organization_id;
    END IF;
    INSERT INTO public.tickets (organization_id, conversation_id, protocol, status, external_reply, queued_at, opened_at, department_id)
    VALUES (c.organization_id, conv, private.next_protocol(c.organization_id),
            CASE WHEN from_me THEN 'open' WHEN coalesce(ai_on, false) THEN 'bot' ELSE 'queued' END,
            from_me,
            CASE WHEN NOT from_me AND NOT coalesce(ai_on, false) THEN now() END,
            CASE WHEN from_me THEN now() END,
            dept)
    RETURNING * INTO t;
    PERFORM private.ticket_event(t, 'created', jsonb_build_object('status', t.status, 'channel', c.channel));
  ELSIF from_me AND t.status IN ('bot', 'queued') THEN
    UPDATE public.tickets SET status = 'open', external_reply = true, opened_at = coalesce(opened_at, now())
    WHERE id = t.id RETURNING * INTO t;
    PERFORM private.ticket_event(t, 'external_reply');
  END IF;
  PERFORM private.mirror_ticket(t);
  RETURN t;
END $$;
REVOKE ALL ON FUNCTION public.service_ticket_for_inbound(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_ticket_for_inbound(uuid, boolean) TO service_role;
