-- =============================================================================
-- Acompanhamento dos pedidos de marca no INPI (só a Clubetec vê).
--  * inpi_processes: os processos acompanhados (os 3 pedidos de "Deixa com a IA" e
--    qualquer processo novo em nome da Clubetec, que entra sozinho).
--  * inpi_events: cada despacho publicado na RPI, com o que fazer e o prazo estimado.
--  * inpi_conflicts: marcas de terceiros parecidas com a nossa (prazo de oposição).
--  * inpi_scans: cada revista já lida (uma por semana, toda terça).
--  * inpi_settings: termos e titulares vigiados.
-- A função inpi-watch lê a revista (cron diário: pega a edição nova quando sair) e grava
-- tudo por service_inpi_record, que também avisa os operadores (sino + e-mail).
-- Idempotente.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.inpi_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  terms text[] NOT NULL DEFAULT ARRAY['deixa com a ia', 'deixe com a ia', 'deixa com ia', 'deixe com ia'],
  titulares text[] NOT NULL DEFAULT ARRAY['CLUBETEC'],
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(terms) <= 20 AND cardinality(titulares) <= 10)
);
INSERT INTO public.inpi_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.inpi_processes (
  numero text PRIMARY KEY CHECK (numero ~ '^[0-9]{9}$'),
  label text NOT NULL DEFAULT '' CHECK (char_length(label) <= 120),
  protocolo text CHECK (protocolo IS NULL OR protocolo ~ '^[0-9]{5,20}$'),
  filed_at date,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'titular')),
  marca text CHECK (marca IS NULL OR char_length(marca) <= 200),
  last_status text CHECK (last_status IS NULL OR char_length(last_status) <= 300),
  last_rpi int,
  last_at date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inpi_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero text NOT NULL REFERENCES public.inpi_processes(numero) ON DELETE CASCADE,
  rpi int NOT NULL,
  rpi_date date NOT NULL,
  codigo text NOT NULL CHECK (char_length(codigo) <= 20),
  nome text NOT NULL CHECK (char_length(nome) <= 300),
  complemento text CHECK (complemento IS NULL OR char_length(complemento) <= 2000),
  nivel text NOT NULL DEFAULT 'info' CHECK (nivel IN ('urgente', 'atencao', 'info', 'ok')),
  orientacao text CHECK (orientacao IS NULL OR char_length(orientacao) <= 500),
  prazo date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (numero, rpi, codigo)
);
CREATE INDEX IF NOT EXISTS inpi_events_numero_idx ON public.inpi_events (numero, rpi DESC);

CREATE TABLE IF NOT EXISTS public.inpi_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero text NOT NULL CHECK (numero ~ '^[0-9]{9}$'),
  rpi int NOT NULL,
  rpi_date date NOT NULL,
  marca text NOT NULL CHECK (char_length(marca) <= 200),
  termo text CHECK (termo IS NULL OR char_length(termo) <= 60),
  titulares text CHECK (titulares IS NULL OR char_length(titulares) <= 500),
  classes text CHECK (classes IS NULL OR char_length(classes) <= 200),
  despacho text CHECK (despacho IS NULL OR char_length(despacho) <= 300),
  prazo date,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (numero, rpi)
);

CREATE TABLE IF NOT EXISTS public.inpi_scans (
  rpi int PRIMARY KEY,
  rpi_date date,
  events int NOT NULL DEFAULT 0,
  conflicts int NOT NULL DEFAULT 0,
  error text CHECK (error IS NULL OR char_length(error) <= 300),
  scanned_at timestamptz NOT NULL DEFAULT now()
);

-- Só a Clubetec lê; ninguém escreve direto (só pelas funções abaixo).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['inpi_settings', 'inpi_processes', 'inpi_events', 'inpi_conflicts', 'inpi_scans'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS "clubetec" ON public.%I', t);
    EXECUTE format('CREATE POLICY "clubetec" ON public.%I FOR SELECT TO authenticated USING ((SELECT private.is_platform_operator()))', t);
  END LOOP;
END $$;

-- Os 3 pedidos protocolados em 05/10/2026.
INSERT INTO public.inpi_processes (numero, label, protocolo, filed_at) VALUES
  ('945455720', 'Deixa com a IA — mista, classe 42', '850260519590', '2026-10-05'),
  ('945455780', 'Deixa com a IA — nominativa, classe 42', '850260519601', '2026-10-05'),
  ('945455844', 'Deixa com a IA — mista, classe 9', '850260519609', '2026-10-05')
ON CONFLICT (numero) DO NOTHING;

-- Avisa cada operador da Clubetec (na empresa em que ele está ativo).
CREATE OR REPLACE FUNCTION private.notify_platform_operators(p_kind text, p_ref jsonb)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.notifications (organization_id, user_id, kind, ref)
  SELECT m.organization_id, po.user_id, p_kind, p_ref
  FROM public.platform_operators po
  CROSS JOIN LATERAL (SELECT om.organization_id FROM public.organization_members om
                      WHERE om.user_id = po.user_id AND om.status = 'active'
                      ORDER BY om.created_at LIMIT 1) m;
$$;
REVOKE ALL ON FUNCTION private.notify_platform_operators(text, jsonb) FROM PUBLIC, anon, authenticated;

-- O que a função precisa saber para ler a revista.
CREATE OR REPLACE FUNCTION public.service_inpi_watch()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'numbers', coalesce((SELECT jsonb_agg(numero) FROM public.inpi_processes), '[]'::jsonb),
    'terms', to_jsonb(s.terms), 'titulares', to_jsonb(s.titulares),
    'last_rpi', (SELECT max(rpi) FROM public.inpi_scans WHERE error IS NULL),
    'since', (SELECT min(filed_at) FROM public.inpi_processes))
  FROM public.inpi_settings s WHERE s.id;
$$;
REVOKE ALL ON FUNCTION public.service_inpi_watch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_inpi_watch() TO service_role;

-- Grava o resultado de uma revista. p_processes: [{numero, marca, motivo, despachos:[{codigo,nome,complemento,nivel,orientacao,dias}]}]
-- p_conflicts: [{numero, marca, termo, titulares, classes, despacho}]
CREATE OR REPLACE FUNCTION public.service_inpi_record(p_rpi int, p_date date, p_processes jsonb, p_conflicts jsonb, p_error text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p jsonb; d jsonb; ev int := 0; cf int := 0; nid uuid; lbl text;
BEGIN
  IF p_rpi IS NULL OR p_rpi < 1 THEN RAISE EXCEPTION 'revista inválida' USING ERRCODE = '22023'; END IF;
  IF p_error IS NOT NULL THEN
    INSERT INTO public.inpi_scans (rpi, rpi_date, error) VALUES (p_rpi, p_date, left(p_error, 300))
    ON CONFLICT (rpi) DO UPDATE SET error = EXCLUDED.error, scanned_at = now();
    RETURN jsonb_build_object('events', 0, 'conflicts', 0);
  END IF;
  IF p_date IS NULL THEN RAISE EXCEPTION 'data da revista' USING ERRCODE = '22023'; END IF;

  FOR p IN SELECT * FROM jsonb_array_elements(coalesce(p_processes, '[]'::jsonb)) LOOP
    CONTINUE WHEN coalesce(p ->> 'numero', '') !~ '^[0-9]{9}$';
    INSERT INTO public.inpi_processes (numero, label, source, marca)
    VALUES (p ->> 'numero', left(coalesce(p ->> 'marca', 'Processo da Clubetec'), 120), 'titular', left(p ->> 'marca', 200))
    ON CONFLICT (numero) DO UPDATE SET marca = coalesce(public.inpi_processes.marca, EXCLUDED.marca);
    SELECT label INTO lbl FROM public.inpi_processes WHERE numero = p ->> 'numero';
    FOR d IN SELECT * FROM jsonb_array_elements(coalesce(p -> 'despachos', '[]'::jsonb)) LOOP
      INSERT INTO public.inpi_events (numero, rpi, rpi_date, codigo, nome, complemento, nivel, orientacao, prazo)
      VALUES (p ->> 'numero', p_rpi, p_date, left(coalesce(d ->> 'codigo', '?'), 20), left(coalesce(d ->> 'nome', ''), 300),
              left(d ->> 'complemento', 2000),
              CASE WHEN d ->> 'nivel' IN ('urgente', 'atencao', 'info', 'ok') THEN d ->> 'nivel' ELSE 'info' END,
              left(d ->> 'orientacao', 500),
              CASE WHEN (d ->> 'dias') ~ '^[0-9]{1,3}$' THEN p_date + (d ->> 'dias')::int END)
      ON CONFLICT (numero, rpi, codigo) DO NOTHING
      RETURNING id INTO nid;
      IF nid IS NOT NULL THEN
        ev := ev + 1;
        UPDATE public.inpi_processes SET last_status = left(d ->> 'nome', 300), last_rpi = p_rpi, last_at = p_date
        WHERE numero = p ->> 'numero' AND (last_rpi IS NULL OR last_rpi <= p_rpi);
        PERFORM private.notify_platform_operators('inpi', jsonb_strip_nulls(jsonb_build_object(
          'numero', p ->> 'numero', 'label', lbl, 'despacho', left(d ->> 'nome', 200), 'nivel', d ->> 'nivel',
          'rpi', p_rpi, 'prazo', CASE WHEN (d ->> 'dias') ~ '^[0-9]{1,3}$' THEN to_char(p_date + (d ->> 'dias')::int, 'DD/MM/YYYY') END)));
        nid := NULL;
      END IF;
    END LOOP;
  END LOOP;

  FOR p IN SELECT * FROM jsonb_array_elements(coalesce(p_conflicts, '[]'::jsonb)) LOOP
    CONTINUE WHEN coalesce(p ->> 'numero', '') !~ '^[0-9]{9}$' OR coalesce(p ->> 'marca', '') = '';
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.inpi_processes WHERE numero = p ->> 'numero');
    INSERT INTO public.inpi_conflicts (numero, rpi, rpi_date, marca, termo, titulares, classes, despacho, prazo)
    VALUES (p ->> 'numero', p_rpi, p_date, left(p ->> 'marca', 200), left(p ->> 'termo', 60), left(p ->> 'titulares', 500),
            left(p ->> 'classes', 200), left(p ->> 'despacho', 300),
            CASE WHEN (p ->> 'despacho') ILIKE 'Publicação de pedido%' THEN p_date + 60 END)
    ON CONFLICT (numero, rpi) DO NOTHING
    RETURNING id INTO nid;
    IF nid IS NOT NULL THEN
      cf := cf + 1;
      PERFORM private.notify_platform_operators('inpi_conflict', jsonb_strip_nulls(jsonb_build_object(
        'numero', p ->> 'numero', 'marca', left(p ->> 'marca', 120), 'titulares', left(p ->> 'titulares', 120),
        'classes', left(p ->> 'classes', 60), 'despacho', left(p ->> 'despacho', 200), 'rpi', p_rpi)));
      nid := NULL;
    END IF;
  END LOOP;

  INSERT INTO public.inpi_scans (rpi, rpi_date, events, conflicts) VALUES (p_rpi, p_date, ev, cf)
  ON CONFLICT (rpi) DO UPDATE SET rpi_date = EXCLUDED.rpi_date, events = public.inpi_scans.events + EXCLUDED.events,
    conflicts = public.inpi_scans.conflicts + EXCLUDED.conflicts, error = NULL, scanned_at = now();
  RETURN jsonb_build_object('events', ev, 'conflicts', cf);
END $$;
REVOKE ALL ON FUNCTION public.service_inpi_record(int, date, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_inpi_record(int, date, jsonb, jsonb, text) TO service_role;

-- Clubetec: acompanhar outro processo, parar de acompanhar, termos vigiados, marcar marca parecida como vista.
CREATE OR REPLACE FUNCTION public.platform_inpi_save_process(p_numero text, p_label text, p_protocolo text, p_filed_at date)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'só a Clubetec' USING ERRCODE = '42501'; END IF;
  IF coalesce(p_numero, '') !~ '^[0-9]{9}$' THEN RAISE EXCEPTION 'Número do processo: 9 dígitos' USING ERRCODE = '22023'; END IF;
  IF coalesce(p_protocolo, '') !~ '^([0-9]{5,20})?$' THEN RAISE EXCEPTION 'Protocolo inválido' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.inpi_processes (numero, label, protocolo, filed_at, source)
  VALUES (p_numero, left(btrim(coalesce(p_label, '')), 120), nullif(p_protocolo, ''), p_filed_at, 'manual')
  ON CONFLICT (numero) DO UPDATE SET label = EXCLUDED.label, protocolo = coalesce(EXCLUDED.protocolo, public.inpi_processes.protocolo),
    filed_at = coalesce(EXCLUDED.filed_at, public.inpi_processes.filed_at);
  PERFORM private.audit(NULL, 'platform.inpi_process', p_numero, jsonb_build_object('label', p_label));
END $$;
REVOKE ALL ON FUNCTION public.platform_inpi_save_process(text, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_inpi_save_process(text, text, text, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_inpi_remove_process(p_numero text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'só a Clubetec' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.inpi_processes WHERE numero = p_numero;
  PERFORM private.audit(NULL, 'platform.inpi_process_removed', p_numero, '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.platform_inpi_remove_process(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_inpi_remove_process(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_inpi_set_watch(p_terms text[], p_titulares text[])
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t text[]; h text[];
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'só a Clubetec' USING ERRCODE = '42501'; END IF;
  t := ARRAY(SELECT DISTINCT left(btrim(x), 60) FROM unnest(coalesce(p_terms, '{}')) x WHERE char_length(btrim(x)) >= 4 LIMIT 20);
  h := ARRAY(SELECT DISTINCT left(btrim(x), 80) FROM unnest(coalesce(p_titulares, '{}')) x WHERE char_length(btrim(x)) >= 4 LIMIT 10);
  UPDATE public.inpi_settings SET terms = t, titulares = h, updated_at = now() WHERE id;
  PERFORM private.audit(NULL, 'platform.inpi_watch', 'inpi', jsonb_build_object('terms', t, 'titulares', h));
END $$;
REVOKE ALL ON FUNCTION public.platform_inpi_set_watch(text[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_inpi_set_watch(text[], text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_inpi_review_conflict(p_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'só a Clubetec' USING ERRCODE = '42501'; END IF;
  UPDATE public.inpi_conflicts SET reviewed_at = CASE WHEN reviewed_at IS NULL THEN now() END WHERE id = p_id;
END $$;
REVOKE ALL ON FUNCTION public.platform_inpi_review_conflict(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_inpi_review_conflict(uuid) TO authenticated;

-- Avisos do INPI também por e-mail (para o operador avisado).
CREATE OR REPLACE FUNCTION private.email_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text;
BEGIN
  IF NEW.kind NOT IN ('number_health', 'email_health', 'security_alert', 'brain_weekly', 'brain_goal', 'brain_reminder', 'inpi', 'inpi_conflict') THEN RETURN NULL; END IF;
  IF NEW.kind LIKE 'brain_%' THEN
    IF NOT coalesce((SELECT (settings ->> 'brain_email')::boolean FROM public.organizations WHERE id = NEW.organization_id), false) THEN RETURN NULL; END IF;
    IF NEW.kind = 'brain_reminder' AND NOT coalesce((NEW.ref ->> 'escalado')::boolean, false) THEN RETURN NULL; END IF;
  END IF;
  SELECT value INTO base FROM public.app_settings WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'platform:cron_secret';
  IF coalesce(base, '') = '' OR secret IS NULL THEN RETURN NULL; END IF;
  PERFORM net.http_post(
    url := base || '/notify-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := jsonb_build_object('notification_id', NEW.id));
  RETURN NULL;
END $$;

-- Cron diário (9h de Brasília): a revista sai às terças; nos outros dias a função só
-- confere que não há edição nova (uma consulta pequena) e termina.
CREATE OR REPLACE FUNCTION private.inpi_watch_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text;
BEGIN
  SELECT value INTO base FROM public.app_settings WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'platform:cron_secret';
  IF coalesce(base, '') = '' OR secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(url := base || '/inpi-watch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{"action":"scan"}'::jsonb, timeout_milliseconds := 120000);
END $$;
REVOKE ALL ON FUNCTION private.inpi_watch_tick() FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'inpi-watch') THEN PERFORM cron.unschedule('inpi-watch'); END IF;
    PERFORM cron.schedule('inpi-watch', '0 12 * * *', 'SELECT private.inpi_watch_tick()');
  END IF;
END $$;
