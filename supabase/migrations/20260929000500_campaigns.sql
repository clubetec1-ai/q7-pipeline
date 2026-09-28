-- =============================================================================
-- Disparos (campanhas) — roadmap "Disparos"
--  * Envio em massa para grupos de clientes, escolhendo o número.
--  * Respeita opt-out (contato que pediu SAIR fica de fora), janela de horário
--    (08h–20h de Brasília por padrão) e limite por minuto (padrão 20, máx. 60).
--  * Número da Meta: exige modelo aprovado (nome + idioma); número QR: texto livre
--    com {nome} (risco de bloqueio avisado na tela).
--  * Permissão própria campaigns.manage (dono/admin). Destinatários só por RPC
--    (a lista vem dos grupos da própria organização, nunca do navegador).
--  * O envio é feito por send-campaigns (cron a cada minuto, x-cron-secret).
-- Idempotente.
-- =============================================================================

CREATE OR REPLACE FUNCTION private.role_permissions(r public.org_role)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE r
    WHEN 'owner' THEN ARRAY['org.billing', 'org.settings', 'members.manage',
      'departments.manage', 'pipeline.manage', 'conversations.view_all',
      'conversations.view_department', 'conversations.reassign', 'reports.view',
      'library.manage', 'contacts.groups_manage', 'conversations.attend', 'contacts.export', 'campaigns.manage']
    WHEN 'admin' THEN ARRAY['org.settings', 'members.manage', 'departments.manage',
      'pipeline.manage', 'conversations.view_all', 'conversations.view_department',
      'conversations.reassign', 'reports.view', 'library.manage',
      'contacts.groups_manage', 'conversations.attend', 'contacts.export', 'campaigns.manage']
    WHEN 'supervisor' THEN ARRAY['conversations.view_department',
      'conversations.reassign', 'reports.view', 'library.manage',
      'contacts.groups_manage', 'conversations.attend']
    WHEN 'agent' THEN ARRAY['conversations.attend']
    ELSE ARRAY[]::text[]
  END
$$;

CREATE TABLE IF NOT EXISTS public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  instance_id uuid,
  group_ids uuid[] NOT NULL DEFAULT '{}',
  message text CHECK (message IS NULL OR char_length(message) <= 4000),
  template_name text CHECK (template_name IS NULL OR template_name ~ '^[a-z0-9_]{1,512}$'),
  template_lang text CHECK (template_lang IS NULL OR template_lang ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'paused', 'done', 'canceled')),
  scheduled_at timestamptz,
  rate_per_min integer NOT NULL DEFAULT 20 CHECK (rate_per_min BETWEEN 1 AND 60),
  window_start smallint NOT NULL DEFAULT 8 CHECK (window_start BETWEEN 0 AND 23),
  window_end smallint NOT NULL DEFAULT 20 CHECK (window_end BETWEEN 1 AND 24),
  total integer NOT NULL DEFAULT 0, sent integer NOT NULL DEFAULT 0, failed integer NOT NULL DEFAULT 0, skipped integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (id, organization_id),
  CONSTRAINT campaigns_instance_fk FOREIGN KEY (instance_id) REFERENCES public.whatsapp_instances(id) ON DELETE SET NULL,
  CHECK (cardinality(group_ids) <= 20)
);
CREATE INDEX IF NOT EXISTS campaigns_org_idx ON public.campaigns (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.campaign_recipients (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  phone text NOT NULL,
  name text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  error text,
  sent_at timestamptz,
  UNIQUE (campaign_id, contact_id),
  FOREIGN KEY (campaign_id, organization_id) REFERENCES public.campaigns (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id, organization_id) REFERENCES public.contacts (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS campaign_recipients_pending_idx ON public.campaign_recipients (campaign_id, id) WHERE status = 'pending';

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_recipients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaigns, public.campaign_recipients FROM anon, authenticated;
GRANT SELECT ON public.campaigns, public.campaign_recipients TO authenticated;
GRANT INSERT (id, organization_id, name, instance_id, group_ids, message, template_name, template_lang, scheduled_at,
              rate_per_min, window_start, window_end, created_by) ON public.campaigns TO authenticated;
GRANT UPDATE (name, instance_id, group_ids, message, template_name, template_lang, scheduled_at,
              rate_per_min, window_start, window_end) ON public.campaigns TO authenticated;
GRANT DELETE ON public.campaigns TO authenticated;
DROP POLICY IF EXISTS "org: gerenciar" ON public.campaigns;
DROP POLICY IF EXISTS "org: ver" ON public.campaigns;
DROP POLICY IF EXISTS "org: rascunho" ON public.campaigns;
CREATE POLICY "org: ver" ON public.campaigns FOR SELECT TO authenticated
  USING (private.has_permission(organization_id, 'campaigns.manage'));
-- Criar, editar e apagar só rascunho (iniciada muda só por RPC, com auditoria).
CREATE POLICY "org: rascunho" ON public.campaigns FOR ALL TO authenticated
  USING (private.has_permission(organization_id, 'campaigns.manage') AND status = 'draft')
  WITH CHECK (private.has_permission(organization_id, 'campaigns.manage') AND status = 'draft');
DROP POLICY IF EXISTS "org: ver" ON public.campaign_recipients;
CREATE POLICY "org: ver" ON public.campaign_recipients FOR SELECT TO authenticated
  USING (private.has_permission(organization_id, 'campaigns.manage'));

-- Rascunho só aponta para número e grupos da própria organização.
CREATE OR REPLACE FUNCTION private.campaign_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft' AND current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'campanha já iniciada não pode ser editada' USING ERRCODE = '42501';
  END IF;
  IF NEW.instance_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.whatsapp_instances i WHERE i.id = NEW.instance_id AND i.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'número inválido' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(NEW.group_ids) g
             WHERE NOT EXISTS (SELECT 1 FROM public.contact_groups cg WHERE cg.id = g AND cg.organization_id = NEW.organization_id)) THEN
    RAISE EXCEPTION 'grupo inválido' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.campaign_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS campaign_guard ON public.campaigns;
CREATE TRIGGER campaign_guard BEFORE INSERT OR UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION private.campaign_guard();

-- Quantos receberiam (prévia): total nos grupos, com telefone e sem opt-out.
CREATE OR REPLACE FUNCTION public.campaign_audience(org uuid, groups uuid[])
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN NOT private.has_permission(org, 'campaigns.manage') THEN NULL ELSE (
    SELECT jsonb_build_object(
      'total', count(DISTINCT c.id),
      'optout', count(DISTINCT c.id) FILTER (WHERE c.opted_out_at IS NOT NULL),
      'sem_telefone', count(DISTINCT c.id) FILTER (WHERE coalesce(c.phone, '') = ''),
      'recebem', count(DISTINCT c.id) FILTER (WHERE c.opted_out_at IS NULL AND coalesce(c.phone, '') <> '' AND c.anonymized_at IS NULL))
    FROM public.contact_group_members m
    JOIN public.contacts c ON c.id = m.contact_id AND c.organization_id = org
    WHERE m.organization_id = org AND m.group_id = ANY (groups)) END
$$;
REVOKE ALL ON FUNCTION public.campaign_audience(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.campaign_audience(uuid, uuid[]) TO authenticated;

-- Iniciar: congela a lista (grupos → contatos com telefone, sem opt-out).
CREATE OR REPLACE FUNCTION public.start_campaign(campaign uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.campaigns; inst public.whatsapp_instances; n integer;
BEGIN
  SELECT * INTO c FROM public.campaigns WHERE id = campaign FOR UPDATE;
  IF c.id IS NULL OR NOT private.has_permission(c.organization_id, 'campaigns.manage') THEN
    RAISE EXCEPTION 'campanha não encontrada' USING ERRCODE = '42501';
  END IF;
  IF c.status <> 'draft' THEN RAISE EXCEPTION 'campanha já iniciada' USING ERRCODE = '22023'; END IF;
  SELECT * INTO inst FROM public.whatsapp_instances WHERE id = c.instance_id AND organization_id = c.organization_id;
  IF inst.id IS NULL OR inst.status = 'disabled' THEN RAISE EXCEPTION 'escolha um número ativo' USING ERRCODE = '22023'; END IF;
  IF inst.provider = 'cloud' AND (c.template_name IS NULL OR c.template_lang IS NULL) THEN
    RAISE EXCEPTION 'número da Meta precisa de modelo aprovado' USING ERRCODE = '22023';
  END IF;
  IF inst.provider <> 'cloud' AND coalesce(btrim(c.message), '') = '' THEN
    RAISE EXCEPTION 'escreva a mensagem' USING ERRCODE = '22023';
  END IF;
  IF cardinality(c.group_ids) = 0 THEN RAISE EXCEPTION 'escolha ao menos um grupo' USING ERRCODE = '22023'; END IF;

  INSERT INTO public.campaign_recipients (organization_id, campaign_id, contact_id, phone, name, status, error)
  SELECT DISTINCT ON (ct.id) c.organization_id, c.id, ct.id, ct.phone, ct.name,
         CASE WHEN ct.opted_out_at IS NOT NULL OR ct.anonymized_at IS NOT NULL THEN 'skipped' ELSE 'pending' END,
         CASE WHEN ct.opted_out_at IS NOT NULL THEN 'pediu para não receber' WHEN ct.anonymized_at IS NOT NULL THEN 'anonimizado' END
  FROM public.contact_group_members m
  JOIN public.contacts ct ON ct.id = m.contact_id AND ct.organization_id = c.organization_id
  WHERE m.organization_id = c.organization_id AND m.group_id = ANY (c.group_ids) AND coalesce(ct.phone, '') <> ''
  ON CONFLICT (campaign_id, contact_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'nenhum contato com telefone nesses grupos' USING ERRCODE = '22023'; END IF;

  UPDATE public.campaigns SET status = 'running', started_at = now(),
    total = n, skipped = (SELECT count(*) FROM public.campaign_recipients r WHERE r.campaign_id = c.id AND r.status = 'skipped')
  WHERE id = c.id;
  INSERT INTO public.audit_log (organization_id, actor_id, action, target, meta)
  VALUES (c.organization_id, auth.uid(), 'campaign.start', c.id::text, jsonb_build_object('total', n));
  RETURN jsonb_build_object('ok', true, 'total', n);
END $$;

CREATE OR REPLACE FUNCTION public.set_campaign_status(campaign uuid, new_status text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.campaigns;
BEGIN
  SELECT * INTO c FROM public.campaigns WHERE id = campaign FOR UPDATE;
  IF c.id IS NULL OR NOT private.has_permission(c.organization_id, 'campaigns.manage') THEN
    RAISE EXCEPTION 'campanha não encontrada' USING ERRCODE = '42501';
  END IF;
  IF NOT ((c.status = 'running' AND new_status IN ('paused', 'canceled'))
          OR (c.status = 'paused' AND new_status IN ('running', 'canceled'))) THEN
    RAISE EXCEPTION 'mudança não permitida' USING ERRCODE = '22023';
  END IF;
  UPDATE public.campaigns SET status = new_status, finished_at = CASE WHEN new_status = 'canceled' THEN now() END WHERE id = c.id;
  INSERT INTO public.audit_log (organization_id, actor_id, action, target, meta)
  VALUES (c.organization_id, auth.uid(), 'campaign.' || new_status, c.id::text, '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.start_campaign(uuid), public.set_campaign_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_campaign(uuid), public.set_campaign_status(uuid, text) TO authenticated;

-- Cron: send-campaigns a cada minuto, só se houver campanha em andamento.
CREATE OR REPLACE FUNCTION private.send_campaigns_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.campaigns WHERE status = 'running' AND (scheduled_at IS NULL OR scheduled_at <= now())) THEN RETURN; END IF;
  SELECT value INTO base FROM public.app_settings WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'platform:cron_secret';
  IF coalesce(base, '') = '' OR secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := base || '/send-campaigns',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
END $$;
REVOKE ALL ON FUNCTION private.send_campaigns_tick() FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-campaigns') THEN PERFORM cron.unschedule('send-campaigns'); END IF;
  PERFORM cron.schedule('send-campaigns', '* * * * *', 'SELECT private.send_campaigns_tick()');
END $$;
