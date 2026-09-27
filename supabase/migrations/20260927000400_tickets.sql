-- =============================================================================
-- ClubeCRM — atendimentos com protocolo (etapa 2A).
-- Spec: docs/superpowers/specs/2026-09-24-atendimento-humano-design.md §4, §7.5, §7.6
-- O navegador não escreve em tickets: tudo passa pelas RPCs abaixo, que
-- conferem permissão e registram o evento. Idempotente.
-- =============================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS ticket_seq integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ticket_year integer;

CREATE TABLE IF NOT EXISTS public.close_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  protocol text NOT NULL,
  status text NOT NULL CHECK (status IN ('bot', 'queued', 'open', 'closed')),
  department_id uuid,
  assigned_to uuid,
  external_reply boolean NOT NULL DEFAULT false,
  queued_at timestamptz,
  opened_at timestamptz,
  closed_at timestamptz,
  close_reason_id uuid,
  close_note text,
  rating smallint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, protocol),
  FOREIGN KEY (department_id, organization_id)
    REFERENCES public.departments (id, organization_id) ON DELETE SET NULL (department_id),
  FOREIGN KEY (organization_id, assigned_to)
    REFERENCES public.organization_members (organization_id, user_id) ON DELETE SET NULL (assigned_to),
  FOREIGN KEY (close_reason_id, organization_id)
    REFERENCES public.close_reasons (id, organization_id) ON DELETE SET NULL (close_reason_id)
);
-- Um único atendimento aberto por conversa.
CREATE UNIQUE INDEX IF NOT EXISTS tickets_one_open_per_conversation
  ON public.tickets (conversation_id) WHERE status <> 'closed';
CREATE INDEX IF NOT EXISTS tickets_org_status_idx ON public.tickets (organization_id, status);
CREATE INDEX IF NOT EXISTS tickets_org_assignee_idx ON public.tickets (organization_id, assigned_to);

CREATE TABLE IF NOT EXISTS public.ticket_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  type text NOT NULL,
  actor_id uuid,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_events_ticket_idx ON public.ticket_events (ticket_id, created_at);

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL;

DROP TRIGGER IF EXISTS update_tickets_updated_at ON public.tickets;
CREATE TRIGGER update_tickets_updated_at BEFORE UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- -----------------------------------------------------------------------------
-- RLS: leitura segue a visibilidade da conversa; escrita só pelas RPCs.
-- -----------------------------------------------------------------------------
ALTER TABLE public.close_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.close_reasons, public.tickets, public.ticket_events FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.tickets, public.ticket_events FROM authenticated;

DROP POLICY IF EXISTS "org: ver" ON public.close_reasons;
DROP POLICY IF EXISTS "org: gerenciar" ON public.close_reasons;
CREATE POLICY "org: ver" ON public.close_reasons FOR SELECT TO authenticated
  USING (private.is_member(organization_id));
CREATE POLICY "org: gerenciar" ON public.close_reasons FOR ALL TO authenticated
  USING (private.has_permission(organization_id, 'library.manage'))
  WITH CHECK (private.has_permission(organization_id, 'library.manage'));

DROP POLICY IF EXISTS "org: ver" ON public.tickets;
CREATE POLICY "org: ver" ON public.tickets FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conversations c
                 WHERE c.id = tickets.conversation_id AND c.organization_id = tickets.organization_id));
DROP POLICY IF EXISTS "org: ver" ON public.ticket_events;
CREATE POLICY "org: ver" ON public.ticket_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_events.ticket_id));

-- -----------------------------------------------------------------------------
-- Motivos padrão para toda organização (novas e existentes).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.seed_close_reasons()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.close_reasons (organization_id, name)
  SELECT NEW.id, r FROM unnest(ARRAY['Resolvido', 'Venda realizada', 'Sem resposta do cliente',
                                     'Não era cliente', 'Encaminhado para outro canal']) AS r
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.seed_close_reasons() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS seed_close_reasons ON public.organizations;
CREATE TRIGGER seed_close_reasons AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION private.seed_close_reasons();
INSERT INTO public.close_reasons (organization_id, name)
SELECT o.id, r FROM public.organizations o,
  unnest(ARRAY['Resolvido', 'Venda realizada', 'Sem resposta do cliente',
               'Não era cliente', 'Encaminhado para outro canal']) AS r
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Núcleo
-- -----------------------------------------------------------------------------
-- Protocolo AAAA-NNNNNN por organização e ano, atômico.
CREATE OR REPLACE FUNCTION private.next_protocol(org uuid)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE y integer := extract(year FROM now())::integer; n integer;
BEGIN
  UPDATE public.organizations
  SET ticket_seq = CASE WHEN ticket_year = y THEN ticket_seq + 1 ELSE 1 END, ticket_year = y
  WHERE id = org
  RETURNING ticket_seq INTO n;
  RETURN format('%s-%s', y, lpad(n::text, 6, '0'));
END $$;

-- Conversa espelha o atendimento aberto (as telas e a IA antigas leem daqui).
CREATE OR REPLACE FUNCTION private.mirror_ticket(t public.tickets)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.conversations
  SET assigned_to = CASE WHEN t.status = 'closed' THEN NULL ELSE t.assigned_to END,
      department_id = CASE WHEN t.status = 'closed' THEN NULL ELSE t.department_id END,
      ai_enabled = (t.status = 'bot' OR t.status = 'closed'),
      human_takeover_at = CASE WHEN t.status IN ('open', 'queued') THEN coalesce(human_takeover_at, now()) ELSE NULL END
  WHERE id = t.conversation_id
$$;

CREATE OR REPLACE FUNCTION private.ticket_event(t public.tickets, ev text, info jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.ticket_events (organization_id, ticket_id, type, actor_id, meta)
  VALUES (t.organization_id, t.id, ev, (SELECT auth.uid()), coalesce(info, '{}'::jsonb))
$$;

-- Chamada pelo webhook (service_role) a cada mensagem: garante um atendimento
-- aberto e aplica a resposta pelo celular. Devolve o atendimento.
CREATE OR REPLACE FUNCTION public.service_ticket_for_inbound(conv uuid, from_me boolean)
RETURNS public.tickets LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c public.conversations;
  t public.tickets;
  ai_on boolean;
BEGIN
  SELECT * INTO c FROM public.conversations WHERE id = conv FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'conversa inexistente'; END IF;
  SELECT * INTO t FROM public.tickets WHERE conversation_id = conv AND status <> 'closed';

  IF t.id IS NULL THEN
    SELECT coalesce(enabled, false) INTO ai_on FROM public.agent_configs WHERE organization_id = c.organization_id;
    INSERT INTO public.tickets (organization_id, conversation_id, protocol, status, external_reply, queued_at, opened_at)
    VALUES (c.organization_id, conv, private.next_protocol(c.organization_id),
            CASE WHEN from_me THEN 'open' WHEN coalesce(ai_on, false) THEN 'bot' ELSE 'queued' END,
            from_me,
            CASE WHEN NOT from_me AND NOT coalesce(ai_on, false) THEN now() END,
            CASE WHEN from_me THEN now() END)
    RETURNING * INTO t;
    PERFORM private.ticket_event(t, 'created', jsonb_build_object('status', t.status));
  ELSIF from_me AND t.status IN ('bot', 'queued') THEN
    UPDATE public.tickets SET status = 'open', external_reply = true, opened_at = coalesce(opened_at, now())
    WHERE id = t.id RETURNING * INTO t;
    PERFORM private.ticket_event(t, 'external_reply');
  END IF;
  PERFORM private.mirror_ticket(t);
  RETURN t;
END $$;

-- Quem pode agir num atendimento: o responsável, quem tem reassign, ou —
-- se ninguém é responsável — quem pode atender a conversa.
CREATE OR REPLACE FUNCTION private.can_act_on_ticket(t public.tickets)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.status <> 'closed'
     AND private.can_see_conversation(t.organization_id, t.department_id, t.assigned_to)
     AND (t.assigned_to = (SELECT auth.uid())
          OR private.has_permission(t.organization_id, 'conversations.reassign')
          OR (t.assigned_to IS NULL AND private.has_permission(t.organization_id, 'conversations.attend')))
$$;

CREATE OR REPLACE FUNCTION public.claim_ticket(ticket uuid)
RETURNS public.tickets LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.tickets; who text;
BEGIN
  SELECT * INTO t FROM public.tickets WHERE id = ticket;
  IF t.id IS NULL OR NOT private.can_see_conversation(t.organization_id, t.department_id, t.assigned_to)
     OR NOT private.has_permission(t.organization_id, 'conversations.attend') THEN
    RAISE EXCEPTION 'atendimento não encontrado' USING ERRCODE = '42501';
  END IF;
  UPDATE public.tickets
  SET assigned_to = (SELECT auth.uid()), status = 'open', opened_at = coalesce(opened_at, now())
  WHERE id = ticket AND status <> 'closed'
    AND (assigned_to IS NULL OR assigned_to = (SELECT auth.uid()))
  RETURNING * INTO t;
  IF t.id IS NULL THEN
    SELECT coalesce(p.full_name, p.email) INTO who
    FROM public.tickets x JOIN public.profiles p ON p.user_id = x.assigned_to WHERE x.id = ticket;
    RAISE EXCEPTION 'já assumido por %', coalesce(who, 'outra pessoa') USING ERRCODE = '23505';
  END IF;
  PERFORM private.ticket_event(t, 'claimed');
  PERFORM private.mirror_ticket(t);
  RETURN t;
END $$;

CREATE OR REPLACE FUNCTION public.transfer_ticket(ticket uuid, to_department uuid DEFAULT NULL,
                                                  to_user uuid DEFAULT NULL, note text DEFAULT NULL)
RETURNS public.tickets LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.tickets; dept uuid;
BEGIN
  SELECT * INTO t FROM public.tickets WHERE id = ticket;
  IF t.id IS NULL OR NOT private.can_act_on_ticket(t) THEN
    RAISE EXCEPTION 'sem permissão para transferir' USING ERRCODE = '42501';
  END IF;
  IF to_department IS NULL AND to_user IS NULL THEN
    RAISE EXCEPTION 'informe o departamento ou a pessoa' USING ERRCODE = '22023';
  END IF;
  IF to_department IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.departments WHERE id = to_department AND organization_id = t.organization_id) THEN
    RAISE EXCEPTION 'departamento inválido' USING ERRCODE = '22023';
  END IF;
  dept := coalesce(to_department, t.department_id);

  IF to_user IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.organization_members
                   WHERE organization_id = t.organization_id AND user_id = to_user AND status = 'active') THEN
      RAISE EXCEPTION 'a pessoa não é membro ativo da equipe' USING ERRCODE = '22023';
    END IF;
    IF dept IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.department_members WHERE department_id = dept AND user_id = to_user) THEN
      RAISE EXCEPTION 'a pessoa não é deste departamento: escolha um departamento dela' USING ERRCODE = '22023';
    END IF;
    UPDATE public.tickets SET assigned_to = to_user, department_id = dept, status = 'open',
      opened_at = coalesce(opened_at, now())
    WHERE id = ticket RETURNING * INTO t;
  ELSE
    UPDATE public.tickets SET assigned_to = NULL, department_id = dept, status = 'queued', queued_at = now()
    WHERE id = ticket RETURNING * INTO t;
  END IF;
  PERFORM private.ticket_event(t, 'transferred',
    jsonb_build_object('to_department', to_department, 'to_user', to_user, 'note', nullif(trim(note), '')));
  PERFORM private.mirror_ticket(t);
  RETURN t;
END $$;

CREATE OR REPLACE FUNCTION public.close_ticket(ticket uuid, reason uuid, note text DEFAULT NULL)
RETURNS public.tickets LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.tickets;
BEGIN
  SELECT * INTO t FROM public.tickets WHERE id = ticket;
  IF t.id IS NULL OR NOT private.can_act_on_ticket(t) THEN
    RAISE EXCEPTION 'sem permissão para finalizar' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.close_reasons
                 WHERE id = reason AND organization_id = t.organization_id AND active) THEN
    RAISE EXCEPTION 'escolha um motivo de finalização' USING ERRCODE = '22023';
  END IF;
  UPDATE public.tickets SET status = 'closed', closed_at = now(), close_reason_id = reason,
    close_note = nullif(trim(note), '')
  WHERE id = ticket RETURNING * INTO t;
  PERFORM private.ticket_event(t, 'closed', jsonb_build_object('reason', reason));
  PERFORM private.mirror_ticket(t);
  RETURN t;
END $$;

CREATE OR REPLACE FUNCTION public.return_ticket_to_ai(ticket uuid)
RETURNS public.tickets LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.tickets;
BEGIN
  SELECT * INTO t FROM public.tickets WHERE id = ticket;
  IF t.id IS NULL OR NOT private.can_act_on_ticket(t) OR t.status = 'bot' THEN
    RAISE EXCEPTION 'sem permissão para devolver à IA' USING ERRCODE = '42501';
  END IF;
  UPDATE public.tickets SET status = 'bot', assigned_to = NULL, external_reply = false
  WHERE id = ticket RETURNING * INTO t;
  PERFORM private.ticket_event(t, 'returned_to_ai');
  PERFORM private.mirror_ticket(t);
  RETURN t;
END $$;

REVOKE ALL ON FUNCTION private.next_protocol(uuid), private.mirror_ticket(public.tickets),
  private.ticket_event(public.tickets, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.can_act_on_ticket(public.tickets) TO authenticated;
REVOKE ALL ON FUNCTION public.service_ticket_for_inbound(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_ticket_for_inbound(uuid, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.claim_ticket(uuid), public.transfer_ticket(uuid, uuid, uuid, text),
  public.close_ticket(uuid, uuid, text), public.return_ticket_to_ai(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_ticket(uuid), public.transfer_ticket(uuid, uuid, uuid, text),
  public.close_ticket(uuid, uuid, text), public.return_ticket_to_ai(uuid) TO authenticated;

-- Conversas com movimento nos últimos 7 dias ganham um atendimento aberto
-- (as antigas não entram na fila de ninguém).
DO $$
DECLARE c record; t public.tickets;
BEGIN
  FOR c IN SELECT * FROM public.conversations
           WHERE last_message_at > now() - interval '7 days'
             AND NOT EXISTS (SELECT 1 FROM public.tickets x WHERE x.conversation_id = conversations.id AND x.status <> 'closed')
  LOOP
    INSERT INTO public.tickets (organization_id, conversation_id, protocol, status, opened_at, external_reply)
    VALUES (c.organization_id, c.id, private.next_protocol(c.organization_id),
            CASE WHEN c.ai_enabled THEN 'bot' ELSE 'open' END,
            CASE WHEN c.ai_enabled THEN NULL ELSE now() END, NOT c.ai_enabled)
    RETURNING * INTO t;
    PERFORM private.ticket_event(t, 'created', jsonb_build_object('status', t.status, 'backfill', true));
  END LOOP;
END $$;
