-- =============================================================================
-- INPI: aviso por e-mail próprio (não depende só do sino).
--  * inpi_settings.email_on / emails: liga o e-mail e para quem vai (vazio = e-mail
--    dos operadores da Clubetec).
--  * service_inpi_record devolve o que é novo nesta revista (a função inpi-watch manda
--    UM e-mail-resumo por revista) e avisa quando a leitura falhou pela primeira vez.
--  * Os avisos do sino 'inpi'/'inpi_conflict' deixam de gerar e-mail um a um.
-- Idempotente.
-- =============================================================================
ALTER TABLE public.inpi_settings ADD COLUMN IF NOT EXISTS email_on boolean NOT NULL DEFAULT true;
ALTER TABLE public.inpi_settings ADD COLUMN IF NOT EXISTS emails text[] NOT NULL DEFAULT '{}';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inpi_settings_emails_check') THEN
    ALTER TABLE public.inpi_settings ADD CONSTRAINT inpi_settings_emails_check CHECK (cardinality(emails) <= 5);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.platform_inpi_set_email(p_on boolean, p_emails text[])
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e text[];
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'só a Clubetec' USING ERRCODE = '42501'; END IF;
  e := ARRAY(SELECT DISTINCT lower(btrim(x)) FROM unnest(coalesce(p_emails, '{}')) x WHERE btrim(x) <> '');
  IF cardinality(e) > 5 THEN RAISE EXCEPTION 'No máximo 5 e-mails' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(e) x WHERE x !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' OR char_length(x) > 120) THEN
    RAISE EXCEPTION 'E-mail inválido' USING ERRCODE = '22023';
  END IF;
  UPDATE public.inpi_settings SET email_on = coalesce(p_on, true), emails = e, updated_at = now() WHERE id;
  PERFORM private.audit(NULL, 'platform.inpi_email', 'inpi', jsonb_build_object('on', p_on, 'count', cardinality(e)));
END $$;
REVOKE ALL ON FUNCTION public.platform_inpi_set_email(boolean, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_inpi_set_email(boolean, text[]) TO authenticated;

-- Para quem vai o e-mail (o servidor lê; o navegador não precisa).
CREATE OR REPLACE FUNCTION public.service_inpi_recipients()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('on', s.email_on, 'to',
    CASE WHEN cardinality(s.emails) > 0 THEN to_jsonb(s.emails)
         ELSE coalesce((SELECT jsonb_agg(DISTINCT p.email) FROM public.platform_operators po
                        JOIN public.profiles p ON p.user_id = po.user_id WHERE coalesce(p.email, '') <> ''), '[]'::jsonb) END)
  FROM public.inpi_settings s WHERE s.id;
$$;
REVOKE ALL ON FUNCTION public.service_inpi_recipients() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_inpi_recipients() TO service_role;

CREATE OR REPLACE FUNCTION public.service_inpi_record(p_rpi int, p_date date, p_processes jsonb, p_conflicts jsonb, p_error text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p jsonb; d jsonb; ev int := 0; cf int := 0; nid uuid; lbl text; prz date;
        new_ev jsonb := '[]'::jsonb; new_cf jsonb := '[]'::jsonb; had_error boolean;
BEGIN
  IF p_rpi IS NULL OR p_rpi < 1 THEN RAISE EXCEPTION 'revista inválida' USING ERRCODE = '22023'; END IF;
  IF p_error IS NOT NULL THEN
    SELECT error IS NOT NULL INTO had_error FROM public.inpi_scans WHERE rpi = p_rpi;
    INSERT INTO public.inpi_scans (rpi, rpi_date, error) VALUES (p_rpi, p_date, left(p_error, 300))
    ON CONFLICT (rpi) DO UPDATE SET error = EXCLUDED.error, scanned_at = now();
    RETURN jsonb_build_object('events', 0, 'conflicts', 0, 'first_error', NOT coalesce(had_error, false));
  END IF;
  IF p_date IS NULL THEN RAISE EXCEPTION 'data da revista' USING ERRCODE = '22023'; END IF;

  FOR p IN SELECT * FROM jsonb_array_elements(coalesce(p_processes, '[]'::jsonb)) LOOP
    CONTINUE WHEN coalesce(p ->> 'numero', '') !~ '^[0-9]{9}$';
    INSERT INTO public.inpi_processes (numero, label, source, marca)
    VALUES (p ->> 'numero', left(coalesce(p ->> 'marca', 'Processo da Clubetec'), 120), 'titular', left(p ->> 'marca', 200))
    ON CONFLICT (numero) DO UPDATE SET marca = coalesce(public.inpi_processes.marca, EXCLUDED.marca);
    SELECT label INTO lbl FROM public.inpi_processes WHERE numero = p ->> 'numero';
    FOR d IN SELECT * FROM jsonb_array_elements(coalesce(p -> 'despachos', '[]'::jsonb)) LOOP
      prz := CASE WHEN (d ->> 'dias') ~ '^[0-9]{1,3}$' THEN p_date + (d ->> 'dias')::int END;
      INSERT INTO public.inpi_events (numero, rpi, rpi_date, codigo, nome, complemento, nivel, orientacao, prazo)
      VALUES (p ->> 'numero', p_rpi, p_date, left(coalesce(d ->> 'codigo', '?'), 20), left(coalesce(d ->> 'nome', ''), 300),
              left(d ->> 'complemento', 2000),
              CASE WHEN d ->> 'nivel' IN ('urgente', 'atencao', 'info', 'ok') THEN d ->> 'nivel' ELSE 'info' END,
              left(d ->> 'orientacao', 500), prz)
      ON CONFLICT (numero, rpi, codigo) DO NOTHING
      RETURNING id INTO nid;
      IF nid IS NOT NULL THEN
        ev := ev + 1;
        UPDATE public.inpi_processes SET last_status = left(d ->> 'nome', 300), last_rpi = p_rpi, last_at = p_date
        WHERE numero = p ->> 'numero' AND (last_rpi IS NULL OR last_rpi <= p_rpi);
        new_ev := new_ev || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'numero', p ->> 'numero', 'label', lbl, 'despacho', left(d ->> 'nome', 300), 'nivel', d ->> 'nivel',
          'orientacao', left(d ->> 'orientacao', 500), 'complemento', left(d ->> 'complemento', 600), 'prazo', prz)));
        PERFORM private.notify_platform_operators('inpi', jsonb_strip_nulls(jsonb_build_object(
          'numero', p ->> 'numero', 'label', lbl, 'despacho', left(d ->> 'nome', 200), 'nivel', d ->> 'nivel',
          'rpi', p_rpi, 'prazo', to_char(prz, 'DD/MM/YYYY'))));
        nid := NULL;
      END IF;
    END LOOP;
  END LOOP;

  FOR p IN SELECT * FROM jsonb_array_elements(coalesce(p_conflicts, '[]'::jsonb)) LOOP
    CONTINUE WHEN coalesce(p ->> 'numero', '') !~ '^[0-9]{9}$' OR coalesce(p ->> 'marca', '') = '';
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.inpi_processes WHERE numero = p ->> 'numero');
    prz := CASE WHEN (p ->> 'despacho') ILIKE 'Publicação de pedido%' THEN p_date + 60 END;
    INSERT INTO public.inpi_conflicts (numero, rpi, rpi_date, marca, termo, titulares, classes, despacho, prazo)
    VALUES (p ->> 'numero', p_rpi, p_date, left(p ->> 'marca', 200), left(p ->> 'termo', 60), left(p ->> 'titulares', 500),
            left(p ->> 'classes', 200), left(p ->> 'despacho', 300), prz)
    ON CONFLICT (numero, rpi) DO NOTHING
    RETURNING id INTO nid;
    IF nid IS NOT NULL THEN
      cf := cf + 1;
      new_cf := new_cf || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'numero', p ->> 'numero', 'marca', left(p ->> 'marca', 200), 'titulares', left(p ->> 'titulares', 300),
        'classes', left(p ->> 'classes', 100), 'despacho', left(p ->> 'despacho', 300), 'prazo', prz)));
      PERFORM private.notify_platform_operators('inpi_conflict', jsonb_strip_nulls(jsonb_build_object(
        'numero', p ->> 'numero', 'marca', left(p ->> 'marca', 120), 'titulares', left(p ->> 'titulares', 120),
        'classes', left(p ->> 'classes', 60), 'despacho', left(p ->> 'despacho', 200), 'rpi', p_rpi)));
      nid := NULL;
    END IF;
  END LOOP;

  INSERT INTO public.inpi_scans (rpi, rpi_date, events, conflicts) VALUES (p_rpi, p_date, ev, cf)
  ON CONFLICT (rpi) DO UPDATE SET rpi_date = EXCLUDED.rpi_date, events = public.inpi_scans.events + EXCLUDED.events,
    conflicts = public.inpi_scans.conflicts + EXCLUDED.conflicts, error = NULL, scanned_at = now();
  RETURN jsonb_build_object('events', ev, 'conflicts', cf, 'new_events', new_ev, 'new_conflicts', new_cf);
END $$;
REVOKE ALL ON FUNCTION public.service_inpi_record(int, date, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_inpi_record(int, date, jsonb, jsonb, text) TO service_role;

-- O e-mail do INPI agora sai como resumo da revista (inpi-watch); o sino continua.
CREATE OR REPLACE FUNCTION private.email_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text;
BEGIN
  IF NEW.kind NOT IN ('number_health', 'email_health', 'security_alert', 'brain_weekly', 'brain_goal', 'brain_reminder') THEN RETURN NULL; END IF;
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
