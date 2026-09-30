-- =============================================================================
-- Auditoria passo 3 (30/09): e-mail automático não vira atendimento
-- "Não é atendimento" na conversa de e-mail: ignora o remetente (ou o domínio
-- inteiro) daqui para frente e fecha o atendimento aberto com o motivo "Não é
-- atendimento". Quem pode: quem atende e vê a conversa. Desfazer: dono/admin.
-- A leitura das caixas (sync-email) consulta a lista antes de abrir atendimento.
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.email_ignore (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pattern text NOT NULL CHECK (pattern ~ '^([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|@[a-z0-9.-]+\.[a-z]{2,})$'),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, pattern)
);
ALTER TABLE public.email_ignore ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_ignore FROM anon, authenticated;
GRANT SELECT ON public.email_ignore TO authenticated;
DROP POLICY IF EXISTS email_ignore_select ON public.email_ignore;
CREATE POLICY email_ignore_select ON public.email_ignore FOR SELECT TO authenticated
  USING (private.is_member(organization_id));

CREATE OR REPLACE FUNCTION public.ignore_email_sender(conv uuid, whole_domain boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.conversations; pat text; reason uuid; t public.tickets;
BEGIN
  SELECT * INTO c FROM public.conversations WHERE id = conv;
  IF c.id IS NULL OR c.channel <> 'email' OR coalesce(c.contact_email, '') = ''
     OR NOT private.has_permission(c.organization_id, 'conversations.attend')
     OR NOT private.can_see_conversation(c.organization_id, c.department_id, c.assigned_to) THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  pat := lower(trim(c.contact_email));
  IF whole_domain THEN pat := '@' || split_part(pat, '@', 2); END IF;
  INSERT INTO public.email_ignore (organization_id, pattern, created_by)
  VALUES (c.organization_id, pat, (SELECT auth.uid())) ON CONFLICT (organization_id, pattern) DO NOTHING;

  -- Motivo de finalização do sistema (criado na primeira vez).
  INSERT INTO public.close_reasons (organization_id, name) VALUES (c.organization_id, 'Não é atendimento')
  ON CONFLICT (organization_id, name) DO UPDATE SET active = true
  RETURNING id INTO reason;
  FOR t IN SELECT * FROM public.tickets WHERE conversation_id = c.id AND status <> 'closed' LOOP
    UPDATE public.tickets SET status = 'closed', closed_at = now(), close_reason_id = reason,
      close_note = 'Remetente automático ignorado: ' || pat
    WHERE id = t.id RETURNING * INTO t;
    PERFORM private.ticket_event(t, 'closed', jsonb_build_object('reason', reason, 'ignored', pat));
    PERFORM private.mirror_ticket(t);
  END LOOP;
  PERFORM private.audit(c.organization_id, 'email.ignored', pat, '{}'::jsonb);
  RETURN pat;
END $$;

CREATE OR REPLACE FUNCTION public.unignore_email(org uuid, p_pattern text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.email_ignore WHERE organization_id = org AND pattern = lower(trim(p_pattern));
  PERFORM private.audit(org, 'email.unignored', lower(trim(p_pattern)), '{}'::jsonb);
END $$;

REVOKE ALL ON FUNCTION public.ignore_email_sender(uuid, boolean), public.unignore_email(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ignore_email_sender(uuid, boolean), public.unignore_email(uuid, text) TO authenticated;
