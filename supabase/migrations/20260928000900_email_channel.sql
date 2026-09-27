-- =============================================================================
-- Canal de e-mail (IMAP/SMTP) — spec docs/superpowers/specs/2026-09-28-canal-email-design.md
--  * email_accounts: caixas da organização; senha só no Vault (email:<id>:password).
--  * conversations multicanal: channel 'whatsapp' | 'email'; uma conversa por
--    contato por caixa. contacts.phone passa a ser opcional (contato só de e-mail).
--  * Atendimento de e-mail nasce na fila do departamento padrão da caixa (sem IA).
--  * sync-email: cron a cada minuto (só chama se houver caixa ativa).
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.email_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  address text NOT NULL CHECK (address ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  username text NOT NULL,
  imap_host text NOT NULL,
  imap_port integer NOT NULL DEFAULT 993,
  smtp_host text NOT NULL,
  smtp_port integer NOT NULL DEFAULT 465,
  department_id uuid,
  signature text CHECK (signature IS NULL OR char_length(signature) <= 2000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  health_status text,
  health_error text,
  last_uid bigint,
  uidvalidity bigint,
  last_sync_at timestamptz,
  has_password boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, address),
  -- Hosts só por nome/IP simples; portas de e-mail conhecidas.
  CHECK (imap_host ~ '^[A-Za-z0-9.-]{3,253}$' AND smtp_host ~ '^[A-Za-z0-9.-]{3,253}$'),
  CHECK (imap_port IN (993, 143) AND smtp_port IN (465, 587)),
  FOREIGN KEY (department_id, organization_id) REFERENCES public.departments (id, organization_id) ON DELETE SET NULL (department_id)
);
ALTER TABLE public.email_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_accounts FROM anon;
GRANT SELECT, INSERT, DELETE ON public.email_accounts TO authenticated;
GRANT UPDATE (name, address, username, imap_host, imap_port, smtp_host, smtp_port, department_id, signature, status)
  ON public.email_accounts TO authenticated;
DROP POLICY IF EXISTS "org: ver" ON public.email_accounts;
DROP POLICY IF EXISTS "org: gerenciar" ON public.email_accounts;
CREATE POLICY "org: ver" ON public.email_accounts FOR SELECT TO authenticated
  USING (private.is_member(organization_id));
CREATE POLICY "org: gerenciar" ON public.email_accounts FOR ALL TO authenticated
  USING (private.has_permission(organization_id, 'org.settings'))
  WITH CHECK (private.has_permission(organization_id, 'org.settings'));

-- Senha da caixa: só grava (Vault); nunca volta.
CREATE OR REPLACE FUNCTION public.set_email_password(account uuid, secret_value text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE o uuid;
BEGIN
  SELECT organization_id INTO o FROM public.email_accounts WHERE id = account;
  IF o IS NULL OR NOT private.has_permission(o, 'org.settings') THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  IF coalesce(length(secret_value), 0) = 0 OR length(secret_value) > 500 THEN
    RAISE EXCEPTION 'senha vazia ou grande demais' USING ERRCODE = '22023';
  END IF;
  PERFORM private.put_secret(format('email:%s:password', account), secret_value);
  UPDATE public.email_accounts SET has_password = true, health_status = NULL, health_error = NULL WHERE id = account;
  PERFORM private.audit(o, 'secret.set', 'email:' || account, '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.set_email_password(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_email_password(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION private.drop_email_secret()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DELETE FROM vault.secrets WHERE name = format('email:%s:password', OLD.id);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.drop_email_secret() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS drop_email_secret ON public.email_accounts;
CREATE TRIGGER drop_email_secret AFTER DELETE ON public.email_accounts
  FOR EACH ROW EXECUTE FUNCTION private.drop_email_secret();

-- Conversas multicanal.
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp';
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS email_account_id uuid;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS contact_email text;
ALTER TABLE public.conversations ALTER COLUMN instance_id DROP NOT NULL;
ALTER TABLE public.conversations ALTER COLUMN contact_phone DROP NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_email_account_fk') THEN
    ALTER TABLE public.conversations ADD CONSTRAINT conversations_email_account_fk
      FOREIGN KEY (email_account_id, organization_id) REFERENCES public.email_accounts (id, organization_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_channel_check') THEN
    ALTER TABLE public.conversations ADD CONSTRAINT conversations_channel_check CHECK (
      (channel = 'whatsapp' AND instance_id IS NOT NULL AND contact_phone IS NOT NULL AND email_account_id IS NULL)
      OR (channel = 'email' AND email_account_id IS NOT NULL AND contact_email IS NOT NULL AND instance_id IS NULL));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS conversations_email_contact_key
  ON public.conversations (email_account_id, lower(contact_email)) WHERE channel = 'email';

-- Organização da conversa: do número (WhatsApp) ou da caixa (e-mail).
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
    ELSE
      SELECT organization_id INTO parent_org FROM public.email_accounts WHERE id = NEW.email_account_id;
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
DROP TRIGGER IF EXISTS inherit_org ON public.conversations;
CREATE TRIGGER inherit_org BEFORE INSERT OR UPDATE OF organization_id, instance_id, email_account_id ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION private.inherit_org();

-- Contato: por telefone (WhatsApp) ou por e-mail.
ALTER TABLE public.contacts ALTER COLUMN phone DROP NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_email_idx ON public.contacts (organization_id, lower(email));

CREATE OR REPLACE FUNCTION private.link_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE cid uuid;
BEGIN
  IF NEW.contact_id IS NOT NULL OR NEW.organization_id IS NULL THEN RETURN NEW; END IF;
  IF coalesce(NEW.contact_phone, '') <> '' THEN
    INSERT INTO public.contacts (organization_id, phone, name)
    VALUES (NEW.organization_id, NEW.contact_phone, NEW.contact_name)
    ON CONFLICT (organization_id, phone) DO UPDATE SET name = coalesce(public.contacts.name, EXCLUDED.name)
    RETURNING id INTO cid;
  ELSIF coalesce(NEW.contact_email, '') <> '' THEN
    SELECT id INTO cid FROM public.contacts
    WHERE organization_id = NEW.organization_id AND lower(email) = lower(NEW.contact_email)
    ORDER BY created_at LIMIT 1;
    IF cid IS NULL THEN
      INSERT INTO public.contacts (organization_id, email, name)
      VALUES (NEW.organization_id, lower(NEW.contact_email), NEW.contact_name) RETURNING id INTO cid;
    END IF;
  END IF;
  NEW.contact_id := cid;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS zz_link_contact ON public.conversations;
CREATE TRIGGER zz_link_contact BEFORE INSERT OR UPDATE OF contact_phone, contact_email ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION private.link_contact();

-- Mensagens de e-mail.
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS email_subject text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS email_message_id text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS email_in_reply_to text;
CREATE UNIQUE INDEX IF NOT EXISTS messages_email_message_key
  ON public.messages (conversation_id, email_message_id) WHERE email_message_id IS NOT NULL;

-- Atendimento: e-mail nasce na fila do departamento padrão da caixa (sem IA).
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
      ai_on := false;
      SELECT department_id INTO dept FROM public.email_accounts WHERE id = c.email_account_id;
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

-- Saúde da caixa: piorou → aviso para owner/admin (sino + e-mail).
CREATE OR REPLACE FUNCTION private.notify_email_health()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'disabled' THEN RETURN NULL; END IF;
  IF private.health_rank(NEW.health_status) > private.health_rank(OLD.health_status) THEN
    INSERT INTO public.notifications (organization_id, user_id, kind, ref)
    SELECT NEW.organization_id, m.user_id, 'email_health',
           jsonb_strip_nulls(jsonb_build_object('account_id', NEW.id, 'name', NEW.name,
             'health', NEW.health_status, 'error', left(NEW.health_error, 200)))
    FROM public.organization_members m
    WHERE m.organization_id = NEW.organization_id AND m.status = 'active' AND m.role IN ('owner', 'admin');
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.notify_email_health() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS notify_email_health ON public.email_accounts;
CREATE TRIGGER notify_email_health AFTER UPDATE OF health_status ON public.email_accounts
  FOR EACH ROW EXECUTE FUNCTION private.notify_email_health();

CREATE OR REPLACE FUNCTION private.email_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text;
BEGIN
  IF NEW.kind NOT IN ('number_health', 'email_health') THEN RETURN NULL; END IF;
  SELECT value INTO base FROM public.app_settings WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'platform:cron_secret';
  IF coalesce(base, '') = '' OR secret IS NULL THEN RETURN NULL; END IF;
  PERFORM net.http_post(
    url := base || '/notify-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := jsonb_build_object('notification_id', NEW.id));
  RETURN NULL;
END $$;

-- Cron: sync-email a cada minuto, só se houver caixa ativa com senha.
CREATE OR REPLACE FUNCTION private.sync_email_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.email_accounts WHERE status = 'active' AND has_password) THEN RETURN; END IF;
  SELECT value INTO base FROM public.app_settings WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'platform:cron_secret';
  IF coalesce(base, '') = '' OR secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := base || '/sync-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
END $$;
REVOKE ALL ON FUNCTION private.sync_email_tick() FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-email') THEN PERFORM cron.unschedule('sync-email'); END IF;
  PERFORM cron.schedule('sync-email', '* * * * *', 'SELECT private.sync_email_tick()');
END $$;
