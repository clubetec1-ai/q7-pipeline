-- =============================================================================
-- Messenger e Instagram Direct (Fase 3, item 14).
--  * meta_pages: Página do Facebook (e a conta do Instagram ligada a ela) por empresa.
--    O token da Página fica só no Vault (metapage:<id>:token); conectar/desconectar
--    é pela função meta-pages (dono/admin), que confere o token na Meta.
--  * conversations: canais 'messenger' e 'instagram', com a Página e o id da pessoa
--    na Meta (PSID/IGSID). Mesma organização garantida pela FK composta.
--  * Atendimento nasce com a IA só se a Página tem "IA responde", o agente está ligado
--    e o módulo de IA ativo (igual ao e-mail).
-- Idempotente.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.meta_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  page_id text NOT NULL UNIQUE CHECK (page_id ~ '^[0-9]{5,30}$'),
  ig_account_id text UNIQUE CHECK (ig_account_id IS NULL OR ig_account_id ~ '^[0-9]{5,30}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  ig_username text CHECK (ig_username IS NULL OR char_length(ig_username) <= 60),
  messenger boolean NOT NULL DEFAULT true,
  instagram boolean NOT NULL DEFAULT false,
  ai_reply boolean NOT NULL DEFAULT false,
  department_id uuid,
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error', 'disconnected')),
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  CONSTRAINT meta_pages_department_fk FOREIGN KEY (department_id, organization_id)
    REFERENCES public.departments (id, organization_id) ON DELETE SET NULL (department_id)
);
ALTER TABLE public.meta_pages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_pages FROM anon, authenticated;
GRANT SELECT ON public.meta_pages TO authenticated;
GRANT ALL ON public.meta_pages TO service_role;
DROP POLICY IF EXISTS "org: ver" ON public.meta_pages;
CREATE POLICY "org: ver" ON public.meta_pages FOR SELECT TO authenticated USING (private.is_member(organization_id));

ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS meta_page_id uuid;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS contact_external_id text
  CHECK (contact_external_id IS NULL OR contact_external_id ~ '^[0-9]{5,40}$');
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_meta_page_fk;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_meta_page_fk FOREIGN KEY (meta_page_id, organization_id)
  REFERENCES public.meta_pages (id, organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS conversations_meta_contact_key ON public.conversations (meta_page_id, channel, contact_external_id)
  WHERE meta_page_id IS NOT NULL;
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_channel_check;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_channel_check CHECK (
  (channel = 'whatsapp' AND contact_phone IS NOT NULL AND email_account_id IS NULL AND meta_page_id IS NULL)
  OR (channel = 'email' AND contact_email IS NOT NULL AND instance_id IS NULL AND meta_page_id IS NULL)
  OR (channel IN ('messenger', 'instagram') AND meta_page_id IS NOT NULL AND contact_external_id IS NOT NULL
      AND instance_id IS NULL AND email_account_id IS NULL));

-- Conversa herda a organização da origem (número, caixa de e-mail ou Página).
CREATE OR REPLACE FUNCTION private.inherit_org()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  parent_org uuid;
  orgs uuid[];
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.organization_id IS NOT NULL
     AND NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'registro não pode mudar de organização' USING ERRCODE = '42501';
  END IF;

  IF TG_TABLE_NAME = 'conversations' THEN
    IF NEW.instance_id IS NOT NULL THEN
      SELECT organization_id INTO parent_org FROM public.whatsapp_instances WHERE id = NEW.instance_id;
    ELSIF NEW.email_account_id IS NOT NULL THEN
      SELECT organization_id INTO parent_org FROM public.email_accounts WHERE id = NEW.email_account_id;
    ELSIF NEW.meta_page_id IS NOT NULL THEN
      SELECT organization_id INTO parent_org FROM public.meta_pages WHERE id = NEW.meta_page_id;
    ELSIF TG_OP = 'UPDATE' AND OLD.organization_id IS NOT NULL THEN
      RETURN NEW; -- canal removido; histórico fica na mesma organização
    END IF;
  ELSIF TG_TABLE_NAME IN ('messages', 'followups') THEN
    SELECT organization_id INTO parent_org FROM public.conversations WHERE id = NEW.conversation_id;
  ELSE
    IF NEW.organization_id IS NULL THEN
      SELECT array_agg(m.organization_id) INTO orgs
      FROM public.organization_members m
      JOIN public.organizations o ON o.id = m.organization_id AND o.status = 'active'
      WHERE m.user_id = coalesce((SELECT auth.uid()), NEW.user_id) AND m.status = 'active';
      IF cardinality(orgs) = 1 THEN
        NEW.organization_id := orgs[1];
      ELSE
        RAISE EXCEPTION 'informe organization_id (% organizações possíveis)', coalesce(cardinality(orgs), 0)
          USING ERRCODE = '23502';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF parent_org IS NULL THEN
    RAISE EXCEPTION 'registro pai sem organização' USING ERRCODE = '23502';
  END IF;
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := parent_org;
  ELSIF NEW.organization_id <> parent_org THEN
    RAISE EXCEPTION 'organization_id diverge do registro pai' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- Atendimento novo: e-mail e Página seguem a opção "IA responde" da origem.
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
    IF c.channel IN ('email', 'messenger', 'instagram') THEN
      IF c.channel = 'email' THEN
        SELECT department_id, coalesce(ai_reply, false) INTO dept, ai_on FROM public.email_accounts WHERE id = c.email_account_id;
      ELSE
        SELECT department_id, coalesce(ai_reply, false) INTO dept, ai_on FROM public.meta_pages WHERE id = c.meta_page_id;
      END IF;
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

-- Dono/admin muda o setor, "IA responde" e os canais da Página (conectar é pela função).
CREATE OR REPLACE FUNCTION public.set_meta_page(page uuid, p_department uuid, p_ai_reply boolean, p_messenger boolean, p_instagram boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE pg public.meta_pages;
BEGIN
  SELECT * INTO pg FROM public.meta_pages WHERE id = page;
  IF pg.id IS NULL OR NOT private.has_permission(pg.organization_id, 'org.settings') THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  IF p_department IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.departments WHERE id = p_department AND organization_id = pg.organization_id) THEN
    RAISE EXCEPTION 'setor inválido' USING ERRCODE = '42501';
  END IF;
  UPDATE public.meta_pages SET department_id = p_department, ai_reply = coalesce(p_ai_reply, false),
    messenger = coalesce(p_messenger, true), instagram = coalesce(p_instagram, false) AND ig_account_id IS NOT NULL, updated_at = now()
  WHERE id = pg.id;
  PERFORM private.audit(pg.organization_id, 'meta_page.updated', pg.id::text,
    jsonb_build_object('ai_reply', p_ai_reply, 'messenger', p_messenger, 'instagram', p_instagram));
END $$;
REVOKE ALL ON FUNCTION public.set_meta_page(uuid, uuid, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_meta_page(uuid, uuid, boolean, boolean, boolean) TO authenticated;

-- Desconectar: apaga o token da Página do Vault (só o servidor chama).
CREATE OR REPLACE FUNCTION public.service_meta_page_forget(page uuid)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM vault.secrets WHERE name = format('metapage:%s:token', page)
$$;
REVOKE ALL ON FUNCTION public.service_meta_page_forget(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_meta_page_forget(uuid) TO service_role;
