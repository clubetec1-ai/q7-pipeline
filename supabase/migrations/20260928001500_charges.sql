-- =============================================================================
-- Cobrança pelo WhatsApp (Asaas)
--  * charges: cobranças por organização, ligadas a contato/conversa. Só o
--    backend grava (Edge Functions payments / payments-webhook / payments-cron).
--  * Chave do Asaas e token do webhook no Vault (org:<org>:asaas_api_key,
--    org:<org>:asaas_webhook_token) — service_put_secret passa a aceitar esses nomes.
--  * Lembretes diários (vence amanhã / venceu ontem) via cron.
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id uuid,
  conversation_id uuid,
  provider text NOT NULL DEFAULT 'asaas' CHECK (provider IN ('asaas')),
  provider_id text NOT NULL,
  value numeric(12, 2) NOT NULL CHECK (value > 0),
  due_date date NOT NULL,
  description text CHECK (description IS NULL OR char_length(description) <= 300),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue', 'canceled', 'refunded')),
  invoice_url text,
  pix_code text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  reminded_before boolean NOT NULL DEFAULT false,
  reminded_after boolean NOT NULL DEFAULT false,
  UNIQUE (provider, provider_id),
  FOREIGN KEY (contact_id, organization_id) REFERENCES public.contacts (id, organization_id) ON DELETE SET NULL (contact_id),
  FOREIGN KEY (conversation_id) REFERENCES public.conversations (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS charges_org_idx ON public.charges (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS charges_contact_idx ON public.charges (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS charges_due_idx ON public.charges (due_date) WHERE status IN ('pending', 'overdue');

ALTER TABLE public.charges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.charges FROM anon, authenticated;
GRANT SELECT ON public.charges TO authenticated;
DROP POLICY IF EXISTS "org: ver" ON public.charges;
-- Gestores veem todas; quem atende vê as dos contatos que enxerga.
CREATE POLICY "org: ver" ON public.charges FOR SELECT TO authenticated
  USING (private.has_permission(organization_id, 'org.settings') OR private.has_permission(organization_id, 'reports.view')
         OR (private.has_permission(organization_id, 'conversations.attend') AND contact_id IS NOT NULL
             AND private.can_see_contact(organization_id, contact_id)));

-- Segredos que as Edge Functions podem gravar (+ Asaas).
CREATE OR REPLACE FUNCTION public.service_put_secret(secret_name text, secret_value text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF secret_name !~ '^instance:[0-9a-f-]{36}:(token|webhook|app_secret)$'
     AND secret_name !~ '^org:[0-9a-f-]{36}:(groq_api_key|uazapi_admin_token|meta_app_secret|asaas_api_key|asaas_webhook_token)$' THEN
    RAISE EXCEPTION 'nome de segredo não permitido' USING ERRCODE = '22023';
  END IF;
  IF coalesce(length(secret_value), 0) = 0 THEN
    RAISE EXCEPTION 'valor do segredo vazio' USING ERRCODE = '22023';
  END IF;
  PERFORM private.put_secret(secret_name, secret_value);
END $$;
REVOKE ALL ON FUNCTION public.service_put_secret(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_put_secret(text, text) TO service_role;

-- Lembretes: todo dia às 12:00 UTC (9h de Brasília), só se houver cobrança em aberto.
CREATE OR REPLACE FUNCTION private.payments_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.charges WHERE status IN ('pending', 'overdue')) THEN RETURN; END IF;
  SELECT value INTO base FROM public.app_settings WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'platform:cron_secret';
  IF coalesce(base, '') = '' OR secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := base || '/payments-cron',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
END $$;
REVOKE ALL ON FUNCTION private.payments_tick() FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'payments-reminders') THEN PERFORM cron.unschedule('payments-reminders'); END IF;
  PERFORM cron.schedule('payments-reminders', '0 12 * * *', 'SELECT private.payments_tick()');
END $$;
