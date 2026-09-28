-- =============================================================================
-- Segurança do atendimento (pedido em 28/09)
--  * Histórico não se apaga: ninguém pelo navegador apaga ou edita conversa,
--    mensagem, atendimento, evento ou nota. Mensagem apagada pelo cliente (ou no
--    celular) continua guardada e marcada (deleted_at / deleted_by).
--    Remover um número ou caixa de e-mail NÃO apaga mais as conversas (ficam
--    sem canal, com todo o histórico). Remoção de dados só pelo fluxo formal
--    de LGPD (backend), nunca pelo navegador.
--  * Exportação de contatos só com a permissão contacts.export (dono/admin).
--    Tentativa sem permissão → auditoria + alerta (sino e e-mail) para
--    dono/admin, no máximo um alerta por pessoa a cada 10 min.
--  * Busca no texto das mensagens (respeita a visibilidade de cada papel).
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Permissão contacts.export (só dono e admin)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.role_permissions(r public.org_role)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE r
    WHEN 'owner' THEN ARRAY['org.billing', 'org.settings', 'members.manage',
      'departments.manage', 'pipeline.manage', 'conversations.view_all',
      'conversations.view_department', 'conversations.reassign', 'reports.view',
      'library.manage', 'contacts.groups_manage', 'conversations.attend', 'contacts.export']
    WHEN 'admin' THEN ARRAY['org.settings', 'members.manage', 'departments.manage',
      'pipeline.manage', 'conversations.view_all', 'conversations.view_department',
      'conversations.reassign', 'reports.view', 'library.manage',
      'contacts.groups_manage', 'conversations.attend', 'contacts.export']
    WHEN 'supervisor' THEN ARRAY['conversations.view_department',
      'conversations.reassign', 'reports.view', 'library.manage',
      'contacts.groups_manage', 'conversations.attend']
    WHEN 'agent' THEN ARRAY['conversations.attend']
    ELSE ARRAY[]::text[]
  END
$$;

-- -----------------------------------------------------------------------------
-- 2. Histórico imutável pelo navegador
-- -----------------------------------------------------------------------------
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_deleted_by_check') THEN
    ALTER TABLE public.messages ADD CONSTRAINT messages_deleted_by_check
      CHECK (deleted_by IS NULL OR deleted_by IN ('contact', 'phone'));
  END IF;
END $$;

DROP POLICY IF EXISTS "org: apagar" ON public.conversations;
DROP POLICY IF EXISTS "org: alterar" ON public.messages;
REVOKE DELETE ON public.conversations, public.messages, public.tickets, public.ticket_events,
  public.internal_notes FROM authenticated;
REVOKE UPDATE ON public.messages FROM authenticated;

-- Segunda barreira: mesmo que alguém devolva a permissão por engano, o
-- navegador (papéis authenticated/anon) não apaga histórico.
CREATE OR REPLACE FUNCTION private.block_history_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'O histórico de atendimento não pode ser apagado' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION private.block_history_delete() FROM PUBLIC, anon, authenticated;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['conversations', 'messages', 'tickets', 'ticket_events', 'internal_notes'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS block_history_delete ON public.%I', t);
    EXECUTE format('CREATE TRIGGER block_history_delete BEFORE DELETE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION private.block_history_delete()', t);
  END LOOP;
END $$;

-- Remover número/caixa não leva as conversas: o canal fica vazio (SET NULL só
-- na coluna do canal; organization_id continua).
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_channel_check;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_channel_check CHECK (
  (channel = 'whatsapp' AND contact_phone IS NOT NULL AND email_account_id IS NULL)
  OR (channel = 'email' AND contact_email IS NOT NULL AND instance_id IS NULL));
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_instance_id_fkey;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_instance_id_fkey
  FOREIGN KEY (instance_id) REFERENCES public.whatsapp_instances(id) ON DELETE SET NULL;
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_email_account_fk;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_email_account_fk
  FOREIGN KEY (email_account_id, organization_id) REFERENCES public.email_accounts (id, organization_id)
  ON DELETE SET NULL (email_account_id);

-- Excluir um usuário (ex.: dono original) também não leva o histórico junto.
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_user_id_fkey;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_user_id_fkey;
ALTER TABLE public.messages ADD CONSTRAINT messages_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- inherit_org: conversa que perdeu o canal mantém a organização que já tinha.
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

-- Marca mensagem apagada do lado do cliente (ou no celular). Só marca; nunca apaga.
CREATE OR REPLACE FUNCTION public.service_mark_message_deleted(org uuid, pmid text, who text)
RETURNS integer LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  WITH u AS (
    UPDATE public.messages SET deleted_at = now(), deleted_by = who
    WHERE organization_id = org AND provider_message_id = pmid AND deleted_at IS NULL
      AND who IN ('contact', 'phone')
    RETURNING 1)
  SELECT count(*)::integer FROM u
$$;
REVOKE ALL ON FUNCTION public.service_mark_message_deleted(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_mark_message_deleted(uuid, text, text) TO service_role;

-- -----------------------------------------------------------------------------
-- 3. Alerta de segurança (sino + e-mail para dono/admin)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.security_alert(org uuid, what text, extra jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE me uuid := auth.uid(); who text;
BEGIN
  INSERT INTO public.audit_log (organization_id, actor_id, action, target, meta)
  VALUES (org, me, 'security.' || what, NULL, coalesce(extra, '{}'::jsonb));
  -- Um alerta por pessoa a cada 10 min (a auditoria registra todas as tentativas).
  IF (SELECT count(*) FROM public.audit_log
      WHERE organization_id = org AND actor_id = me AND action = 'security.' || what
        AND created_at > now() - interval '10 minutes') > 1 THEN
    RETURN;
  END IF;
  SELECT coalesce(nullif(m.display_name, ''), p.full_name, p.email) INTO who
  FROM public.organization_members m LEFT JOIN public.profiles p ON p.user_id = m.user_id
  WHERE m.organization_id = org AND m.user_id = me;
  INSERT INTO public.notifications (organization_id, user_id, kind, ref)
  SELECT org, m.user_id, 'security_alert',
         jsonb_build_object('what', what, 'by', me, 'name', coalesce(who, 'Alguém da equipe'))
  FROM public.organization_members m
  WHERE m.organization_id = org AND m.status = 'active' AND m.role IN ('owner', 'admin');
END $$;
REVOKE ALL ON FUNCTION private.security_alert(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.email_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text;
BEGIN
  IF NEW.kind NOT IN ('number_health', 'email_health', 'security_alert') THEN RETURN NULL; END IF;
  SELECT value INTO base FROM public.app_settings WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'platform:cron_secret';
  IF coalesce(base, '') = '' OR secret IS NULL THEN RETURN NULL; END IF;
  PERFORM net.http_post(
    url := base || '/notify-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := jsonb_build_object('notification_id', NEW.id));
  RETURN NULL;
END $$;

-- -----------------------------------------------------------------------------
-- 4. Exportação de contatos (com permissão; tentativa sem permissão = alerta)
--    Não levanta erro quando nega: o registro e o alerta precisam ficar gravados.
--    Campos personalizados ficam de fora (podem ter dado sensível).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.export_contacts(org uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE rows jsonb; n integer;
BEGIN
  IF NOT private.is_member(org) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem acesso');
  END IF;
  IF NOT private.has_permission(org, 'contacts.export') THEN
    PERFORM private.security_alert(org, 'export_denied', jsonb_build_object('what', 'contacts'));
    RETURN jsonb_build_object('ok', false, 'error',
      'Você não tem permissão para exportar contatos. O dono e os administradores foram avisados.');
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'nome', c.name, 'telefone', c.phone, 'email', c.email, 'documento', c.document,
           'criado_em', c.created_at) ORDER BY c.created_at), '[]'::jsonb), count(*)
    INTO rows, n
  FROM public.contacts c WHERE c.organization_id = org;
  INSERT INTO public.audit_log (organization_id, actor_id, action, target, meta)
  VALUES (org, auth.uid(), 'contacts.export', NULL, jsonb_build_object('count', n));
  RETURN jsonb_build_object('ok', true, 'rows', rows, 'count', n);
END $$;
REVOKE ALL ON FUNCTION public.export_contacts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_contacts(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. Busca no texto das mensagens — SECURITY INVOKER: a RLS de messages (que
--    herda a visibilidade da conversa) decide o que cada pessoa encontra.
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE INDEX IF NOT EXISTS messages_content_trgm_idx
  ON public.messages USING gin (content extensions.gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.search_messages(org uuid, q text)
RETURNS TABLE (conversation_id uuid) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT DISTINCT m.conversation_id
  FROM public.messages m
  WHERE m.organization_id = org
    AND length(btrim(q)) >= 3
    AND m.content ILIKE '%' || replace(replace(replace(btrim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  LIMIT 100
$$;
REVOKE ALL ON FUNCTION public.search_messages(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_messages(uuid, text) TO authenticated;
