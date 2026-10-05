-- =============================================================================
-- Chat da equipe (Fase 3, item 19a): reações, grupos (canais extras) e busca.
--  * Reações: 6 emojis fixos; uma por pessoa e emoji; só em canal que a pessoa vê.
--  * Grupos: canal com membros escolhidos (só eles veem); quem criou ou a gestão
--    muda nome e membros; membros só da mesma empresa e ativos.
--  * Busca: no navegador, pela própria RLS de team_messages (só canais visíveis).
-- Idempotente.
-- =============================================================================
ALTER TABLE public.team_channels DROP CONSTRAINT IF EXISTS team_channels_kind_check;
ALTER TABLE public.team_channels ADD CONSTRAINT team_channels_kind_check CHECK (kind IN ('geral', 'setor', 'direto', 'grupo'));
ALTER TABLE public.team_channels ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS team_messages_org_idx ON public.team_messages (organization_id, id DESC);

CREATE OR REPLACE FUNCTION private.can_see_channel(ch uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_channels c
    WHERE c.id = ch AND private.is_member(c.organization_id) AND (
      c.kind = 'geral'
      OR (c.kind = 'setor' AND (private.in_department(c.department_id)
          OR private.has_permission(c.organization_id, 'org.settings')
          OR private.has_permission(c.organization_id, 'conversations.view_all')))
      OR (c.kind IN ('direto', 'grupo') AND EXISTS (SELECT 1 FROM public.team_channel_members m WHERE m.channel_id = c.id AND m.user_id = (SELECT auth.uid())))))
$$;

-- Grupo: criar (ch NULL) ou mudar nome/membros. Quem cria sempre fica no grupo.
CREATE OR REPLACE FUNCTION public.save_team_group(org uuid, ch uuid, p_name text, p_members uuid[])
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE me uuid := (SELECT auth.uid()); nm text := btrim(coalesce(p_name, '')); c public.team_channels; keep uuid[];
BEGIN
  IF NOT private.is_member(org) THEN RAISE EXCEPTION 'sem acesso' USING ERRCODE = '42501'; END IF;
  IF char_length(nm) NOT BETWEEN 2 AND 60 THEN RAISE EXCEPTION 'nome do grupo: de 2 a 60 letras' USING ERRCODE = '22023'; END IF;
  -- Só pessoas ativas desta empresa (o resto é ignorado), no máximo 50.
  keep := ARRAY(SELECT DISTINCT m.user_id FROM public.organization_members m
                WHERE m.organization_id = org AND m.status = 'active' AND m.user_id = ANY (coalesce(p_members, '{}') || me));
  IF cardinality(keep) > 50 THEN RAISE EXCEPTION 'até 50 pessoas por grupo' USING ERRCODE = '22023'; END IF;
  IF cardinality(keep) < 2 THEN RAISE EXCEPTION 'escolha ao menos uma pessoa' USING ERRCODE = '22023'; END IF;
  IF ch IS NULL THEN
    INSERT INTO public.team_channels (organization_id, kind, name, created_by) VALUES (org, 'grupo', nm, me) RETURNING * INTO c;
  ELSE
    SELECT * INTO c FROM public.team_channels WHERE id = ch AND organization_id = org AND kind = 'grupo';
    IF c.id IS NULL OR NOT (c.created_by = me OR private.has_permission(org, 'org.settings')) THEN
      RAISE EXCEPTION 'só quem criou o grupo ou a gestão muda o grupo' USING ERRCODE = '42501';
    END IF;
    UPDATE public.team_channels SET name = nm WHERE id = c.id;
    IF c.created_by IS NOT NULL AND NOT c.created_by = ANY (keep) AND EXISTS (
         SELECT 1 FROM public.organization_members WHERE organization_id = org AND user_id = c.created_by AND status = 'active') THEN
      keep := keep || c.created_by;
    END IF;
    DELETE FROM public.team_channel_members WHERE channel_id = c.id AND NOT user_id = ANY (keep);
  END IF;
  INSERT INTO public.team_channel_members (organization_id, channel_id, user_id)
  SELECT org, c.id, u FROM unnest(keep) u ON CONFLICT DO NOTHING;
  RETURN c.id;
END $$;
REVOKE ALL ON FUNCTION public.save_team_group(uuid, uuid, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_team_group(uuid, uuid, text, uuid[]) TO authenticated;

-- Sair de um grupo (o histórico fica para quem continua).
CREATE OR REPLACE FUNCTION public.leave_team_group(ch uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DELETE FROM public.team_channel_members m USING public.team_channels c
  WHERE m.channel_id = ch AND m.user_id = (SELECT auth.uid()) AND c.id = m.channel_id AND c.kind = 'grupo';
END $$;
REVOKE ALL ON FUNCTION public.leave_team_group(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_team_group(uuid) TO authenticated;

-- ------------------------------------------------------------------ reações
CREATE TABLE IF NOT EXISTS public.team_reactions (
  message_id bigint NOT NULL REFERENCES public.team_messages(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (emoji IN ('👍', '❤️', '😂', '🎉', '✅', '👀')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji),
  FOREIGN KEY (channel_id, organization_id) REFERENCES public.team_channels (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS team_reactions_channel_idx ON public.team_reactions (channel_id);
ALTER TABLE public.team_reactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_reactions FROM anon, authenticated;
GRANT SELECT ON public.team_reactions TO authenticated;
GRANT ALL ON public.team_reactions TO service_role;
DROP POLICY IF EXISTS "chat: ver reacoes" ON public.team_reactions;
CREATE POLICY "chat: ver reacoes" ON public.team_reactions FOR SELECT TO authenticated USING (private.can_see_channel(channel_id));

-- Liga/desliga a própria reação. Devolve true quando ficou ligada.
CREATE OR REPLACE FUNCTION public.team_react(msg bigint, p_emoji text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.team_messages; me uuid := (SELECT auth.uid());
BEGIN
  SELECT * INTO m FROM public.team_messages WHERE id = msg;
  IF m.id IS NULL OR NOT private.can_see_channel(m.channel_id) THEN RAISE EXCEPTION 'mensagem não encontrada' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.team_reactions WHERE message_id = msg AND user_id = me AND emoji = p_emoji;
  IF FOUND THEN RETURN false; END IF;
  INSERT INTO public.team_reactions (message_id, organization_id, channel_id, user_id, emoji)
  VALUES (msg, m.organization_id, m.channel_id, me, p_emoji);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.team_react(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_react(bigint, text) TO authenticated;

-- Só INSERT vai pelo tempo real (passa pela RLS); exclusão não é transmitida.
ALTER TABLE public.team_reactions REPLICA IDENTITY DEFAULT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'team_reactions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.team_reactions;
  END IF;
END $$;
