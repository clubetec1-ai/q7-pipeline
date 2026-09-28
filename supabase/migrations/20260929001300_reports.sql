-- =============================================================================
-- Relatórios (pedido em 29/09)
--  * report(org, kind, since, until, dept): um relatório por tipo, calculado no
--    banco, com o escopo decidido aqui (nunca pelo navegador):
--      dono/admin/view_all → tudo; supervisor (reports.view) → setores dele;
--      atendente → só os próprios números, e só em 'atendentes' e 'qualidade'.
--  * kinds: atendentes, operacao, qualidade, melhorias, comercial, ia.
--  * log_report_export: exportação fica na auditoria.
-- Idempotente.
-- =============================================================================

-- Escopo de quem pede: 'all' | 'dept' | 'self' | NULL (sem acesso).
CREATE OR REPLACE FUNCTION private.report_scope(org uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN private.has_permission(org, 'org.settings') OR private.has_permission(org, 'conversations.view_all') THEN 'all'
    WHEN private.has_permission(org, 'reports.view') THEN 'dept'
    WHEN private.has_permission(org, 'conversations.attend') THEN 'self'
  END
$$;
REVOKE ALL ON FUNCTION private.report_scope(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.report(org uuid, kind text, since timestamptz, until timestamptz, dept uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  scope text := private.report_scope(org);
  uid uuid := auth.uid();
  mine uuid[];
  depts uuid[];      -- NULL = todos
  s timestamptz := least(since, until);
  u timestamptz := greatest(since, until);
  out jsonb;
BEGIN
  IF scope IS NULL THEN RAISE EXCEPTION 'sem acesso' USING ERRCODE = '42501'; END IF;
  IF u - s > interval '366 days' THEN s := u - interval '366 days'; END IF;
  IF scope = 'self' AND kind NOT IN ('atendentes', 'qualidade') THEN
    RAISE EXCEPTION 'relatório disponível para gestores e supervisores' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(array_agg(department_id), '{}') INTO mine FROM public.department_members
  WHERE user_id = uid AND organization_id = org;
  depts := CASE
    WHEN scope = 'all' AND dept IS NULL THEN NULL
    WHEN scope = 'all' THEN ARRAY[dept]
    WHEN scope = 'dept' AND dept IS NOT NULL AND dept = ANY (mine) THEN ARRAY[dept]
    WHEN scope = 'dept' THEN mine
    ELSE NULL END;

  IF kind = 'atendentes' THEN
    WITH t AS (
      SELECT * FROM public.tickets x
      WHERE x.organization_id = org AND x.closed_at >= s AND x.closed_at <= u AND x.assigned_to IS NOT NULL
        AND (depts IS NULL OR x.department_id = ANY (depts)) AND (scope <> 'self' OR x.assigned_to = uid)
    ), r AS (
      SELECT * FROM public.ticket_reviews y
      WHERE y.organization_id = org AND y.status = 'done' AND y.reviewed_at >= s AND y.reviewed_at <= u AND y.agent_id IS NOT NULL
        AND (depts IS NULL OR y.department_id = ANY (depts)) AND (scope <> 'self' OR y.agent_id = uid)
    ), who AS (SELECT assigned_to AS id FROM t UNION SELECT agent_id FROM r)
    SELECT jsonb_build_object('linhas', coalesce(jsonb_agg(jsonb_build_object(
      'user_id', who.id,
      'nome', coalesce((SELECT nullif(m.display_name, '') FROM public.organization_members m WHERE m.organization_id = org AND m.user_id = who.id), 'Sem nome'),
      'finalizados', (SELECT count(*) FROM t WHERE t.assigned_to = who.id),
      'resposta_min', (SELECT round(avg(extract(epoch FROM (t.first_response_at - t.opened_at)) / 60)::numeric, 1) FROM t WHERE t.assigned_to = who.id AND t.first_response_at IS NOT NULL AND t.opened_at IS NOT NULL),
      'duracao_min', (SELECT round(avg(extract(epoch FROM (t.closed_at - coalesce(t.opened_at, t.created_at))) / 60)::numeric, 1) FROM t WHERE t.assigned_to = who.id),
      'avaliados', (SELECT count(*) FROM r WHERE r.agent_id = who.id),
      'nota', (SELECT round(avg(r.score)::numeric, 1) FROM r WHERE r.agent_id = who.id),
      'satisfeitos_pct', (SELECT round(100.0 * count(*) FILTER (WHERE r.satisfied = 'sim') / nullif(count(*), 0)) FROM r WHERE r.agent_id = who.id)
    ) ORDER BY who.id), '[]'::jsonb)) INTO out FROM who;

  ELSIF kind = 'operacao' THEN
    WITH t AS (
      SELECT * FROM public.tickets x
      WHERE x.organization_id = org AND x.created_at >= s AND x.created_at <= u AND (depts IS NULL OR x.department_id = ANY (depts))
    ), ev AS (
      SELECT e.type FROM public.ticket_events e JOIN t ON t.id = e.ticket_id
      WHERE e.organization_id = org AND e.created_at >= s AND e.created_at <= u
    )
    SELECT jsonb_build_object(
      'resumo', jsonb_build_object(
        'atendimentos', (SELECT count(*) FROM t),
        'finalizados', (SELECT count(*) FROM t WHERE t.status = 'closed'),
        'fila_min', (SELECT round(avg(extract(epoch FROM (t.opened_at - t.queued_at)) / 60)::numeric, 1) FROM t WHERE t.queued_at IS NOT NULL AND t.opened_at IS NOT NULL),
        'fila_max_min', (SELECT round(max(extract(epoch FROM (t.opened_at - t.queued_at)) / 60)::numeric, 1) FROM t WHERE t.queued_at IS NOT NULL AND t.opened_at IS NOT NULL),
        'resposta_min', (SELECT round(avg(extract(epoch FROM (t.first_response_at - t.opened_at)) / 60)::numeric, 1) FROM t WHERE t.first_response_at IS NOT NULL AND t.opened_at IS NOT NULL),
        'transferencias', (SELECT count(*) FROM ev WHERE ev.type = 'transferred'),
        'transbordos', (SELECT count(*) FROM ev WHERE ev.type = 'overflow'),
        'so_ia', (SELECT count(*) FROM t WHERE t.status = 'closed' AND t.assigned_to IS NULL)),
      'por_setor', (SELECT coalesce(jsonb_agg(jsonb_build_object('setor', coalesce(d.name, 'Fila geral'), 'atendimentos', x.n, 'fila_min', x.fila) ORDER BY x.n DESC), '[]'::jsonb)
        FROM (SELECT t.department_id, count(*) n,
                     round(avg(extract(epoch FROM (t.opened_at - t.queued_at)) / 60) FILTER (WHERE t.queued_at IS NOT NULL AND t.opened_at IS NOT NULL)::numeric, 1) fila
              FROM t GROUP BY t.department_id) x
        LEFT JOIN public.departments d ON d.id = x.department_id),
      'por_hora', (SELECT jsonb_agg(coalesce((SELECT count(*) FROM t WHERE extract(hour FROM t.created_at AT TIME ZONE 'America/Sao_Paulo') = h), 0) ORDER BY h)
        FROM generate_series(0, 23) h),
      'por_dia_semana', (SELECT jsonb_agg(coalesce((SELECT count(*) FROM t WHERE extract(dow FROM t.created_at AT TIME ZONE 'America/Sao_Paulo') = dw), 0) ORDER BY dw)
        FROM generate_series(0, 6) dw),
      'motivos', (SELECT coalesce(jsonb_agg(jsonb_build_object('motivo', coalesce(cr.name, 'Sem motivo'), 'n', x.n) ORDER BY x.n DESC), '[]'::jsonb)
        FROM (SELECT t.close_reason_id, count(*) n FROM t WHERE t.status = 'closed' GROUP BY 1) x
        LEFT JOIN public.close_reasons cr ON cr.id = x.close_reason_id)
    ) INTO out;

  ELSIF kind = 'qualidade' THEN
    WITH r AS (
      SELECT * FROM public.ticket_reviews y
      WHERE y.organization_id = org AND y.status = 'done' AND y.reviewed_at >= s AND y.reviewed_at <= u
        AND (depts IS NULL OR y.department_id = ANY (depts)) AND (scope <> 'self' OR y.agent_id = uid)
    )
    SELECT jsonb_build_object(
      'resumo', jsonb_build_object(
        'avaliados', (SELECT count(*) FROM r),
        'satisfeitos_pct', (SELECT round(100.0 * count(*) FILTER (WHERE r.satisfied = 'sim') / nullif(count(*), 0)) FROM r),
        'insatisfeitos', (SELECT count(*) FROM r WHERE r.satisfied = 'nao'),
        'nota', (SELECT round(avg(r.score)::numeric, 1) FROM r)),
      'por_setor', (SELECT coalesce(jsonb_agg(jsonb_build_object('setor', coalesce(d.name, 'Sem setor'), 'avaliados', x.n, 'nota', x.nota, 'satisfeitos_pct', x.sat) ORDER BY x.n DESC), '[]'::jsonb)
        FROM (SELECT r.department_id, count(*) n, round(avg(r.score)::numeric, 1) nota,
                     round(100.0 * count(*) FILTER (WHERE r.satisfied = 'sim') / nullif(count(*), 0)) sat FROM r GROUP BY 1) x
        LEFT JOIN public.departments d ON d.id = x.department_id),
      'motivos_insatisfacao', (SELECT coalesce(jsonb_agg(jsonb_build_object('motivo', x.reason, 'n', x.n) ORDER BY x.n DESC), '[]'::jsonb)
        FROM (SELECT left(r.reason, 160) reason, count(*) n FROM r WHERE r.satisfied = 'nao' AND coalesce(r.reason, '') <> '' GROUP BY 1 ORDER BY 2 DESC LIMIT 10) x),
      'falhas_processo', (SELECT coalesce(jsonb_agg(jsonb_build_object('falha', x.falha, 'n', x.n) ORDER BY x.n DESC), '[]'::jsonb)
        FROM (SELECT left(f ->> 'falha', 160) falha, count(*) n FROM r, jsonb_array_elements(r.process_issues) f
              WHERE coalesce(f ->> 'falha', '') <> '' GROUP BY 1 ORDER BY 2 DESC LIMIT 10) x)
    ) INTO out;

  ELSIF kind = 'melhorias' THEN
    WITH i AS (
      SELECT * FROM public.improvements y
      WHERE y.organization_id = org AND y.created_at <= u AND coalesce(y.closed_at, u) >= s
        AND (depts IS NULL OR y.department_id IS NULL OR y.department_id = ANY (depts))
    )
    SELECT jsonb_build_object(
      'resumo', jsonb_build_object(
        'sugeridas', (SELECT count(*) FROM i WHERE i.status = 'sugerida'),
        'aprovadas', (SELECT count(*) FROM i WHERE i.status = 'aprovada'),
        'no_ar', (SELECT count(*) FROM i WHERE i.status = 'no_ar'),
        'funcionou', (SELECT count(*) FROM i WHERE i.result = 'funcionou'),
        'nao_funcionou', (SELECT count(*) FROM i WHERE i.result = 'nao_funcionou'),
        'inconclusivo', (SELECT count(*) FROM i WHERE i.result = 'inconclusivo'),
        'correcoes', (SELECT count(*) FROM i WHERE i.source = 'monitor'),
        'dias_ate_aprovar', (SELECT round(avg(extract(epoch FROM (i.approved_at - i.created_at)) / 86400)::numeric, 1) FROM i WHERE i.approved_at IS NOT NULL)),
      'por_origem', (SELECT coalesce(jsonb_object_agg(x.source, x.n), '{}'::jsonb) FROM (SELECT source, count(*) n FROM i GROUP BY 1) x),
      'resultados', (SELECT coalesce(jsonb_agg(jsonb_build_object('titulo', i.title, 'resultado', i.result, 'versao', i.version, 'nota', i.result_note) ORDER BY i.closed_at DESC), '[]'::jsonb)
        FROM i WHERE i.status = 'resultado')
    ) INTO out;

  ELSIF kind = 'comercial' THEN
    SELECT jsonb_build_object(
      'funil', (SELECT coalesce(jsonb_agg(jsonb_build_object('etapa', p.name, 'cor', p.color, 'n',
                  (SELECT count(*) FROM public.conversations c WHERE c.organization_id = org AND c.stage_id = p.id
                     AND (depts IS NULL OR c.department_id = ANY (depts)))) ORDER BY p.position), '[]'::jsonb)
                FROM public.pipeline_stages p WHERE p.organization_id = org),
      'novos_contatos', (SELECT count(*) FROM public.contacts c WHERE c.organization_id = org AND c.created_at >= s AND c.created_at <= u),
      'campanhas', (SELECT jsonb_build_object('campanhas', count(*), 'enviados', coalesce(sum(sent), 0), 'falhas', coalesce(sum(failed), 0), 'fora_da_lista', coalesce(sum(skipped), 0))
                    FROM public.campaigns c WHERE c.organization_id = org AND c.started_at >= s AND c.started_at <= u),
      'cobrancas', (SELECT jsonb_build_object(
                      'emitidas', count(*) FILTER (WHERE c.created_at >= s AND c.created_at <= u),
                      'valor_emitido', coalesce(sum(c.value) FILTER (WHERE c.created_at >= s AND c.created_at <= u), 0),
                      'pagas', count(*) FILTER (WHERE c.paid_at >= s AND c.paid_at <= u),
                      'valor_recebido', coalesce(sum(c.value) FILTER (WHERE c.paid_at >= s AND c.paid_at <= u), 0),
                      'em_atraso', count(*) FILTER (WHERE c.status = 'overdue'),
                      'valor_em_atraso', coalesce(sum(c.value) FILTER (WHERE c.status = 'overdue'), 0))
                    FROM public.charges c WHERE c.organization_id = org)
    ) INTO out;

  ELSIF kind = 'ia' THEN
    WITH t AS (
      SELECT * FROM public.tickets x
      WHERE x.organization_id = org AND x.created_at >= s AND x.created_at <= u AND (depts IS NULL OR x.department_id = ANY (depts))
    )
    SELECT jsonb_build_object(
      'atendimentos', (SELECT count(*) FROM t),
      'resolvidos_pela_ia', (SELECT count(*) FROM t WHERE t.status = 'closed' AND t.assigned_to IS NULL AND NOT t.external_reply),
      'passaram_para_humano', (SELECT count(*) FROM t WHERE t.assigned_to IS NOT NULL OR t.external_reply),
      'respostas_da_ia', (SELECT count(*) FROM public.messages m WHERE m.organization_id = org AND m.sender = 'ai' AND m.created_at >= s AND m.created_at <= u),
      'midias_lidas', (SELECT count(*) FROM public.messages m WHERE m.organization_id = org AND m.media_text IS NOT NULL AND m.created_at >= s AND m.created_at <= u),
      'fluxos', (SELECT jsonb_build_object('execucoes', count(*), 'concluidas_pct', round(100.0 * count(*) FILTER (WHERE fr.finished_at IS NOT NULL) / nullif(count(*), 0)))
                 FROM public.flow_runs fr WHERE fr.organization_id = org AND fr.started_at >= s AND fr.started_at <= u),
      'base_documentos', (SELECT count(*) FROM public.knowledge_docs k WHERE k.organization_id = org AND k.status = 'ready'),
      'avaliacoes_automaticas', (SELECT count(*) FROM public.ticket_reviews r WHERE r.organization_id = org AND r.status = 'done' AND r.reviewed_at >= s AND r.reviewed_at <= u)
    ) INTO out;
  ELSE
    RAISE EXCEPTION 'relatório desconhecido' USING ERRCODE = '22023';
  END IF;

  RETURN coalesce(out, '{}'::jsonb) || jsonb_build_object('escopo', scope, 'de', s, 'ate', u);
END $$;
REVOKE ALL ON FUNCTION public.report(uuid, text, timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report(uuid, text, timestamptz, timestamptz, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.log_report_export(org uuid, kind text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF private.report_scope(org) IS NULL THEN RAISE EXCEPTION 'sem acesso' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.audit_log (organization_id, actor_id, action, target, meta)
  VALUES (org, auth.uid(), 'report.export', left(kind, 40), '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.log_report_export(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_report_export(uuid, text) TO authenticated;
