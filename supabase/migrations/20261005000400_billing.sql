-- =============================================================================
-- Venda autoatendida, fatia V3: cobrança da assinatura pelo Asaas da CLUBETEC.
--  * service_billing_*: só o servidor grava ids do Asaas e o resultado dos pagamentos;
--  * billing_events: cada aviso do Asaas é processado uma vez (contra repetição);
--  * billing_tick (diário): lembra o fim do teste, vence teste sem pagamento, marca
--    atraso, vence atraso de mais de 7 dias e encerra cancelada no fim do período —
--    vencida/cancelada desliga os módulos (os dados ficam); pagar religa.
--  * platform_billing_status: a Clubetec vê se o Asaas dela está conectado.
-- Idempotente.
-- =============================================================================
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS setup_payment_id text
  CHECK (setup_payment_id IS NULL OR setup_payment_id ~ '^[A-Za-z0-9_]{3,60}$');

CREATE TABLE IF NOT EXISTS public.billing_events (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 3 AND 120),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (char_length(event) <= 60),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_events FROM anon, authenticated;
GRANT ALL ON public.billing_events TO service_role;

CREATE OR REPLACE FUNCTION public.service_billing_link(org uuid, customer text, sub text, plan text, setup_id text, email text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.plans WHERE key = plan AND active) THEN RAISE EXCEPTION 'plano indisponível' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.subscriptions (organization_id, plan_key, status, asaas_customer_id, asaas_subscription_id, setup_payment_id, billing_email)
  VALUES (org, plan, 'trial', customer, sub, setup_id, email)
  ON CONFLICT (organization_id) DO UPDATE SET plan_key = plan, asaas_customer_id = coalesce(customer, public.subscriptions.asaas_customer_id),
    asaas_subscription_id = coalesce(sub, public.subscriptions.asaas_subscription_id),
    setup_payment_id = coalesce(setup_id, public.subscriptions.setup_payment_id),
    billing_email = coalesce(email, public.subscriptions.billing_email), cancel_at_period_end = false, updated_at = now();
  -- Trocar de plano no teste ou com a assinatura em dia vale na hora (módulos do novo plano).
  IF (SELECT status FROM public.subscriptions WHERE organization_id = org) IN ('trial', 'active', 'past_due') THEN
    PERFORM private.apply_plan(org, plan);
  END IF;
  PERFORM private.audit(org, 'billing.linked', plan, jsonb_build_object('subscription', sub));
END $$;
REVOKE ALL ON FUNCTION public.service_billing_link(uuid, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_billing_link(uuid, text, text, text, text, text) TO service_role;

-- Aviso do Asaas (uma vez por id). Devolve 'ok', 'repetido' ou 'ignorado'.
CREATE OR REPLACE FUNCTION public.service_billing_event(event_id text, sub text, ev text, due date)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.subscriptions;
BEGIN
  SELECT * INTO s FROM public.subscriptions WHERE asaas_subscription_id = sub;
  IF s.organization_id IS NULL THEN RETURN 'ignorado'; END IF;
  BEGIN
    INSERT INTO public.billing_events (id, organization_id, event) VALUES (event_id, s.organization_id, ev);
  EXCEPTION WHEN unique_violation THEN RETURN 'repetido';
  END;
  IF ev IN ('PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED') THEN
    UPDATE public.subscriptions SET status = 'active',
      current_period_end = greatest(coalesce(current_period_end, now()), (coalesce(due, current_date) + interval '1 month')::timestamptz),
      updated_at = now() WHERE organization_id = s.organization_id;
    PERFORM private.apply_plan(s.organization_id, s.plan_key);
    INSERT INTO public.notifications (organization_id, user_id, kind, ref)
    SELECT s.organization_id, m.user_id, 'billing_paid', '{}'::jsonb
    FROM public.organization_members m WHERE m.organization_id = s.organization_id AND m.status = 'active' AND m.role = 'owner';
  ELSIF ev = 'PAYMENT_OVERDUE' AND s.status IN ('active', 'trial') THEN
    UPDATE public.subscriptions SET status = 'past_due', updated_at = now() WHERE organization_id = s.organization_id;
    INSERT INTO public.notifications (organization_id, user_id, kind, ref)
    SELECT s.organization_id, m.user_id, 'billing_overdue', '{}'::jsonb
    FROM public.organization_members m WHERE m.organization_id = s.organization_id AND m.status = 'active' AND m.role = 'owner';
  ELSIF ev = 'SUBSCRIPTION_DELETED' THEN
    UPDATE public.subscriptions SET cancel_at_period_end = true, updated_at = now() WHERE organization_id = s.organization_id;
  END IF;
  PERFORM private.audit(s.organization_id, 'billing.event', ev, jsonb_build_object('due', due), 'system');
  RETURN 'ok';
END $$;
REVOKE ALL ON FUNCTION public.service_billing_event(text, text, text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_billing_event(text, text, text, date) TO service_role;

CREATE OR REPLACE FUNCTION public.service_billing_cancel(org uuid)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.subscriptions SET cancel_at_period_end = true, updated_at = now() WHERE organization_id = org;
$$;
REVOKE ALL ON FUNCTION public.service_billing_cancel(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_billing_cancel(uuid) TO service_role;

-- Rotina diária da assinatura (sem chamar o Asaas: usa o que os avisos gravaram).
CREATE OR REPLACE FUNCTION private.billing_tick()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.subscriptions; n integer := 0; owners uuid[];
BEGIN
  FOR s IN SELECT * FROM public.subscriptions LOOP
    BEGIN
      SELECT array_agg(user_id) INTO owners FROM public.organization_members
      WHERE organization_id = s.organization_id AND status = 'active' AND role = 'owner';
      IF s.status = 'trial' AND s.trial_ends_at IS NOT NULL THEN
        IF s.trial_ends_at < now() THEN
          UPDATE public.subscriptions SET status = 'expired', updated_at = now() WHERE organization_id = s.organization_id;
          PERFORM private.pause_plan(s.organization_id);
          INSERT INTO public.notifications (organization_id, user_id, kind, ref)
          SELECT s.organization_id, u, 'billing_expired', '{}'::jsonb FROM unnest(owners) u;
          n := n + 1;
        ELSIF s.trial_ends_at < now() + interval '3 days' AND (s.reminded_at IS NULL OR s.reminded_at < now() - interval '2 days') THEN
          INSERT INTO public.notifications (organization_id, user_id, kind, ref)
          SELECT s.organization_id, u, 'billing_trial', jsonb_build_object('ends', s.trial_ends_at) FROM unnest(owners) u;
          UPDATE public.subscriptions SET reminded_at = now() WHERE organization_id = s.organization_id;
          n := n + 1;
        END IF;
      ELSIF s.status = 'active' AND s.current_period_end IS NOT NULL THEN
        IF s.cancel_at_period_end AND s.current_period_end < now() THEN
          UPDATE public.subscriptions SET status = 'canceled', updated_at = now() WHERE organization_id = s.organization_id;
          PERFORM private.pause_plan(s.organization_id);
          n := n + 1;
        ELSIF NOT s.cancel_at_period_end AND s.current_period_end < now() - interval '3 days' THEN
          UPDATE public.subscriptions SET status = 'past_due', updated_at = now() WHERE organization_id = s.organization_id;
          INSERT INTO public.notifications (organization_id, user_id, kind, ref)
          SELECT s.organization_id, u, 'billing_overdue', '{}'::jsonb FROM unnest(owners) u;
          n := n + 1;
        END IF;
      ELSIF s.status = 'past_due' AND coalesce(s.current_period_end, s.updated_at) < now() - interval '7 days' THEN
        UPDATE public.subscriptions SET status = 'expired', updated_at = now() WHERE organization_id = s.organization_id;
        PERFORM private.pause_plan(s.organization_id);
        INSERT INTO public.notifications (organization_id, user_id, kind, ref)
        SELECT s.organization_id, u, 'billing_expired', '{}'::jsonb FROM unnest(owners) u;
        n := n + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'billing_tick: empresa % falhou: %', s.organization_id, SQLERRM;
    END;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION private.billing_tick() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'billing-daily') THEN PERFORM cron.unschedule('billing-daily'); END IF;
    PERFORM cron.schedule('billing-daily', '30 11 * * *', 'SELECT private.billing_tick()');
  END IF;
END $$;

-- Clubetec: o Asaas da plataforma está conectado? (sem mostrar a chave)
CREATE OR REPLACE FUNCTION public.platform_billing_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'só a Clubetec' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'connected', EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'platform:asaas_api_key'),
    'webhook', EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'platform:asaas_webhook_token'),
    'env', (SELECT value FROM public.app_settings WHERE key = 'platform_asaas_env'),
    'assinaturas', (SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM public.subscriptions GROUP BY status) x));
END $$;
REVOKE ALL ON FUNCTION public.platform_billing_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_billing_status() TO authenticated;
