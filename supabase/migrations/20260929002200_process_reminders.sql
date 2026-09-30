-- =============================================================================
-- Setores: implementar agora/depois com lembrete (pedido em 30/09)
-- Cada processo do Diagnóstico (company_profiles.processes) pode ter
--   implementar: "agora" | "depois" | "nao", lembrar_em: "AAAA-MM-DD", lembrado_em.
-- Todo dia às 9h (Brasília) quem cuida da empresa (dono/admin ativos) recebe um
-- aviso para cada processo "depois" cuja data chegou; não repete para a mesma data.
-- Idempotente.
-- =============================================================================

CREATE OR REPLACE FUNCTION private.process_reminders_tick()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  r record; el jsonb; out jsonb; changed boolean; n integer := 0; due date;
BEGIN
  FOR r IN SELECT organization_id, processes FROM public.company_profiles
           WHERE jsonb_typeof(processes) = 'array' AND processes @> '[{"implementar":"depois"}]' LOOP
    out := '[]'::jsonb; changed := false;
    FOR el IN SELECT value FROM jsonb_array_elements(r.processes) LOOP
      due := CASE WHEN el->>'lembrar_em' ~ '^\d{4}-\d{2}-\d{2}$' THEN (el->>'lembrar_em')::date END;
      IF el->>'implementar' = 'depois' AND due IS NOT NULL AND due <= today
         AND (el->>'lembrado_em' IS NULL OR el->>'lembrado_em' < el->>'lembrar_em') THEN
        INSERT INTO public.notifications (organization_id, user_id, kind, ref)
        SELECT r.organization_id, m.user_id, 'process_reminder',
               jsonb_build_object('nome', left(coalesce(el->>'nome', ''), 120), 'setor', left(coalesce(el->>'setor', el->>'area', ''), 80))
        FROM public.organization_members m
        WHERE m.organization_id = r.organization_id AND m.status = 'active' AND m.role IN ('owner', 'admin');
        el := el || jsonb_build_object('lembrado_em', to_char(today, 'YYYY-MM-DD'));
        changed := true; n := n + 1;
      END IF;
      out := out || jsonb_build_array(el);
    END LOOP;
    IF changed THEN UPDATE public.company_profiles SET processes = out WHERE organization_id = r.organization_id; END IF;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION private.process_reminders_tick() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-reminders') THEN PERFORM cron.unschedule('process-reminders'); END IF;
  PERFORM cron.schedule('process-reminders', '0 12 * * *', 'SELECT private.process_reminders_tick()');
END $$;
