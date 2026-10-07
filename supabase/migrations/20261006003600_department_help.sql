-- Etapa B, item 6: chamar outro setor para ajudar numa conversa que já tem responsável, sem transferir.
-- O setor convidado passa a VER a conversa (mensagens, notas, protocolos) e pode escrever nota interna; quem responde ao
-- cliente continua sendo o responsável. Os membros do setor convidado recebem aviso no sino. A ajuda termina quando o
-- atendimento é finalizado ou quando alguém encerra. Idempotente.
CREATE TABLE IF NOT EXISTS public.conversation_helpers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  department_id uuid NOT NULL,
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  invited_by uuid,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CONSTRAINT conversation_helpers_conv_fk FOREIGN KEY (conversation_id, organization_id) REFERENCES public.conversations (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT conversation_helpers_dept_fk FOREIGN KEY (department_id, organization_id) REFERENCES public.departments (id, organization_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS conversation_helpers_active_uq ON public.conversation_helpers (conversation_id, department_id) WHERE active;
CREATE INDEX IF NOT EXISTS conversation_helpers_dept_idx ON public.conversation_helpers (department_id) WHERE active;
ALTER TABLE public.conversation_helpers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversation_helpers FROM anon, authenticated;
GRANT SELECT ON public.conversation_helpers TO authenticated;

-- Quem é do setor convidado (e pode atender) vê a conversa enquanto a ajuda está ativa.
CREATE OR REPLACE FUNCTION private.helps_conversation(conv uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_helpers h
    WHERE h.conversation_id = conv AND h.active AND private.in_department(h.department_id)
      AND private.has_permission(h.organization_id, 'conversations.attend'))
$$;
REVOKE ALL ON FUNCTION private.helps_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.helps_conversation(uuid) TO authenticated;

DROP POLICY IF EXISTS "org: ver" ON public.conversations;
CREATE POLICY "org: ver" ON public.conversations FOR SELECT TO authenticated
  USING (private.can_see_conversation(organization_id, department_id, assigned_to) OR private.helps_conversation(id));

DROP POLICY IF EXISTS "ler: quem ve a conversa" ON public.conversation_helpers;
CREATE POLICY "ler: quem ve a conversa" ON public.conversation_helpers FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_helpers.conversation_id AND c.organization_id = conversation_helpers.organization_id));

-- Convidar: quem pode agir no atendimento aberto da conversa (responsável ou quem redistribui). Até 5 setores por vez.
CREATE OR REPLACE FUNCTION public.invite_department_help(p_conv uuid, p_dept uuid, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t public.tickets; c public.conversations; d public.departments; rid uuid; n text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
BEGIN
  SELECT * INTO c FROM public.conversations WHERE id = p_conv;
  IF c.id IS NULL THEN RAISE EXCEPTION 'conversa não encontrada' USING ERRCODE = '22023'; END IF;
  SELECT * INTO t FROM public.tickets WHERE conversation_id = p_conv AND status <> 'closed' ORDER BY created_at DESC LIMIT 1;
  IF t.id IS NULL OR NOT private.can_act_on_ticket(t) THEN RAISE EXCEPTION 'sem permissão para pedir ajuda neste atendimento' USING ERRCODE = '42501'; END IF;
  SELECT * INTO d FROM public.departments WHERE id = p_dept AND organization_id = c.organization_id;
  IF d.id IS NULL THEN RAISE EXCEPTION 'setor não encontrado' USING ERRCODE = '22023'; END IF;
  IF d.id = t.department_id THEN RAISE EXCEPTION 'o atendimento já é deste setor' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(*) FROM public.conversation_helpers WHERE conversation_id = p_conv AND active) >= 5 THEN
    RAISE EXCEPTION 'no máximo 5 setores ajudando ao mesmo tempo' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.conversation_helpers (organization_id, conversation_id, department_id, note, invited_by)
  VALUES (c.organization_id, p_conv, p_dept, n, auth.uid())
  ON CONFLICT (conversation_id, department_id) WHERE active DO NOTHING RETURNING id INTO rid;
  IF rid IS NULL THEN RAISE EXCEPTION 'este setor já está ajudando nesta conversa' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.notifications (organization_id, user_id, kind, ref)
  SELECT c.organization_id, dm.user_id, 'help_invite',
         jsonb_build_object('conversation_id', p_conv, 'setor', d.name, 'protocolo', t.protocol, 'nota', left(n, 140))
  FROM public.department_members dm
  JOIN public.organization_members om ON om.organization_id = dm.organization_id AND om.user_id = dm.user_id AND om.status = 'active'
  WHERE dm.department_id = p_dept AND dm.user_id <> auth.uid();
  INSERT INTO public.ticket_events (organization_id, ticket_id, type, meta)
  VALUES (c.organization_id, t.id, 'help_invite', jsonb_build_object('department_id', p_dept));
  PERFORM private.audit(c.organization_id, 'conversation.help_invite', p_conv::text, jsonb_build_object('department_id', p_dept));
  RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.invite_department_help(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_department_help(uuid, uuid, text) TO authenticated;

-- Encerrar a ajuda: quem convidou, quem é do setor ajudante ou quem pode agir no atendimento.
CREATE OR REPLACE FUNCTION public.end_department_help(p_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE h public.conversation_helpers; t public.tickets;
BEGIN
  SELECT * INTO h FROM public.conversation_helpers WHERE id = p_id FOR UPDATE;
  IF h.id IS NULL OR NOT h.active THEN RETURN; END IF;
  SELECT * INTO t FROM public.tickets WHERE conversation_id = h.conversation_id AND status <> 'closed' ORDER BY created_at DESC LIMIT 1;
  IF NOT (h.invited_by = auth.uid() OR private.in_department(h.department_id) OR (t.id IS NOT NULL AND private.can_act_on_ticket(t))
          OR private.has_permission(h.organization_id, 'conversations.reassign')) THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  UPDATE public.conversation_helpers SET active = false, ended_at = now() WHERE id = p_id;
END $$;
REVOKE ALL ON FUNCTION public.end_department_help(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_department_help(uuid) TO authenticated;

-- Atendimento finalizado: a ajuda termina junto.
CREATE OR REPLACE FUNCTION private.end_help_on_close()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
    UPDATE public.conversation_helpers SET active = false, ended_at = now()
    WHERE conversation_id = NEW.conversation_id AND organization_id = NEW.organization_id AND active;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.end_help_on_close() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS end_help_on_close ON public.tickets;
CREATE TRIGGER end_help_on_close AFTER UPDATE OF status ON public.tickets FOR EACH ROW EXECUTE FUNCTION private.end_help_on_close();
