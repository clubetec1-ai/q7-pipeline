-- Etapa B, item 6: retenção automática por empresa (LGPD — guardar só pelo tempo necessário). Desligada por padrão; o
-- dono escolhe em Configurações → Horário e LGPD quantos meses guardar o conteúdo das conversas (6 a 120). Depois disso,
-- o texto e os arquivos das mensagens (e as notas internas) de conversas SEM atendimento aberto são apagados; ficam os
-- contatos, os protocolos e os números dos relatórios. Roda todo dia, em lotes; os arquivos saem do armazenamento pela
-- função `retention`. Idempotente.
CREATE OR REPLACE FUNCTION private.retention_months(org uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN jsonb_typeof(settings -> 'retencao_meses') = 'number'
               AND (settings ->> 'retencao_meses')::numeric BETWEEN 6 AND 120
              THEN (settings ->> 'retencao_meses')::numeric::int END
  FROM public.organizations WHERE id = org
$$;
REVOKE ALL ON FUNCTION private.retention_months(uuid) FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS messages_org_created_idx ON public.messages (organization_id, created_at);

-- Servidor: apaga um lote e devolve os arquivos para a função tirar do armazenamento.
CREATE OR REPLACE FUNCTION public.service_retention_batch(p_limit int)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE o record; media text[] := '{}'; total int := 0; n int; lim int := least(greatest(coalesce(p_limit, 500), 1), 2000);
BEGIN
  FOR o IN SELECT id, private.retention_months(id) AS meses FROM public.organizations
           WHERE private.retention_months(id) IS NOT NULL LOOP
    WITH alvo AS (
      SELECT m.id, m.media_path FROM public.messages m
      WHERE m.organization_id = o.id AND m.created_at < now() - make_interval(months => o.meses)
        AND m.content IS DISTINCT FROM '[apagado pela política de retenção]'
        AND NOT EXISTS (SELECT 1 FROM public.tickets t WHERE t.conversation_id = m.conversation_id AND t.status <> 'closed')
      ORDER BY m.created_at LIMIT lim
    ), upd AS (
      UPDATE public.messages m SET content = '[apagado pela política de retenção]', media_path = NULL, media_name = NULL, media_text = NULL
      FROM alvo WHERE m.id = alvo.id RETURNING alvo.media_path
    )
    SELECT count(*), coalesce(array_agg(media_path) FILTER (WHERE media_path IS NOT NULL), '{}') INTO n, media FROM upd;
    UPDATE public.internal_notes SET content = '[apagada pela política de retenção]'
    WHERE organization_id = o.id AND created_at < now() - make_interval(months => o.meses)
      AND content IS DISTINCT FROM '[apagada pela política de retenção]'
      AND NOT EXISTS (SELECT 1 FROM public.tickets t WHERE t.conversation_id = internal_notes.conversation_id AND t.status <> 'closed');
    IF n > 0 THEN
      PERFORM private.audit(o.id, 'lgpd.retention', NULL, jsonb_build_object('mensagens', n, 'meses', o.meses), 'system', 'retencao');
    END IF;
    total := total + n;
    -- Arquivos só da própria empresa (o caminho começa pelo id dela).
    media := array(SELECT p FROM unnest(media) p WHERE p LIKE o.id::text || '/%');
    IF array_length(media, 1) > 0 THEN
      RETURN jsonb_build_object('mensagens', total, 'media', to_jsonb(media), 'mais', true);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('mensagens', total, 'media', '[]'::jsonb, 'mais', false);
END $$;
REVOKE ALL ON FUNCTION public.service_retention_batch(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_retention_batch(int) TO service_role;

-- Todo dia de madrugada, só se alguma empresa ligou a retenção.
CREATE OR REPLACE FUNCTION private.retention_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE private.retention_months(id) IS NOT NULL) THEN RETURN; END IF;
  SELECT value INTO base FROM public.app_settings WHERE key = 'functions_base_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'platform:cron_secret';
  IF coalesce(base, '') = '' OR secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(url := base || '/retention',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
END $$;
REVOKE ALL ON FUNCTION private.retention_tick() FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'retention';
    PERFORM cron.schedule('retention', '20 7 * * *', 'SELECT private.retention_tick()');
  END IF;
END $$;
