-- =============================================================================
-- Chat interno da equipe (pedido em 29/09)
--  * Canais: 'geral' (universal: todos da empresa), 'setor' (quem é do setor +
--    dono/admin/quem vê tudo) e 'direto' (só as duas pessoas).
--  * Quem vê: decidido aqui (can_see_channel); mensagem só de quem vê o canal.
--  * Histórico não se apaga nem se edita pelo navegador. @menção avisa no sino.
--  * "Compartilhar atendimento": conversation_id da mesma empresa; abrir a
--    conversa continua dependendo da permissão de quem clica.
--  * Anexos: bucket privado "team", caminho {org}/{canal}/{arquivo}; só quem vê o
--    canal lê ou envia.
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.team_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('geral', 'setor', 'direto')),
  department_id uuid,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  dm_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, dm_key),
  CONSTRAINT team_channels_department_fk FOREIGN KEY (department_id, organization_id)
    REFERENCES public.departments (id, organization_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS team_channels_geral_key ON public.team_channels (organization_id) WHERE kind = 'geral';
CREATE UNIQUE INDEX IF NOT EXISTS team_channels_setor_key ON public.team_channels (department_id) WHERE kind = 'setor';

CREATE TABLE IF NOT EXISTS public.team_channel_members (
  organization_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  user_id uuid NOT NULL,
  PRIMARY KEY (channel_id, user_id),
  FOREIGN KEY (channel_id, organization_id) REFERENCES public.team_channels (id, organization_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.team_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  author_id uuid NOT NULL,
  content text CHECK (content IS NULL OR char_length(content) <= 4000),
  mentions uuid[] NOT NULL DEFAULT '{}',
  attachment_path text,
  attachment_name text CHECK (attachment_name IS NULL OR char_length(attachment_name) <= 200),
  conversation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (content IS NOT NULL OR attachment_path IS NOT NULL OR conversation_id IS NOT NULL),
  CHECK (cardinality(mentions) <= 20),
  FOREIGN KEY (channel_id, organization_id) REFERENCES public.team_channels (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT team_messages_conversation_fk FOREIGN KEY (conversation_id)
    REFERENCES public.conversations (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS team_messages_channel_idx ON public.team_messages (channel_id, id DESC);

CREATE TABLE IF NOT EXISTS public.team_reads (
  organization_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  last_read_id bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, user_id),
  FOREIGN KEY (channel_id, organization_id) REFERENCES public.team_channels (id, organization_id) ON DELETE CASCADE
);

-- Quem vê o canal.
CREATE OR REPLACE FUNCTION private.can_see_channel(ch uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_channels c
    WHERE c.id = ch AND private.is_member(c.organization_id) AND (
      c.kind = 'geral'
      OR (c.kind = 'setor' AND (private.in_department(c.department_id)
          OR private.has_permission(c.organization_id, 'org.settings')
          OR private.has_permission(c.organization_id, 'conversations.view_all')))
      OR (c.kind = 'direto' AND EXISTS (SELECT 1 FROM public.team_channel_members m WHERE m.channel_id = c.id AND m.user_id = (SELECT auth.uid())))))
$$;
REVOKE ALL ON FUNCTION private.can_see_channel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_see_channel(uuid) TO authenticated;

ALTER TABLE public.team_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_channel_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_channels, public.team_channel_members, public.team_messages, public.team_reads FROM anon, authenticated;
GRANT SELECT ON public.team_channels, public.team_channel_members, public.team_messages, public.team_reads TO authenticated;
GRANT INSERT (organization_id, channel_id, author_id, content, mentions, attachment_path, attachment_name, conversation_id)
  ON public.team_messages TO authenticated;
GRANT INSERT (organization_id, channel_id, user_id, last_read_id), UPDATE (last_read_id) ON public.team_reads TO authenticated;

DROP POLICY IF EXISTS "chat: ver canal" ON public.team_channels;
CREATE POLICY "chat: ver canal" ON public.team_channels FOR SELECT TO authenticated USING (private.can_see_channel(id));
DROP POLICY IF EXISTS "chat: ver membros" ON public.team_channel_members;
CREATE POLICY "chat: ver membros" ON public.team_channel_members FOR SELECT TO authenticated USING (private.can_see_channel(channel_id));
DROP POLICY IF EXISTS "chat: ler" ON public.team_messages;
CREATE POLICY "chat: ler" ON public.team_messages FOR SELECT TO authenticated USING (private.can_see_channel(channel_id));
DROP POLICY IF EXISTS "chat: escrever" ON public.team_messages;
CREATE POLICY "chat: escrever" ON public.team_messages FOR INSERT TO authenticated
  WITH CHECK (author_id = (SELECT auth.uid()) AND private.can_see_channel(channel_id)
              AND (attachment_path IS NULL OR attachment_path LIKE organization_id::text || '/' || channel_id::text || '/%')
              -- só compartilha atendimento da mesma empresa que a pessoa já pode ver (RLS de conversations)
              AND (conversation_id IS NULL OR EXISTS (SELECT 1 FROM public.conversations c
                   WHERE c.id = conversation_id AND c.organization_id = team_messages.organization_id)));
DROP POLICY IF EXISTS "chat: lidas" ON public.team_reads;
CREATE POLICY "chat: lidas" ON public.team_reads FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND private.can_see_channel(channel_id));

-- Canal geral + um por setor (cria o que faltar).
CREATE OR REPLACE FUNCTION public.ensure_team_channels(org uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_member(org) THEN RAISE EXCEPTION 'sem acesso' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.team_channels (organization_id, kind, name) VALUES (org, 'geral', 'Geral')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.team_channels (organization_id, kind, department_id, name)
  SELECT org, 'setor', d.id, left(d.name, 80) FROM public.departments d
  WHERE d.organization_id = org AND NOT EXISTS (SELECT 1 FROM public.team_channels c WHERE c.kind = 'setor' AND c.department_id = d.id);
END $$;

-- Conversa direta com outra pessoa ativa da mesma empresa.
CREATE OR REPLACE FUNCTION public.open_direct_chat(org uuid, other uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE me uuid := auth.uid(); k text; ch uuid;
BEGIN
  IF NOT private.is_member(org) OR other = me OR NOT EXISTS (
       SELECT 1 FROM public.organization_members m WHERE m.organization_id = org AND m.user_id = other AND m.status = 'active') THEN
    RAISE EXCEPTION 'pessoa inválida' USING ERRCODE = '42501';
  END IF;
  k := least(me::text, other::text) || ':' || greatest(me::text, other::text);
  SELECT id INTO ch FROM public.team_channels WHERE organization_id = org AND dm_key = k;
  IF ch IS NULL THEN
    INSERT INTO public.team_channels (organization_id, kind, name, dm_key) VALUES (org, 'direto', 'Direto', k) RETURNING id INTO ch;
    INSERT INTO public.team_channel_members (organization_id, channel_id, user_id) VALUES (org, ch, me), (org, ch, other);
  END IF;
  RETURN ch;
END $$;

-- Não lidas por canal (só canais visíveis; mensagens de outras pessoas).
CREATE OR REPLACE FUNCTION public.team_unread(org uuid)
RETURNS TABLE (channel_id uuid, unread bigint) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT m.channel_id, count(*) FROM public.team_messages m
  LEFT JOIN public.team_reads r ON r.channel_id = m.channel_id AND r.user_id = (SELECT auth.uid())
  WHERE m.organization_id = org AND m.author_id <> (SELECT auth.uid()) AND m.id > coalesce(r.last_read_id, 0)
    AND m.created_at > now() - interval '60 days'
  GROUP BY m.channel_id
$$;
REVOKE ALL ON FUNCTION public.ensure_team_channels(uuid), public.open_direct_chat(uuid, uuid), public.team_unread(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_team_channels(uuid), public.open_direct_chat(uuid, uuid), public.team_unread(uuid) TO authenticated;

-- @menção → sino (só para quem vê o canal).
CREATE OR REPLACE FUNCTION private.notify_team_mention()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF cardinality(NEW.mentions) = 0 THEN RETURN NULL; END IF;
  INSERT INTO public.notifications (organization_id, user_id, kind, ref)
  SELECT NEW.organization_id, u, 'team_mention', jsonb_build_object('channel_id', NEW.channel_id, 'by', NEW.author_id, 'text', left(coalesce(NEW.content, ''), 120))
  FROM unnest(NEW.mentions) u
  WHERE u <> NEW.author_id AND EXISTS (
    SELECT 1 FROM public.team_channels c JOIN public.organization_members m ON m.organization_id = c.organization_id AND m.user_id = u AND m.status = 'active'
    WHERE c.id = NEW.channel_id AND (c.kind = 'geral'
      OR (c.kind = 'setor' AND (m.role IN ('owner', 'admin') OR EXISTS (SELECT 1 FROM public.department_members dm WHERE dm.department_id = c.department_id AND dm.user_id = u)))
      OR (c.kind = 'direto' AND EXISTS (SELECT 1 FROM public.team_channel_members tm WHERE tm.channel_id = c.id AND tm.user_id = u))));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.notify_team_mention() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS notify_team_mention ON public.team_messages;
CREATE TRIGGER notify_team_mention AFTER INSERT ON public.team_messages FOR EACH ROW EXECUTE FUNCTION private.notify_team_mention();

-- Anexos: bucket privado; caminho {org}/{canal}/{arquivo}.
INSERT INTO storage.buckets (id, name, public, file_size_limit) VALUES ('team', 'team', false, 15728640)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 15728640;
CREATE OR REPLACE FUNCTION private.team_path_channel(path text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE parts text[] := string_to_array(path, '/'); ch uuid;
BEGIN
  IF array_length(parts, 1) <> 3 OR parts[1] !~ '^[0-9a-f-]{36}$' OR parts[2] !~ '^[0-9a-f-]{36}$'
     OR parts[3] !~ '^[A-Za-z0-9._() -]{1,160}$' THEN RETURN NULL; END IF;
  SELECT id INTO ch FROM public.team_channels WHERE id = parts[2]::uuid AND organization_id = parts[1]::uuid;
  RETURN ch;
END $$;
REVOKE ALL ON FUNCTION private.team_path_channel(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.team_path_channel(text) TO authenticated;
DROP POLICY IF EXISTS "team: ler" ON storage.objects;
DROP POLICY IF EXISTS "team: enviar" ON storage.objects;
CREATE POLICY "team: ler" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'team' AND private.can_see_channel(private.team_path_channel(name)));
CREATE POLICY "team: enviar" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'team' AND private.can_see_channel(private.team_path_channel(name)));

-- Tempo real (a RLS continua valendo para quem recebe).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'team_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.team_messages;
  END IF;
END $$;
