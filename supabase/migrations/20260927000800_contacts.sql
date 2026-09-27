-- =============================================================================
-- ClubeCRM — contatos, etiquetas, grupos de clientes, respostas rápidas,
-- notas internas e notificações (etapa 2D).
-- Spec: docs/superpowers/specs/2026-09-24-atendimento-humano-design.md §7.1–7.4
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Contatos: um por telefone na organização; conversas apontam para ele.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  phone text NOT NULL,
  name text,
  email text,
  document text,
  notes text,
  custom jsonb NOT NULL DEFAULT '{}'::jsonb,
  anonymized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, phone),
  UNIQUE (id, organization_id)
);
DROP TRIGGER IF EXISTS update_contacts_updated_at ON public.contacts;
CREATE TRIGGER update_contacts_updated_at BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS contact_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_contact_fk') THEN
    ALTER TABLE public.conversations ADD CONSTRAINT conversations_contact_fk
      FOREIGN KEY (contact_id, organization_id) REFERENCES public.contacts (id, organization_id) ON DELETE SET NULL (contact_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS conversations_contact_idx ON public.conversations (contact_id);

-- Conversa nova (ou sem contato) ganha o contato do telefone, criado se preciso.
CREATE OR REPLACE FUNCTION private.link_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE cid uuid;
BEGIN
  IF NEW.contact_id IS NOT NULL OR NEW.organization_id IS NULL OR coalesce(NEW.contact_phone, '') = '' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.contacts (organization_id, phone, name)
  VALUES (NEW.organization_id, NEW.contact_phone, NEW.contact_name)
  ON CONFLICT (organization_id, phone) DO UPDATE SET name = coalesce(public.contacts.name, EXCLUDED.name)
  RETURNING id INTO cid;
  NEW.contact_id := cid;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.link_contact() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS link_contact ON public.conversations;
-- Nome "zz_" para rodar depois de inherit_org (triggers BEFORE rodam em ordem alfabética).
DROP TRIGGER IF EXISTS zz_link_contact ON public.conversations;
CREATE TRIGGER zz_link_contact BEFORE INSERT OR UPDATE OF contact_phone ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION private.link_contact();
UPDATE public.conversations SET contact_phone = contact_phone WHERE contact_id IS NULL;

-- Contato visível = ver todas as conversas, ou ver ao menos uma conversa dele.
CREATE OR REPLACE FUNCTION private.can_see_contact(org uuid, contact uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.has_permission(org, 'conversations.view_all')
      OR EXISTS (SELECT 1 FROM public.conversations c
                 WHERE c.contact_id = contact AND c.organization_id = org
                   AND private.can_see_conversation(c.organization_id, c.department_id, c.assigned_to))
$$;

-- -----------------------------------------------------------------------------
-- Etiquetas e grupos de clientes
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text,
  UNIQUE (organization_id, name),
  UNIQUE (id, organization_id)
);
CREATE TABLE IF NOT EXISTS public.contact_tags (
  contact_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  PRIMARY KEY (contact_id, tag_id),
  FOREIGN KEY (contact_id, organization_id) REFERENCES public.contacts (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id, organization_id) REFERENCES public.tags (id, organization_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.contact_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text,
  description text,
  sensitive boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name),
  UNIQUE (id, organization_id)
);
CREATE TABLE IF NOT EXISTS public.contact_group_members (
  group_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  added_by uuid,
  actor_type text NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user', 'ai_agent', 'system')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, contact_id),
  FOREIGN KEY (group_id, organization_id) REFERENCES public.contact_groups (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id, organization_id) REFERENCES public.contacts (id, organization_id) ON DELETE CASCADE
);

-- Grupo sensível (ex.: inadimplentes) só aparece para quem tem reports.view.
CREATE OR REPLACE FUNCTION private.can_see_group(org uuid, grp uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.is_member(org)
     AND (NOT (SELECT sensitive FROM public.contact_groups WHERE id = grp)
          OR private.has_permission(org, 'reports.view'))
$$;

-- Entradas e saídas de grupo vão para a auditoria.
CREATE OR REPLACE FUNCTION private.audit_group_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.contact_group_members := coalesce(NEW, OLD);
BEGIN
  PERFORM private.audit(r.organization_id,
    CASE WHEN TG_OP = 'INSERT' THEN 'contact_group.add' ELSE 'contact_group.remove' END,
    r.contact_id::text, jsonb_build_object('group', r.group_id), r.actor_type);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.audit_group_member() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS audit_group_member ON public.contact_group_members;
CREATE TRIGGER audit_group_member AFTER INSERT OR DELETE ON public.contact_group_members
  FOR EACH ROW EXECUTE FUNCTION private.audit_group_member();

-- -----------------------------------------------------------------------------
-- Respostas rápidas, notas internas, notificações
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quick_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id uuid,
  shortcut text NOT NULL CHECK (shortcut ~ '^[a-z0-9_-]{1,30}$'),
  content text NOT NULL CHECK (length(content) BETWEEN 1 AND 4096),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (department_id, organization_id) REFERENCES public.departments (id, organization_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS quick_replies_shortcut_key
  ON public.quick_replies (organization_id, coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid), shortcut);

-- Separada de messages de propósito: nada aqui passa pelo caminho de envio.
CREATE TABLE IF NOT EXISTS public.internal_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
  author_id uuid NOT NULL DEFAULT auth.uid(),
  content text NOT NULL CHECK (length(content) BETWEEN 1 AND 4000),
  mentions uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS internal_notes_conversation_idx ON public.internal_notes (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON public.notifications (user_id, read_at, created_at DESC);

-- Menção → notificação (só membros da organização; a nota herda a org da conversa).
CREATE OR REPLACE FUNCTION private.on_note()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  SELECT organization_id INTO NEW.organization_id FROM public.conversations WHERE id = NEW.conversation_id;
  NEW.author_id := (SELECT auth.uid());
  NEW.mentions := ARRAY(SELECT DISTINCT m FROM unnest(NEW.mentions) m
                        WHERE EXISTS (SELECT 1 FROM public.organization_members om
                                      WHERE om.organization_id = NEW.organization_id AND om.user_id = m AND om.status = 'active'));
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION private.notify_mentions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.notifications (organization_id, user_id, kind, ref)
  SELECT NEW.organization_id, m, 'mention',
         jsonb_build_object('conversation_id', NEW.conversation_id, 'note_id', NEW.id, 'by', NEW.author_id)
  FROM unnest(NEW.mentions) m WHERE m IS DISTINCT FROM NEW.author_id;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS on_note ON public.internal_notes;
CREATE TRIGGER on_note BEFORE INSERT ON public.internal_notes FOR EACH ROW EXECUTE FUNCTION private.on_note();
DROP TRIGGER IF EXISTS notify_mentions ON public.internal_notes;
CREATE TRIGGER notify_mentions AFTER INSERT ON public.internal_notes FOR EACH ROW EXECUTE FUNCTION private.notify_mentions();

-- Atendimento atribuído/transferido para alguém → notificação para essa pessoa.
CREATE OR REPLACE FUNCTION private.notify_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target uuid; t public.tickets;
BEGIN
  target := CASE WHEN NEW.type = 'assigned' OR NEW.type = 'transferred' THEN (NEW.meta ->> 'to_user')::uuid END;
  IF target IS NULL OR target = NEW.actor_id THEN RETURN NULL; END IF;
  SELECT * INTO t FROM public.tickets WHERE id = NEW.ticket_id;
  INSERT INTO public.notifications (organization_id, user_id, kind, ref)
  VALUES (NEW.organization_id, target, NEW.type,
          jsonb_build_object('conversation_id', t.conversation_id, 'ticket_id', t.id, 'protocol', t.protocol));
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS notify_assignment ON public.ticket_events;
CREATE TRIGGER notify_assignment AFTER INSERT ON public.ticket_events
  FOR EACH ROW EXECUTE FUNCTION private.notify_assignment();
REVOKE ALL ON FUNCTION private.on_note(), private.notify_mentions(), private.notify_assignment() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contacts', 'tags', 'contact_tags', 'contact_groups', 'contact_group_members',
                           'quick_replies', 'internal_notes', 'notifications'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
  FOR t IN SELECT policyname || '|' || tablename FROM pg_policies WHERE schemaname = 'public'
           AND tablename IN ('contacts', 'tags', 'contact_tags', 'contact_groups', 'contact_group_members',
                             'quick_replies', 'internal_notes', 'notifications') LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', split_part(t, '|', 1), split_part(t, '|', 2));
  END LOOP;
END $$;
REVOKE INSERT, DELETE ON public.contacts FROM authenticated;          -- criados pelo gatilho
REVOKE UPDATE, DELETE ON public.internal_notes FROM authenticated;    -- notas não se editam
REVOKE INSERT, DELETE ON public.notifications FROM authenticated;
REVOKE UPDATE ON public.notifications FROM authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;
REVOKE UPDATE ON public.contacts FROM authenticated;
GRANT UPDATE (name, email, document, notes, custom) ON public.contacts TO authenticated;

CREATE POLICY "org: ver" ON public.contacts FOR SELECT TO authenticated
  USING (private.can_see_contact(organization_id, id));
CREATE POLICY "org: editar" ON public.contacts FOR UPDATE TO authenticated
  USING (private.can_see_contact(organization_id, id) AND private.has_permission(organization_id, 'conversations.attend'))
  WITH CHECK (private.has_permission(organization_id, 'conversations.attend'));

CREATE POLICY "org: ver" ON public.tags FOR SELECT TO authenticated USING (private.is_member(organization_id));
CREATE POLICY "org: gerenciar" ON public.tags FOR ALL TO authenticated
  USING (private.has_permission(organization_id, 'library.manage'))
  WITH CHECK (private.has_permission(organization_id, 'library.manage'));
CREATE POLICY "org: ver" ON public.contact_tags FOR SELECT TO authenticated
  USING (private.can_see_contact(organization_id, contact_id));
CREATE POLICY "org: marcar" ON public.contact_tags FOR ALL TO authenticated
  USING (private.can_see_contact(organization_id, contact_id) AND private.has_permission(organization_id, 'conversations.attend'))
  WITH CHECK (private.can_see_contact(organization_id, contact_id) AND private.has_permission(organization_id, 'conversations.attend'));

CREATE POLICY "org: ver" ON public.contact_groups FOR SELECT TO authenticated
  USING (private.can_see_group(organization_id, id));
CREATE POLICY "org: gerenciar" ON public.contact_groups FOR ALL TO authenticated
  USING (private.has_permission(organization_id, 'contacts.groups_manage'))
  WITH CHECK (private.has_permission(organization_id, 'contacts.groups_manage'));
CREATE POLICY "org: ver" ON public.contact_group_members FOR SELECT TO authenticated
  USING (private.can_see_group(organization_id, group_id) AND private.can_see_contact(organization_id, contact_id));
CREATE POLICY "org: gerenciar" ON public.contact_group_members FOR ALL TO authenticated
  USING (private.has_permission(organization_id, 'contacts.groups_manage') AND private.can_see_group(organization_id, group_id))
  WITH CHECK (private.has_permission(organization_id, 'contacts.groups_manage') AND private.can_see_group(organization_id, group_id)
              AND private.can_see_contact(organization_id, contact_id));

CREATE POLICY "org: ver" ON public.quick_replies FOR SELECT TO authenticated USING (private.is_member(organization_id));
CREATE POLICY "org: gerenciar" ON public.quick_replies FOR ALL TO authenticated
  USING (private.has_permission(organization_id, 'library.manage'))
  WITH CHECK (private.has_permission(organization_id, 'library.manage'));

CREATE POLICY "org: ver" ON public.internal_notes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = internal_notes.conversation_id));
CREATE POLICY "org: anotar" ON public.internal_notes FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = internal_notes.conversation_id
                      AND private.has_permission(c.organization_id, 'conversations.attend')));

CREATE POLICY "org: minhas" ON public.notifications FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "org: marcar lida" ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

REVOKE ALL ON FUNCTION private.link_contact() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.can_see_contact(uuid, uuid), private.can_see_group(uuid, uuid) TO authenticated;
