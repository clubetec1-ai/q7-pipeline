-- =============================================================================
-- Dados da Clubetec (a fornecedora e representante legal do software): uma linha
-- com o que a Receita Federal mostra do CNPJ (razão social, endereço, porte, CNAEs),
-- atualizada sozinha toda semana pela consulta pública do CNPJ, mais os dados que só
-- a Clubetec informa (site, e-mail do encarregado de dados/LGPD, suporte).
-- Usada em termos, privacidade, cobranças e e-mails. Leitura pública (são dados
-- públicos da empresa); só a Clubetec e o servidor alteram. Idempotente.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.platform_company (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  cnpj text NOT NULL CHECK (cnpj ~ '^[0-9]{14}$'),
  official jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(official::text) <= 20000),
  extra jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(extra::text) <= 5000),
  refreshed_at timestamptz,
  refresh_error text CHECK (refresh_error IS NULL OR char_length(refresh_error) <= 300),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_company ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_company FROM anon, authenticated;
GRANT SELECT ON public.platform_company TO anon, authenticated;
GRANT ALL ON public.platform_company TO service_role;
DROP POLICY IF EXISTS "publico" ON public.platform_company;
CREATE POLICY "publico" ON public.platform_company FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.platform_company (cnpj) VALUES ('31778487000161') ON CONFLICT (id) DO NOTHING;

-- Clubetec: dados que não vêm da Receita (site, encarregado de dados, suporte).
CREATE OR REPLACE FUNCTION public.platform_set_company_extra(p_extra jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e jsonb := '{}'::jsonb; k text;
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'só a Clubetec' USING ERRCODE = '42501'; END IF;
  FOREACH k IN ARRAY ARRAY['site', 'email_contato', 'email_encarregado', 'nome_encarregado', 'telefone_suporte'] LOOP
    IF char_length(coalesce(p_extra ->> k, '')) BETWEEN 1 AND 200 THEN e := e || jsonb_build_object(k, btrim(p_extra ->> k)); END IF;
  END LOOP;
  UPDATE public.platform_company SET extra = e, updated_at = now() WHERE id;
  PERFORM private.audit(NULL, 'platform.company_extra', 'clubetec', e);
END $$;
REVOKE ALL ON FUNCTION public.platform_set_company_extra(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_company_extra(jsonb) TO authenticated;

-- Cron semanal (segunda 6h de Brasília): atualiza pela consulta pública do CNPJ.
CREATE OR REPLACE FUNCTION private.platform_company_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text;
BEGIN
  SELECT value INTO base FROM public.app_settings WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'platform:cron_secret';
  IF coalesce(base, '') = '' OR secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(url := base || '/platform-company',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{"action":"refresh"}'::jsonb, timeout_milliseconds := 30000);
END $$;
REVOKE ALL ON FUNCTION private.platform_company_tick() FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'platform-company') THEN PERFORM cron.unschedule('platform-company'); END IF;
    PERFORM cron.schedule('platform-company', '0 9 * * 1', 'SELECT private.platform_company_tick()');
  END IF;
END $$;
