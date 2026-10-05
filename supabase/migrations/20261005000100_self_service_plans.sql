-- =============================================================================
-- Venda autoatendida, fatia V1 (docs/design/04-venda-autoatendida.md):
--  * plans: catálogo de planos (Clubetec edita); os públicos aparecem em /planos;
--  * subscriptions: uma assinatura por empresa (teste, ativa, em atraso, cancelada, vencida);
--  * apply_plan: liga exatamente os módulos do plano e copia a franquia do cérebro;
--  * self_signup_org: a pessoa (e-mail confirmado) cria a própria empresa em teste grátis;
--  * service_ai_take: franquia MENSAL de IA da plataforma por plano (chave própria não conta);
--  * my_subscription / platform_save_plan / platform_set_subscription.
-- Escrita só por RPC (auditada) ou pelo servidor. Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.plans (
  key text PRIMARY KEY CHECK (key ~ '^[a-z0-9_]{2,30}$'),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 60),
  description text CHECK (description IS NULL OR char_length(description) <= 600),
  price_cents integer NOT NULL DEFAULT 0 CHECK (price_cents BETWEEN 0 AND 100000000),
  setup_cents integer NOT NULL DEFAULT 0 CHECK (setup_cents BETWEEN 0 AND 100000000),
  modules text[] NOT NULL DEFAULT '{}' CHECK (modules <@ ARRAY['diagnostico', 'ia', 'canais', 'telefonia', 'campanhas', 'cobrancas', 'gestao']),
  limits jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(limits) = 'object' AND octet_length(limits::text) <= 2000),
  features text[] NOT NULL DEFAULT '{}' CHECK (cardinality(features) <= 20),
  trial_days integer NOT NULL DEFAULT 14 CHECK (trial_days BETWEEN 0 AND 60),
  public boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plans FROM anon, authenticated;
GRANT SELECT ON public.plans TO anon, authenticated;
GRANT ALL ON public.plans TO service_role;
DROP POLICY IF EXISTS "planos: ver" ON public.plans;
DROP POLICY IF EXISTS "planos: visitante" ON public.plans;
CREATE POLICY "planos: visitante" ON public.plans FOR SELECT TO anon USING (public AND active);
DROP POLICY IF EXISTS "planos: logado" ON public.plans;
CREATE POLICY "planos: logado" ON public.plans FOR SELECT TO authenticated
  USING ((public AND active) OR private.is_platform_operator());

-- Planos sugeridos (docs/marketing/02); a Clubetec ajusta em Plataforma → Planos.
INSERT INTO public.plans (key, name, description, price_cents, setup_cents, modules, limits, features, trial_days, sort) VALUES
  ('essencial', 'Essencial', 'Para começar: WhatsApp e e-mail com IA respondendo e passando para a equipe.', 44700, 69000,
   ARRAY['ia', 'canais'], '{"ai_calls_mes": 3000, "numeros": 1, "membros": 3}',
   ARRAY['IA responde no WhatsApp e no e-mail', 'Funil de vendas e Kanban', 'Até 3 pessoas na equipe', '1 número de WhatsApp'], 14, 1),
  ('profissional', 'Profissional', 'O principal: diagnóstico, cérebro de gestão, campanhas e cobrança.', 119700, 179000,
   ARRAY['diagnostico', 'ia', 'canais', 'gestao', 'campanhas', 'cobrancas'],
   '{"ai_calls_mes": 12000, "numeros": 3, "membros": 10, "analises_mes": 8, "manual_dia": 1}',
   ARRAY['Tudo do Essencial', 'Diagnóstico e plano da empresa', 'Cérebro de gestão por área', 'Campanhas e cobranças', 'Até 10 pessoas e 3 números'], 14, 2),
  ('completo', 'Completo', 'Para operações maiores e redes: tudo liberado, inclusive telefonia.', 229700, 399000,
   ARRAY['diagnostico', 'ia', 'canais', 'telefonia', 'campanhas', 'cobrancas', 'gestao'],
   '{"ai_calls_mes": 30000, "numeros": 10, "membros": 30, "analises_mes": 16, "manual_dia": 2}',
   ARRAY['Tudo do Profissional', 'Telefonia (ramais)', 'Até 30 pessoas e 10 números', 'Cérebro com mais análises'], 14, 3)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.subscriptions (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_key text NOT NULL REFERENCES public.plans(key),
  status text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'past_due', 'canceled', 'expired')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  billing_email text CHECK (billing_email IS NULL OR billing_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  asaas_customer_id text CHECK (asaas_customer_id IS NULL OR asaas_customer_id ~ '^[A-Za-z0-9_]{3,60}$'),
  asaas_subscription_id text CHECK (asaas_subscription_id IS NULL OR asaas_subscription_id ~ '^[A-Za-z0-9_]{3,60}$'),
  reminded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_asaas_sub_idx ON public.subscriptions (asaas_subscription_id) WHERE asaas_subscription_id IS NOT NULL;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscriptions FROM anon, authenticated;
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
DROP POLICY IF EXISTS "org: ver" ON public.subscriptions;
CREATE POLICY "org: ver" ON public.subscriptions FOR SELECT TO authenticated
  USING (private.has_permission(organization_id, 'org.billing') OR private.has_permission(organization_id, 'org.settings')
         OR private.is_platform_operator());

-- Liga exatamente os módulos do plano (o resto desliga) e copia a franquia do cérebro.
CREATE OR REPLACE FUNCTION private.apply_plan(org uuid, plan text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.plans; m text;
BEGIN
  SELECT * INTO p FROM public.plans WHERE key = plan;
  IF p.key IS NULL THEN RAISE EXCEPTION 'plano inexistente' USING ERRCODE = '22023'; END IF;
  FOREACH m IN ARRAY ARRAY['diagnostico', 'ia', 'canais', 'telefonia', 'campanhas', 'cobrancas', 'gestao'] LOOP
    INSERT INTO public.org_modules (organization_id, module, enabled, updated_at)
    VALUES (org, m, m = ANY (p.modules), now())
    ON CONFLICT (organization_id, module) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();
  END LOOP;
  UPDATE public.org_modules SET limits = coalesce(limits, '{}'::jsonb)
      || jsonb_strip_nulls(jsonb_build_object('analises_mes', p.limits -> 'analises_mes', 'manual_dia', p.limits -> 'manual_dia'))
  WHERE organization_id = org AND module = 'gestao';
  PERFORM private.audit(org, 'plan.applied', plan, jsonb_build_object('modules', p.modules));
END $$;
REVOKE ALL ON FUNCTION private.apply_plan(uuid, text) FROM PUBLIC, anon, authenticated;

-- Assinatura vencida/cancelada: desliga os módulos (dados guardados; ao pagar, apply_plan religa).
CREATE OR REPLACE FUNCTION private.pause_plan(org uuid)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.org_modules SET enabled = false, updated_at = now() WHERE organization_id = org;
$$;
REVOKE ALL ON FUNCTION private.pause_plan(uuid) FROM PUBLIC, anon, authenticated;

-- Quem está logado cria a própria empresa (teste grátis). E-mail confirmado, 1 teste por pessoa, até 3 empresas.
CREATE OR REPLACE FUNCTION public.self_signup_org(org_name text, template text, plan text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE me uuid := (SELECT auth.uid()); p public.plans; org uuid; confirmed timestamptz; mail text;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'entre na sua conta primeiro' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('signup:' || me::text));
  SELECT email_confirmed_at, email INTO confirmed, mail FROM auth.users WHERE id = me;
  IF confirmed IS NULL THEN RAISE EXCEPTION 'confirme o seu e-mail antes de criar a empresa' USING ERRCODE = '42501'; END IF;
  IF char_length(btrim(coalesce(org_name, ''))) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'informe o nome da empresa' USING ERRCODE = '22023'; END IF;
  SELECT * INTO p FROM public.plans WHERE key = plan AND active AND public;
  IF p.key IS NULL THEN RAISE EXCEPTION 'plano indisponível' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_templates WHERE key = template AND active) THEN
    RAISE EXCEPTION 'tipo de empresa indisponível' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.organization_members WHERE user_id = me AND role = 'owner') >= 3 THEN
    RAISE EXCEPTION 'limite de empresas por pessoa atingido; fale com a Clubetec' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.subscriptions s JOIN public.organizations o ON o.id = s.organization_id
             WHERE o.created_by = me AND s.trial_ends_at IS NOT NULL) THEN
    RAISE EXCEPTION 'o teste grátis já foi usado nesta conta; fale com a Clubetec para uma nova empresa' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.organizations (name, slug, template_key, created_by)
  VALUES (left(btrim(org_name), 120), 'org-' || left(md5(gen_random_uuid()::text), 10), template, me)
  RETURNING id INTO org;
  INSERT INTO public.organization_members (organization_id, user_id, role, status) VALUES (org, me, 'owner', 'active');
  PERFORM private.apply_template(org, template, me);
  INSERT INTO public.subscriptions (organization_id, plan_key, status, trial_ends_at, billing_email)
  VALUES (org, p.key, 'trial', now() + make_interval(days => p.trial_days), mail);
  PERFORM private.apply_plan(org, p.key);
  PERFORM private.audit(org, 'org.self_signup', org::text, jsonb_build_object('plan', p.key, 'template', template));
  RETURN org;
END $$;
REVOKE ALL ON FUNCTION public.self_signup_org(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.self_signup_org(text, text, text) TO authenticated;

-- Situação da assinatura para a tela (dono/admin): plano, prazos e uso de IA do mês × franquia.
CREATE OR REPLACE FUNCTION public.my_subscription(org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.subscriptions; p public.plans; used bigint;
BEGIN
  IF NOT (private.has_permission(org, 'org.billing') OR private.has_permission(org, 'org.settings')) THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.subscriptions WHERE organization_id = org;
  IF s.organization_id IS NULL THEN RETURN jsonb_build_object('status', 'sem_assinatura'); END IF;
  SELECT * INTO p FROM public.plans WHERE key = s.plan_key;
  SELECT coalesce(sum(calls), 0) INTO used FROM public.ai_usage_daily
  WHERE organization_id = org AND source = 'plataforma' AND day >= date_trunc('month', now())::date;
  RETURN jsonb_build_object(
    'status', s.status, 'plan_key', s.plan_key, 'plan_name', p.name, 'price_cents', p.price_cents, 'setup_cents', p.setup_cents,
    'trial_ends_at', s.trial_ends_at, 'current_period_end', s.current_period_end, 'cancel_at_period_end', s.cancel_at_period_end,
    'billing_email', s.billing_email, 'has_billing', s.asaas_subscription_id IS NOT NULL,
    'ai_used', used, 'ai_limit', (p.limits ->> 'ai_calls_mes')::integer, 'limits', p.limits);
END $$;
REVOKE ALL ON FUNCTION public.my_subscription(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_subscription(uuid) TO authenticated;

-- Clubetec: criar/editar plano.
CREATE OR REPLACE FUNCTION public.platform_save_plan(p_key text, p_name text, p_description text, p_price integer, p_setup integer,
  p_modules text[], p_limits jsonb, p_features text[], p_trial integer, p_public boolean, p_active boolean, p_sort integer)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'só a Clubetec' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.plans (key, name, description, price_cents, setup_cents, modules, limits, features, trial_days, public, active, sort, updated_at)
  VALUES (p_key, btrim(p_name), p_description, p_price, p_setup, p_modules, coalesce(p_limits, '{}'), coalesce(p_features, '{}'),
          coalesce(p_trial, 14), coalesce(p_public, true), coalesce(p_active, true), coalesce(p_sort, 0), now())
  ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, price_cents = EXCLUDED.price_cents,
    setup_cents = EXCLUDED.setup_cents, modules = EXCLUDED.modules, limits = EXCLUDED.limits, features = EXCLUDED.features,
    trial_days = EXCLUDED.trial_days, public = EXCLUDED.public, active = EXCLUDED.active, sort = EXCLUDED.sort, updated_at = now();
  PERFORM private.audit(NULL, 'platform.plan_saved', p_key, jsonb_build_object('price', p_price, 'modules', p_modules));
END $$;
REVOKE ALL ON FUNCTION public.platform_save_plan(text, text, text, integer, integer, text[], jsonb, text[], integer, boolean, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_save_plan(text, text, text, integer, integer, text[], jsonb, text[], integer, boolean, boolean, integer) TO authenticated;

-- Clubetec: definir plano/situação de uma empresa (vendas fechadas fora do site, cortesia, correção).
CREATE OR REPLACE FUNCTION public.platform_set_subscription(org uuid, plan text, new_status text, trial_days integer)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'só a Clubetec' USING ERRCODE = '42501'; END IF;
  IF new_status NOT IN ('trial', 'active', 'past_due', 'canceled', 'expired') THEN RAISE EXCEPTION 'situação inválida' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.subscriptions (organization_id, plan_key, status, trial_ends_at)
  VALUES (org, plan, new_status, CASE WHEN new_status = 'trial' THEN now() + make_interval(days => coalesce(trial_days, 14)) END)
  ON CONFLICT (organization_id) DO UPDATE SET plan_key = EXCLUDED.plan_key, status = EXCLUDED.status,
    trial_ends_at = CASE WHEN EXCLUDED.status = 'trial' THEN EXCLUDED.trial_ends_at ELSE public.subscriptions.trial_ends_at END,
    updated_at = now();
  IF new_status IN ('trial', 'active', 'past_due') THEN PERFORM private.apply_plan(org, plan); ELSE PERFORM private.pause_plan(org); END IF;
  PERFORM private.audit(org, 'platform.subscription_set', plan, jsonb_build_object('status', new_status));
END $$;
REVOKE ALL ON FUNCTION public.platform_set_subscription(uuid, text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_subscription(uuid, text, text, integer) TO authenticated;

-- Limite de IA: por minuto (como antes) + franquia mensal do plano para a IA da plataforma.
CREATE OR REPLACE FUNCTION public.service_ai_take(org uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE used integer; lim integer; monthly integer; month_used bigint;
BEGIN
  -- Franquia do mês (só quando a empresa tem plano com ai_calls_mes e usa a IA da plataforma).
  SELECT (p.limits ->> 'ai_calls_mes')::integer INTO monthly
  FROM public.subscriptions s JOIN public.plans p ON p.key = s.plan_key
  WHERE s.organization_id = org AND p.limits ->> 'ai_calls_mes' ~ '^[0-9]{1,9}$';
  IF monthly IS NOT NULL THEN
    SELECT coalesce(sum(calls), 0) INTO month_used FROM public.ai_usage_daily
    WHERE organization_id = org AND source = 'plataforma' AND day >= date_trunc('month', now())::date;
    IF month_used >= monthly THEN RETURN false; END IF;
  END IF;

  SELECT coalesce(nullif(settings ->> 'ai_rate_limit_per_minute', '')::integer, 30) INTO lim
  FROM public.organizations WHERE id = org;
  INSERT INTO public.org_rate_usage (organization_id, bucket, minute, n)
  VALUES (org, 'ai', date_trunc('minute', now()), 1)
  ON CONFLICT (organization_id, bucket, minute) DO UPDATE SET n = public.org_rate_usage.n + 1
  RETURNING n INTO used;
  DELETE FROM public.org_rate_usage WHERE organization_id = org AND minute < now() - interval '10 minutes';
  RETURN used <= greatest(least(coalesce(lim, 30), 120), 1);
EXCEPTION WHEN invalid_text_representation THEN
  RETURN true; -- configuração inválida não pode parar o atendimento
END $$;
REVOKE ALL ON FUNCTION public.service_ai_take(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_ai_take(uuid) TO service_role;

-- Tipos de empresa para quem ainda não tem empresa escolher (só nome e descrição).
CREATE OR REPLACE FUNCTION public.signup_templates()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', key, 'name', name, 'description', description) ORDER BY name), '[]'::jsonb)
  FROM public.org_templates WHERE active
$$;
REVOKE ALL ON FUNCTION public.signup_templates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.signup_templates() TO authenticated;
