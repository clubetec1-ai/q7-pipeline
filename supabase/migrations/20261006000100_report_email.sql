-- =============================================================================
-- Relatórios por e-mail (Fase 3, item 16). Cada pessoa assina o PRÓPRIO envio
-- (semanal ou mensal) e escolhe os tipos. O relatório é calculado COMO ela
-- (mesmo escopo da tela: dono tudo, supervisor os setores dele, atendente só os
-- próprios números), então o e-mail nunca mostra mais do que ela já vê.
-- Idempotente.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.report_emails (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  frequency text NOT NULL CHECK (frequency IN ('weekly', 'monthly')),
  kinds text[] NOT NULL CHECK (cardinality(kinds) BETWEEN 1 AND 6
    AND kinds <@ ARRAY['atendentes', 'operacao', 'qualidade', 'melhorias', 'comercial', 'ia']),
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
ALTER TABLE public.report_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_emails FROM anon, authenticated;
GRANT SELECT ON public.report_emails TO authenticated;
GRANT ALL ON public.report_emails TO service_role;
DROP POLICY IF EXISTS "own: ver" ON public.report_emails;
CREATE POLICY "own: ver" ON public.report_emails FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND private.is_member(organization_id));

-- Ligar / trocar / desligar (freq NULL) o próprio envio.
CREATE OR REPLACE FUNCTION public.set_report_email(org uuid, freq text, p_kinds text[])
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE scope text := private.report_scope(org); k text[];
BEGIN
  IF scope IS NULL THEN RAISE EXCEPTION 'sem acesso' USING ERRCODE = '42501'; END IF;
  IF freq IS NULL THEN
    DELETE FROM public.report_emails WHERE organization_id = org AND user_id = (SELECT auth.uid());
    RETURN;
  END IF;
  -- Atendente só recebe os tipos que pode ver na tela.
  k := ARRAY(SELECT DISTINCT x FROM unnest(p_kinds) x
             WHERE scope <> 'self' OR x IN ('atendentes', 'qualidade'));
  INSERT INTO public.report_emails (organization_id, user_id, frequency, kinds)
  VALUES (org, (SELECT auth.uid()), freq, k)
  ON CONFLICT (organization_id, user_id) DO UPDATE SET frequency = EXCLUDED.frequency, kinds = EXCLUDED.kinds;
END $$;
REVOKE ALL ON FUNCTION public.set_report_email(uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_report_email(uuid, text, text[]) TO authenticated;

-- Envios vencidos hoje (horário de Brasília): semanal às segundas, mensal no dia 1.
-- Marca como enviado ao entregar a lista (não repete no mesmo dia).
CREATE OR REPLACE FUNCTION public.service_report_emails_due()
RETURNS TABLE (organization_id uuid, user_id uuid, frequency text, kinds text[], email text, org_name text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  RETURN QUERY
  WITH due AS (
    UPDATE public.report_emails r SET last_sent_at = now()
    WHERE ((r.frequency = 'weekly' AND extract(isodow FROM today) = 1) OR (r.frequency = 'monthly' AND extract(day FROM today) = 1))
      AND (r.last_sent_at IS NULL OR (r.last_sent_at AT TIME ZONE 'America/Sao_Paulo')::date < today)
      AND EXISTS (SELECT 1 FROM public.organization_members m WHERE m.organization_id = r.organization_id
                  AND m.user_id = r.user_id AND m.status = 'active')
      AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = r.organization_id AND o.status = 'active')
    RETURNING r.*
  )
  SELECT d.organization_id, d.user_id, d.frequency, d.kinds, p.email, o.name
  FROM due d JOIN public.profiles p ON p.user_id = d.user_id JOIN public.organizations o ON o.id = d.organization_id
  WHERE coalesce(p.email, '') <> '';
END $$;
REVOKE ALL ON FUNCTION public.service_report_emails_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_report_emails_due() TO service_role;

-- Relatório calculado como a pessoa (o mesmo report() da tela, com o escopo dela).
CREATE OR REPLACE FUNCTION public.service_report_as(org uuid, uid uuid, kind text, since timestamptz, until timestamptz)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE out jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = org AND user_id = uid AND status = 'active') THEN
    RETURN NULL;
  END IF;
  -- Sem sessão interativa: o envio foi assinado pela própria pessoa (logada, com MFA se exigido) e vai só para o
  -- e-mail dela; por isso conta como sessão verificada (aal2). O escopo continua o do papel dela.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  PERFORM set_config('request.jwt.claim.sub', uid::text, true);
  BEGIN
    out := public.report(org, kind, since, until, NULL);
  EXCEPTION WHEN insufficient_privilege THEN out := NULL;
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RETURN out;
END $$;
REVOKE ALL ON FUNCTION public.service_report_as(uuid, uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_report_as(uuid, uuid, text, timestamptz, timestamptz) TO service_role;

-- Cron diário 8h (Brasília = 11h UTC): só chama a função quando há envio para hoje.
CREATE OR REPLACE FUNCTION private.report_email_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text; today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF extract(isodow FROM today) <> 1 AND extract(day FROM today) <> 1 THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.report_emails) THEN RETURN; END IF;
  SELECT value INTO base FROM public.app_settings WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'platform:cron_secret';
  IF coalesce(base, '') = '' OR secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(
    url := base || '/report-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
END $$;
REVOKE ALL ON FUNCTION private.report_email_tick() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'report-email') THEN PERFORM cron.unschedule('report-email'); END IF;
    PERFORM cron.schedule('report-email', '0 11 * * *', 'SELECT private.report_email_tick()');
  END IF;
END $$;
