-- Cérebro da plataforma (desenho 07 §12, fatia 11): o software se gerenciando para todas as empresas.
--  Sinal (só metadados: contagens, códigos, nomes de função; nunca conteúdo de conversa) → incidente (agrupado por regra,
--  com gravidade e quantas empresas afetadas — em número) → triagem por regra para a equipe de IA dona → diagnóstico e
--  proposta da IA (função platform-brain) → revisão por regra fixa (Guardião da plataforma + QA) → aprovação humana
--  (operador Clubetec) → publicação pelo caminho normal (testes) → verificação automática (o sinal parou?) → aprendizado.
--  Nenhum agente publica código nem mexe no banco sozinho. Só a equipe da plataforma vê. Idempotente.

-- Texto de erro sem dado pessoal: e-mails e sequências de números viram marcadores; no máximo 160 letras.
CREATE OR REPLACE FUNCTION private.scrub(t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT left(regexp_replace(regexp_replace(regexp_replace(coalesce(t, ''),
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+', '[e-mail]', 'g'),
    '\d[\d .()/-]{4,}\d', '[número]', 'g'),
    '\s+', ' ', 'g'), 160)
$$;
REVOKE ALL ON FUNCTION private.scrub(text) FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.platform_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL CHECK (char_length(fingerprint) BETWEEN 2 AND 200),
  kind text NOT NULL CHECK (kind ~ '^[a-z_]{2,40}$'),
  equipe text NOT NULL CHECK (equipe IN ('engenharia_front', 'engenharia_back', 'integracoes', 'seguranca', 'qualidade', 'design', 'suporte', 'custos')),
  gravidade text NOT NULL CHECK (gravidade IN ('baixa', 'media', 'alta', 'critica')),
  titulo text NOT NULL CHECK (char_length(titulo) BETWEEN 2 AND 200),
  empresas int NOT NULL DEFAULT 0,
  ocorrencias int NOT NULL DEFAULT 0,
  pico int NOT NULL DEFAULT 0,
  evidencia jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(evidencia::text) <= 4000),
  status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'proposta', 'aprovado', 'resolvido', 'ignorado')),
  diagnostico jsonb CHECK (diagnostico IS NULL OR octet_length(diagnostico::text) <= 20000),
  revisao jsonb CHECK (revisao IS NULL OR octet_length(revisao::text) <= 4000),
  nota text CHECK (nota IS NULL OR char_length(nota) <= 2000),
  decided_by uuid,
  decided_at timestamptz,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS platform_incidents_open_uq ON public.platform_incidents (fingerprint) WHERE status NOT IN ('resolvido', 'ignorado');
CREATE INDEX IF NOT EXISTS platform_incidents_status_idx ON public.platform_incidents (status, last_seen DESC);
ALTER TABLE public.platform_incidents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_incidents FROM anon, authenticated;
GRANT SELECT ON public.platform_incidents TO authenticated;
DROP POLICY IF EXISTS "ler: equipe da plataforma" ON public.platform_incidents;
CREATE POLICY "ler: equipe da plataforma" ON public.platform_incidents FOR SELECT TO authenticated USING (private.is_platform_operator());

-- Sinais por regra. Cada linha: impressão digital, regra, equipe dona, título, empresas afetadas (número), ocorrências na janela.
CREATE OR REPLACE FUNCTION private.platform_signals()
RETURNS TABLE (fp text, kind text, equipe text, titulo text, empresas int, ocorrencias int, evidencia jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  -- Engenharia (back-end e banco)
  SELECT 'cron:' || j.jobname, 'rotina_falhou', 'engenharia_back', 'Rotina agendada falhando: ' || j.jobname, 0, count(*)::int,
         jsonb_build_object('janela', '2 horas', 'rotina', j.jobname, 'erro', private.scrub(max(d.return_message)))
  FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
  WHERE d.status = 'failed' AND d.start_time > now() - interval '2 hours' GROUP BY j.jobname
  UNION ALL
  SELECT 'chamada_interna:' || coalesce(r.status_code::text, 'sem_resposta'), 'chamada_interna_falhou', 'engenharia_back',
         'Chamadas internas às funções com erro ' || coalesce(r.status_code::text, '(sem resposta)'), 0, count(*)::int,
         jsonb_build_object('janela', '2 horas', 'codigo', r.status_code, 'tempo_esgotado', bool_or(r.timed_out), 'erro', private.scrub(max(r.error_msg)))
  FROM net._http_response r
  WHERE (r.status_code >= 500 OR r.error_msg IS NOT NULL OR r.timed_out) AND r.created > now() - interval '2 hours'
  GROUP BY r.status_code HAVING count(*) >= 3
  UNION ALL
  SELECT 'retorno_falhou', 'retorno_falhou', 'engenharia_back', 'Retornos automáticos (follow-up) falhando', count(DISTINCT organization_id)::int, count(*)::int,
         jsonb_build_object('janela', '24 horas', 'erro', private.scrub(max(error)))
  FROM public.followups WHERE status = 'failed' AND updated_at > now() - interval '24 hours' HAVING count(*) > 0
  UNION ALL
  SELECT 'fluxo_falhou', 'fluxo_falhou', 'engenharia_back', 'Fluxos parando com erro', count(DISTINCT organization_id)::int, count(*)::int,
         jsonb_build_object('janela', '2 horas', 'erro', private.scrub(max(error)))
  FROM public.flow_runs WHERE error IS NOT NULL AND updated_at > now() - interval '2 hours' HAVING count(*) > 0
  UNION ALL
  SELECT 'avaliacao_falhou', 'avaliacao_falhou', 'engenharia_back', 'Avaliação automática dos atendimentos falhando', count(DISTINCT organization_id)::int, count(*)::int,
         jsonb_build_object('janela', '24 horas', 'erro', private.scrub(max(error)))
  FROM public.ticket_reviews WHERE status = 'failed' AND created_at > now() - interval '24 hours' HAVING count(*) > 0
  UNION ALL
  SELECT 'cerebro_falhou', 'cerebro_falhou', 'engenharia_back', 'Análises do cérebro das empresas com erro', count(DISTINCT organization_id)::int, count(*)::int,
         jsonb_build_object('janela', '24 horas', 'erro', private.scrub(max(error)))
  FROM public.brain_runs WHERE status = 'erro' AND started_at > now() - interval '24 hours' HAVING count(*) > 0
  UNION ALL
  SELECT 'documento_falhou', 'documento_falhou', 'engenharia_back', 'Documentos da base de conhecimento que não foram lidos', count(DISTINCT organization_id)::int, count(*)::int,
         jsonb_build_object('janela', '24 horas', 'erro', private.scrub(max(error)))
  FROM public.knowledge_docs WHERE status = 'failed' AND updated_at > now() - interval '24 hours' HAVING count(*) > 0
  UNION ALL
  SELECT 'ia_principal_falhou', 'ia_principal_falhou', 'engenharia_back', 'IA principal da plataforma com erro (a reserva assumiu)', 0, 1,
         jsonb_build_object('janela', '1 hora', 'provedor', provider, 'erro', private.scrub(last_error))
  FROM public.platform_ai_slots WHERE slot = 'principal' AND last_error_at > now() - interval '1 hour'
    AND (last_ok_at IS NULL OR last_ok_at < last_error_at)
  UNION ALL
  SELECT 'inpi_falhou', 'inpi_falhou', 'engenharia_back', 'Leitura da revista do INPI com erro', 0, count(*)::int,
         jsonb_build_object('janela', '24 horas', 'erro', private.scrub(max(error)))
  FROM public.inpi_scans WHERE error IS NOT NULL AND scanned_at > now() - interval '24 hours' HAVING count(*) > 0
  -- Integrações (WhatsApp, Meta, e-mail, conectores, telefonia)
  UNION ALL
  SELECT 'entrada_falhou', 'entrada_falhou', 'integracoes', 'Mensagens recebidas que falharam ao processar', count(DISTINCT organization_id)::int, count(*)::int,
         jsonb_build_object('janela', '2 horas', 'erro', private.scrub(max(error)))
  FROM public.inbound_events WHERE status = 'failed' AND created_at > now() - interval '2 hours' HAVING count(*) > 0
  UNION ALL
  SELECT 'envio_falhou', 'envio_falhou', 'integracoes', 'Mensagens enviadas que falharam', count(DISTINCT organization_id)::int, count(*)::int,
         jsonb_build_object('janela', '2 horas', 'erro', private.scrub(max(error)))
  FROM public.messages WHERE direction = 'outbound' AND status = 'failed' AND created_at > now() - interval '2 hours' HAVING count(*) >= 3
  UNION ALL
  SELECT 'webhook_saida_falhou', 'webhook_saida_falhou', 'integracoes', 'Avisos enviados aos sistemas dos clientes (webhooks) falhando', count(DISTINCT organization_id)::int, count(*)::int,
         jsonb_build_object('janela', '24 horas', 'erro', private.scrub(max(error)))
  FROM public.webhook_deliveries WHERE status = 'failed' AND created_at > now() - interval '24 hours' HAVING count(*) > 0
  UNION ALL
  SELECT 'numero_com_problema', 'numero_com_problema', 'integracoes', 'Números de WhatsApp desconectados ou com problema', count(DISTINCT organization_id)::int, count(*)::int,
         jsonb_build_object('situacao', jsonb_agg(DISTINCT coalesce(status, '-') || '/' || coalesce(health_status, '-')))
  FROM public.whatsapp_instances WHERE status IS DISTINCT FROM 'connected' OR coalesce(health_status, 'ok') NOT IN ('ok') HAVING count(*) > 0
  UNION ALL
  SELECT 'email_com_problema', 'email_com_problema', 'integracoes', 'Caixas de e-mail com problema', count(DISTINCT organization_id)::int, count(*)::int,
         jsonb_build_object('situacao', jsonb_agg(DISTINCT coalesce(health_status, '-')), 'erro', private.scrub(max(health_error)))
  FROM public.email_accounts WHERE status = 'active' AND coalesce(health_status, 'ok') <> 'ok' HAVING count(*) > 0
  UNION ALL
  SELECT 'meta_com_problema', 'meta_com_problema', 'integracoes', 'Páginas do Facebook/Instagram com erro', count(DISTINCT organization_id)::int, count(*)::int,
         jsonb_build_object('erro', private.scrub(max(last_error)))
  FROM public.meta_pages WHERE status = 'error' HAVING count(*) > 0
  UNION ALL
  SELECT 'conector_com_problema', 'conector_com_problema', 'integracoes', 'Conectores (Google, Microsoft…) com erro', count(DISTINCT organization_id)::int, count(*)::int,
         jsonb_build_object('erro', private.scrub(max(error)))
  FROM public.org_connections WHERE status = 'error' HAVING count(*) > 0
  UNION ALL
  SELECT 'telefonia_com_problema', 'telefonia_com_problema', 'integracoes', 'Integração de telefonia com erro', count(DISTINCT organization_id)::int, count(*)::int,
         jsonb_build_object('janela', '24 horas', 'erro', private.scrub(max(last_error)))
  FROM public.voice_integrations WHERE last_error IS NOT NULL AND updated_at > now() - interval '24 hours' HAVING count(*) > 0
  -- Suporte e design
  UNION ALL
  SELECT 'chamado_urgente', 'chamado_urgente', 'suporte', 'Pedidos de ajuda urgentes em aberto', count(DISTINCT organization_id)::int, count(*)::int,
         jsonb_build_object('mais_antigo', min(created_at))
  FROM public.service_requests WHERE status IN ('open', 'in_progress') AND urgency IN ('alta', 'urgente') HAVING count(*) > 0
  UNION ALL
  SELECT 'tela_com_chamados:' || page, 'tela_com_chamados', 'design', 'Tela com muitos pedidos de ajuda: ' || page, count(DISTINCT organization_id)::int, count(*)::int,
         jsonb_build_object('janela', '7 dias', 'tela', page)
  FROM public.service_requests WHERE page IS NOT NULL AND page <> '' AND created_at > now() - interval '7 days' GROUP BY page HAVING count(*) >= 3
  -- Qualidade, custos e segurança
  UNION ALL
  SELECT 'disjuntor', 'disjuntor', 'qualidade', 'A IA de empresas voltou um degrau sozinha (disjuntor)', count(DISTINCT organization_id)::int, count(*)::int,
         jsonb_build_object('janela', '24 horas')
  FROM public.ai_breaker_events WHERE kind = 'stepdown' AND created_at > now() - interval '24 hours' HAVING count(*) > 0
  UNION ALL
  SELECT 'custo_fora_do_normal', 'custo_fora_do_normal', 'custos', 'Uso de IA fora do normal em empresas', count(DISTINCT organization_id)::int, count(*)::int,
         jsonb_build_object('janela', '24 horas')
  FROM public.notifications WHERE kind = 'cost_alert' AND created_at > now() - interval '24 hours' HAVING count(*) > 0
  UNION ALL
  SELECT 'alerta_seguranca', 'alerta_seguranca', 'seguranca', 'Alertas de segurança nas empresas', count(DISTINCT organization_id)::int, count(*)::int,
         jsonb_build_object('janela', '24 horas')
  FROM public.notifications WHERE kind = 'security_alert' AND created_at > now() - interval '24 hours' HAVING count(*) > 0
$$;
REVOKE ALL ON FUNCTION private.platform_signals() FROM PUBLIC, anon, authenticated;

-- Gravidade por regra fixa.
CREATE OR REPLACE FUNCTION private.incident_gravidade(p_kind text, p_empresas int, p_ocorrencias int)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_kind = 'alerta_seguranca' OR (p_kind IN ('entrada_falhou', 'envio_falhou') AND p_empresas >= 3)
      OR (p_kind = 'rotina_falhou' AND p_ocorrencias >= 6) THEN 'critica'
    WHEN p_kind IN ('ia_principal_falhou', 'chamado_urgente', 'disjuntor', 'numero_com_problema', 'entrada_falhou')
      OR p_empresas >= 2 OR p_ocorrencias >= 20 THEN 'alta'
    WHEN p_ocorrencias >= 5 THEN 'media'
    ELSE 'baixa' END
$$;
REVOKE ALL ON FUNCTION private.incident_gravidade(text, int, int) FROM PUBLIC, anon, authenticated;

-- A cada 15 min: sinais → incidentes; aviso à equipe da plataforma (sino; e-mail em alta e crítica); verificação.
CREATE OR REPLACE FUNCTION private.platform_watch_tick()
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s record; v record; cur public.platform_incidents; g text; novos int := 0; rk jsonb := '{"baixa":0,"media":1,"alta":2,"critica":3}';
BEGIN
  FOR s IN SELECT * FROM private.platform_signals() LOOP
    g := private.incident_gravidade(s.kind, s.empresas, s.ocorrencias);
    SELECT * INTO cur FROM public.platform_incidents WHERE fingerprint = s.fp AND status NOT IN ('resolvido', 'ignorado') FOR UPDATE;
    IF cur.id IS NULL THEN
      -- Silenciado pelo operador nos últimos 7 dias: não reabre.
      IF EXISTS (SELECT 1 FROM public.platform_incidents WHERE fingerprint = s.fp AND status = 'ignorado' AND decided_at > now() - interval '7 days') THEN CONTINUE; END IF;
      INSERT INTO public.platform_incidents (fingerprint, kind, equipe, gravidade, titulo, empresas, ocorrencias, pico, evidencia)
      VALUES (s.fp, s.kind, s.equipe, g, left(s.titulo, 200), s.empresas, s.ocorrencias, s.ocorrencias, s.evidencia) RETURNING * INTO cur;
      novos := novos + 1;
      IF g IN ('alta', 'critica') THEN
        PERFORM private.notify_platform_operators('platform_incident', jsonb_build_object('id', cur.id, 'titulo', cur.titulo, 'gravidade', g, 'equipe', s.equipe, 'empresas', s.empresas));
      END IF;
    ELSE
      UPDATE public.platform_incidents
      SET ocorrencias = s.ocorrencias, empresas = s.empresas, pico = greatest(pico, s.ocorrencias), evidencia = s.evidencia,
          gravidade = CASE WHEN (rk ->> g)::int > (rk ->> gravidade)::int THEN g ELSE gravidade END,
          last_seen = now(), updated_at = now()
      WHERE id = cur.id;
      IF (rk ->> g)::int > (rk ->> cur.gravidade)::int AND g IN ('alta', 'critica') THEN
        PERFORM private.notify_platform_operators('platform_incident', jsonb_build_object('id', cur.id, 'titulo', cur.titulo, 'gravidade', g, 'equipe', cur.equipe, 'empresas', s.empresas, 'piorou', true));
      END IF;
    END IF;
  END LOOP;
  -- Verificação: o sinal parou há 6 horas → resolvido. Se havia correção aprovada, avisa que ela foi verificada.
  FOR v IN SELECT id, titulo, status FROM public.platform_incidents
           WHERE status IN ('aberto', 'proposta', 'aprovado') AND last_seen < now() - interval '6 hours' FOR UPDATE LOOP
    UPDATE public.platform_incidents SET status = 'resolvido', resolved_at = now(), updated_at = now() WHERE id = v.id;
    IF v.status = 'aprovado' THEN
      PERFORM private.notify_platform_operators('platform_incident_ok', jsonb_build_object('id', v.id, 'titulo', v.titulo));
    END IF;
  END LOOP;
  RETURN novos;
END $$;
REVOKE ALL ON FUNCTION private.platform_watch_tick() FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'platform-watch';
    PERFORM cron.schedule('platform-watch', '*/15 * * * *', 'SELECT private.platform_watch_tick()');
  END IF;
END $$;

-- Servidor (função platform-brain): grava diagnóstico, proposta e revisão. Revisão reprovada mantém o incidente aberto.
CREATE OR REPLACE FUNCTION public.service_platform_incident_propose(p_id uuid, p_diag jsonb, p_rev jsonb)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE cur public.platform_incidents; st text;
BEGIN
  SELECT * INTO cur FROM public.platform_incidents WHERE id = p_id FOR UPDATE;
  IF cur.id IS NULL THEN RAISE EXCEPTION 'incidente não encontrado' USING ERRCODE = '22023'; END IF;
  IF cur.status IN ('resolvido', 'ignorado', 'aprovado') THEN RAISE EXCEPTION 'este incidente não está esperando diagnóstico' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_diag) <> 'object' OR jsonb_typeof(p_rev) <> 'object' THEN RAISE EXCEPTION 'dados inválidos' USING ERRCODE = '22023'; END IF;
  st := CASE WHEN p_rev ->> 'status' = 'reprovado' THEN 'aberto' ELSE 'proposta' END;
  UPDATE public.platform_incidents
  SET diagnostico = p_diag || jsonb_build_object('at', now()), revisao = p_rev, status = st, updated_at = now()
  WHERE id = p_id;
  RETURN st;
END $$;
REVOKE ALL ON FUNCTION public.service_platform_incident_propose(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_platform_incident_propose(uuid, jsonb, jsonb) TO service_role;

-- Operador: aprovar a correção (só com revisão não reprovada), ignorar por 7 dias, reabrir ou marcar resolvido com o aprendizado.
CREATE OR REPLACE FUNCTION public.platform_incident_decide(p_id uuid, p_decisao text, p_nota text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE cur public.platform_incidents; n text := nullif(left(btrim(coalesce(p_nota, '')), 2000), '');
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO cur FROM public.platform_incidents WHERE id = p_id FOR UPDATE;
  IF cur.id IS NULL THEN RAISE EXCEPTION 'incidente não encontrado' USING ERRCODE = '22023'; END IF;
  IF p_decisao = 'aprovar' THEN
    IF cur.status <> 'proposta' OR coalesce(cur.revisao ->> 'status', 'reprovado') = 'reprovado' THEN
      RAISE EXCEPTION 'só se aprova uma proposta revisada e não reprovada' USING ERRCODE = '22023';
    END IF;
    UPDATE public.platform_incidents SET status = 'aprovado', nota = coalesce(n, nota), decided_by = auth.uid(), decided_at = now(), updated_at = now() WHERE id = p_id;
  ELSIF p_decisao = 'ignorar' THEN
    UPDATE public.platform_incidents SET status = 'ignorado', nota = coalesce(n, nota), decided_by = auth.uid(), decided_at = now(), updated_at = now() WHERE id = p_id;
  ELSIF p_decisao = 'reabrir' THEN
    IF EXISTS (SELECT 1 FROM public.platform_incidents WHERE fingerprint = cur.fingerprint AND id <> p_id AND status NOT IN ('resolvido', 'ignorado')) THEN
      RAISE EXCEPTION 'já existe um incidente aberto igual a este' USING ERRCODE = '22023';
    END IF;
    UPDATE public.platform_incidents SET status = 'aberto', resolved_at = NULL, decided_by = auth.uid(), decided_at = now(), updated_at = now() WHERE id = p_id;
  ELSIF p_decisao = 'resolver' THEN
    IF n IS NULL THEN RAISE EXCEPTION 'conte o que foi feito e o que se aprendeu (vira teste, guia ou artigo)' USING ERRCODE = '22023'; END IF;
    UPDATE public.platform_incidents SET status = 'resolvido', resolved_at = now(), nota = n, decided_by = auth.uid(), decided_at = now(), updated_at = now() WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'decisão inválida' USING ERRCODE = '22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.platform_incident_decide(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_incident_decide(uuid, text, text) TO authenticated;

-- E-mail dos avisos da plataforma: só incidente alta/crítica (o sino recebe todos).
CREATE OR REPLACE FUNCTION private.email_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE base text; secret text;
BEGIN
  IF NEW.kind NOT IN ('number_health', 'email_health', 'security_alert', 'brain_weekly', 'brain_goal', 'brain_reminder',
                      'support_ticket', 'support_received', 'support_status',
                      'breaker_stepdown', 'cost_alert', 'platform_incident') THEN RETURN NULL; END IF;
  IF NEW.kind = 'platform_incident' AND coalesce(NEW.ref ->> 'gravidade', '') NOT IN ('alta', 'critica') THEN RETURN NULL; END IF;
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
