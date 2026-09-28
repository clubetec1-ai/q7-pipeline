-- =============================================================================
-- Ciclo de melhoria contínua (pedido em 28/09)
--  * improvements: cada melhoria é um item com estado
--    sugerida → aprovada → no_ar → resultado (ou descartada).
--  * Origens: planejamento do diagnóstico, avaliações dos atendimentos, monitor
--    (correção de uma melhoria que não funcionou) ou manual.
--  * Quem aprova: dono/admin (org.settings) ou o supervisor do setor da melhoria
--    (reports.view + membro do departamento). Nada entra no ar sozinho.
--  * No ar: guarda as métricas de antes; o monitor diário fecha a medição depois
--    de measure_days, compara antes × depois e, se não funcionou, cria a correção
--    (nova versão) para aprovar e avisa quem aprova.
--  * Navegador só lê; tudo muda por RPC com auditoria.
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.improvements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 160),
  description text CHECK (description IS NULL OR char_length(description) <= 2000),
  how text CHECK (how IS NULL OR char_length(how) <= 4000),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('plano', 'avaliacoes', 'monitor', 'manual')),
  kind text NOT NULL DEFAULT 'processo' CHECK (kind IN ('automacao', 'agente', 'processo', 'integracao')),
  modelo text CHECK (modelo IS NULL OR modelo ~ '^[a-z_]{2,30}$'),
  sistema text CHECK (sistema IS NULL OR char_length(sistema) <= 80),
  department_id uuid,
  status text NOT NULL DEFAULT 'sugerida' CHECK (status IN ('sugerida', 'aprovada', 'no_ar', 'resultado', 'descartada')),
  artifact_kind text CHECK (artifact_kind IS NULL OR artifact_kind IN ('flow', 'record_type')),
  artifact_id uuid,
  parent_id uuid REFERENCES public.improvements(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  measure_days integer NOT NULL DEFAULT 14 CHECK (measure_days BETWEEN 7 AND 60),
  approved_by uuid, approved_at timestamptz, live_at timestamptz, closed_at timestamptz,
  metrics_before jsonb, metrics_after jsonb,
  result text CHECK (result IS NULL OR result IN ('funcionou', 'nao_funcionou', 'inconclusivo')),
  result_note text CHECK (result_note IS NULL OR char_length(result_note) <= 2000),
  discard_reason text CHECK (discard_reason IS NULL OR char_length(discard_reason) <= 500),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  CONSTRAINT improvements_department_fk FOREIGN KEY (department_id, organization_id)
    REFERENCES public.departments (id, organization_id) ON DELETE SET NULL (department_id)
);
CREATE INDEX IF NOT EXISTS improvements_org_idx ON public.improvements (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS improvements_live_idx ON public.improvements (live_at) WHERE status = 'no_ar';

ALTER TABLE public.improvements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.improvements FROM anon, authenticated;
GRANT SELECT ON public.improvements TO authenticated;
DROP POLICY IF EXISTS "org: ver" ON public.improvements;
CREATE POLICY "org: ver" ON public.improvements FOR SELECT TO authenticated USING (
  private.has_permission(organization_id, 'org.settings')
  OR (private.has_permission(organization_id, 'reports.view')
      AND (department_id IS NULL OR private.has_permission(organization_id, 'conversations.view_all')
           OR private.in_department(department_id))));

-- Quem pode aprovar / colocar no ar / descartar esta melhoria.
CREATE OR REPLACE FUNCTION private.can_approve_improvement(i public.improvements)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.has_permission(i.organization_id, 'org.settings')
      OR (i.department_id IS NOT NULL AND private.has_permission(i.organization_id, 'reports.view')
          AND private.in_department(i.department_id))
$$;
REVOKE ALL ON FUNCTION private.can_approve_improvement(public.improvements) FROM PUBLIC, anon, authenticated;

-- Métricas de um período (empresa inteira ou só o setor; + execuções do fluxo).
CREATE OR REPLACE FUNCTION private.improvement_metrics(org uuid, dept uuid, flow uuid, since timestamptz, until timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'dias', greatest(1, round(extract(epoch FROM (until - since)) / 86400)),
    'atendimentos', (SELECT count(*) FROM public.tickets t WHERE t.organization_id = org
                       AND t.created_at >= since AND t.created_at <= until AND (dept IS NULL OR t.department_id = dept)),
    'fila_min', (SELECT round(avg(extract(epoch FROM (t.opened_at - t.queued_at)) / 60)::numeric, 1) FROM public.tickets t
                   WHERE t.organization_id = org AND t.created_at >= since AND t.created_at <= until
                     AND t.queued_at IS NOT NULL AND t.opened_at IS NOT NULL AND (dept IS NULL OR t.department_id = dept)),
    'resposta_min', (SELECT round(avg(extract(epoch FROM (t.first_response_at - t.opened_at)) / 60)::numeric, 1) FROM public.tickets t
                   WHERE t.organization_id = org AND t.created_at >= since AND t.created_at <= until
                     AND t.first_response_at IS NOT NULL AND t.opened_at IS NOT NULL AND (dept IS NULL OR t.department_id = dept)),
    'avaliados', (SELECT count(*) FROM public.ticket_reviews r WHERE r.organization_id = org AND r.status = 'done'
                    AND r.reviewed_at >= since AND r.reviewed_at <= until AND (dept IS NULL OR r.department_id = dept)),
    'satisfeitos_pct', (SELECT round(100.0 * count(*) FILTER (WHERE r.satisfied = 'sim') / nullif(count(*), 0))
                   FROM public.ticket_reviews r WHERE r.organization_id = org AND r.status = 'done'
                    AND r.reviewed_at >= since AND r.reviewed_at <= until AND (dept IS NULL OR r.department_id = dept)),
    'nota_media', (SELECT round(avg(r.score)::numeric, 1) FROM public.ticket_reviews r WHERE r.organization_id = org AND r.status = 'done'
                    AND r.reviewed_at >= since AND r.reviewed_at <= until AND (dept IS NULL OR r.department_id = dept)),
    'fluxo_execucoes', CASE WHEN flow IS NULL THEN NULL ELSE (SELECT count(*) FROM public.flow_runs fr
                    JOIN public.flow_versions v ON v.id = fr.flow_version_id AND v.organization_id = org
                    WHERE fr.organization_id = org AND v.flow_id = flow AND fr.started_at >= since AND fr.started_at <= until) END,
    'fluxo_concluidas_pct', CASE WHEN flow IS NULL THEN NULL ELSE (SELECT round(100.0 * count(*) FILTER (WHERE fr.finished_at IS NOT NULL) / nullif(count(*), 0))
                    FROM public.flow_runs fr JOIN public.flow_versions v ON v.id = fr.flow_version_id AND v.organization_id = org
                    WHERE fr.organization_id = org AND v.flow_id = flow AND fr.started_at >= since AND fr.started_at <= until) END))
$$;
REVOKE ALL ON FUNCTION private.improvement_metrics(uuid, uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

-- Avisa quem aprova (dono/admin + supervisores do setor).
CREATE OR REPLACE FUNCTION private.notify_improvement(i public.improvements)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.notifications (organization_id, user_id, kind, ref)
  SELECT DISTINCT i.organization_id, m.user_id, 'improvement',
         jsonb_build_object('improvement_id', i.id, 'title', left(i.title, 120), 'source', i.source)
  FROM public.organization_members m
  WHERE m.organization_id = i.organization_id AND m.status = 'active'
    AND (m.role IN ('owner', 'admin')
         OR (m.role = 'supervisor' AND i.department_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.department_members dm WHERE dm.department_id = i.department_id AND dm.user_id = m.user_id)))
$$;
REVOKE ALL ON FUNCTION private.notify_improvement(public.improvements) FROM PUBLIC, anon, authenticated;

-- Criar melhoria manual (dono/admin ou supervisão).
CREATE OR REPLACE FUNCTION public.create_improvement(org uuid, title text, description text, how text, kind text, department uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE nid uuid;
BEGIN
  IF NOT (private.has_permission(org, 'org.settings') OR private.has_permission(org, 'reports.view')) THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.improvements (organization_id, title, description, how, kind, department_id, source, created_by)
  VALUES (org, btrim(title), nullif(btrim(description), ''), nullif(btrim(how), ''), coalesce(kind, 'processo'), department, 'manual', auth.uid())
  RETURNING id INTO nid;
  RETURN nid;
END $$;

CREATE OR REPLACE FUNCTION public.approve_improvement(improvement uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.improvements;
BEGIN
  SELECT * INTO i FROM public.improvements WHERE id = improvement FOR UPDATE;
  IF i.id IS NULL OR NOT private.can_approve_improvement(i) THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF i.status <> 'sugerida' THEN RAISE EXCEPTION 'esta melhoria não está aguardando aprovação' USING ERRCODE = '22023'; END IF;
  UPDATE public.improvements SET status = 'aprovada', approved_by = auth.uid(), approved_at = now(), updated_at = now() WHERE id = i.id;
  PERFORM private.audit(i.organization_id, 'improvement.approved', i.id::text, jsonb_build_object('title', i.title));
END $$;

-- Liga o rascunho instalado pelo implementador à melhoria (só da própria org).
CREATE OR REPLACE FUNCTION public.link_improvement_artifact(improvement uuid, akind text, aid uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.improvements;
BEGIN
  SELECT * INTO i FROM public.improvements WHERE id = improvement FOR UPDATE;
  IF i.id IS NULL OR NOT private.has_permission(i.organization_id, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF NOT ((akind = 'flow' AND EXISTS (SELECT 1 FROM public.flows f WHERE f.id = aid AND f.organization_id = i.organization_id))
       OR (akind = 'record_type' AND EXISTS (SELECT 1 FROM public.record_types r WHERE r.id = aid AND r.organization_id = i.organization_id))) THEN
    RAISE EXCEPTION 'item inválido' USING ERRCODE = '42501';
  END IF;
  UPDATE public.improvements SET artifact_kind = akind, artifact_id = aid, updated_at = now() WHERE id = i.id;
END $$;

-- Colocar no ar: guarda as métricas de antes. Fluxo precisa estar publicado.
CREATE OR REPLACE FUNCTION public.set_improvement_live(improvement uuid, days integer DEFAULT 14)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.improvements; d integer := least(greatest(coalesce(days, 14), 7), 60);
BEGIN
  SELECT * INTO i FROM public.improvements WHERE id = improvement FOR UPDATE;
  IF i.id IS NULL OR NOT private.can_approve_improvement(i) THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF i.status <> 'aprovada' THEN RAISE EXCEPTION 'aprove a melhoria antes de colocar no ar' USING ERRCODE = '22023'; END IF;
  IF i.artifact_kind = 'flow' AND NOT EXISTS (SELECT 1 FROM public.flow_versions v WHERE v.flow_id = i.artifact_id AND v.status = 'published') THEN
    RAISE EXCEPTION 'publique o fluxo (Fluxos → abrir → Publicar) antes de colocar no ar' USING ERRCODE = '22023';
  END IF;
  UPDATE public.improvements SET status = 'no_ar', live_at = now(), measure_days = d, updated_at = now(),
    metrics_before = private.improvement_metrics(i.organization_id, i.department_id,
      CASE WHEN i.artifact_kind = 'flow' THEN i.artifact_id END, now() - make_interval(days => d), now())
  WHERE id = i.id;
  PERFORM private.audit(i.organization_id, 'improvement.live', i.id::text, jsonb_build_object('dias', d));
END $$;

CREATE OR REPLACE FUNCTION public.discard_improvement(improvement uuid, reason text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.improvements;
BEGIN
  SELECT * INTO i FROM public.improvements WHERE id = improvement FOR UPDATE;
  IF i.id IS NULL OR NOT private.can_approve_improvement(i) THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF i.status NOT IN ('sugerida', 'aprovada') THEN RAISE EXCEPTION 'só dá para descartar antes de ir ao ar' USING ERRCODE = '22023'; END IF;
  UPDATE public.improvements SET status = 'descartada', discard_reason = left(nullif(btrim(reason), ''), 500), closed_at = now(), updated_at = now() WHERE id = i.id;
  PERFORM private.audit(i.organization_id, 'improvement.discarded', i.id::text, '{}'::jsonb);
END $$;

-- Encerrar a medição agora (sem esperar o prazo), para quem aprova.
CREATE OR REPLACE FUNCTION public.close_improvement_now(improvement uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.improvements;
BEGIN
  SELECT * INTO i FROM public.improvements WHERE id = improvement;
  IF i.id IS NULL OR NOT private.can_approve_improvement(i) THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF i.status <> 'no_ar' THEN RAISE EXCEPTION 'a melhoria não está no ar' USING ERRCODE = '22023'; END IF;
  PERFORM private.evaluate_improvement(i.id);
END $$;

-- Compara antes × depois e decide. Não funcionou → correção sugerida (nova versão).
CREATE OR REPLACE FUNCTION private.evaluate_improvement(improvement uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  i public.improvements; b jsonb; a jsonb; better int := 0; worse int := 0; res text; note text; fix public.improvements;
BEGIN
  SELECT * INTO i FROM public.improvements WHERE id = improvement FOR UPDATE;
  IF i.id IS NULL OR i.status <> 'no_ar' THEN RETURN; END IF;
  b := coalesce(i.metrics_before, '{}'::jsonb);
  a := private.improvement_metrics(i.organization_id, i.department_id,
         CASE WHEN i.artifact_kind = 'flow' THEN i.artifact_id END, i.live_at, now());
  -- Sinais: satisfação e nota sobem; fila e resposta caem (mudanças relevantes).
  IF (a ? 'satisfeitos_pct') AND (b ? 'satisfeitos_pct') THEN
    IF (a->>'satisfeitos_pct')::numeric - (b->>'satisfeitos_pct')::numeric >= 5 THEN better := better + 1;
    ELSIF (b->>'satisfeitos_pct')::numeric - (a->>'satisfeitos_pct')::numeric >= 5 THEN worse := worse + 1; END IF;
  END IF;
  IF (a ? 'nota_media') AND (b ? 'nota_media') THEN
    IF (a->>'nota_media')::numeric - (b->>'nota_media')::numeric >= 0.5 THEN better := better + 1;
    ELSIF (b->>'nota_media')::numeric - (a->>'nota_media')::numeric >= 0.5 THEN worse := worse + 1; END IF;
  END IF;
  IF (a ? 'fila_min') AND (b ? 'fila_min') AND (b->>'fila_min')::numeric > 0 THEN
    IF (a->>'fila_min')::numeric <= (b->>'fila_min')::numeric * 0.8 THEN better := better + 1;
    ELSIF (a->>'fila_min')::numeric >= (b->>'fila_min')::numeric * 1.2 THEN worse := worse + 1; END IF;
  END IF;
  IF (a ? 'resposta_min') AND (b ? 'resposta_min') AND (b->>'resposta_min')::numeric > 0 THEN
    IF (a->>'resposta_min')::numeric <= (b->>'resposta_min')::numeric * 0.8 THEN better := better + 1;
    ELSIF (a->>'resposta_min')::numeric >= (b->>'resposta_min')::numeric * 1.2 THEN worse := worse + 1; END IF;
  END IF;
  IF coalesce((a->>'atendimentos')::int, 0) < 10 THEN
    res := 'inconclusivo'; note := 'Poucos atendimentos no período para concluir. Deixe rodar mais tempo ou encerre manualmente.';
  ELSIF better > worse THEN
    res := 'funcionou'; note := format('Melhorou em %s indicador(es) e piorou em %s.', better, worse);
  ELSIF worse > better THEN
    res := 'nao_funcionou'; note := format('Piorou em %s indicador(es) e melhorou em %s. Uma correção foi sugerida.', worse, better);
  ELSE
    res := 'inconclusivo'; note := 'Sem mudança clara nos indicadores.';
  END IF;
  UPDATE public.improvements SET status = 'resultado', metrics_after = a, result = res, result_note = note,
    closed_at = now(), updated_at = now() WHERE id = i.id;
  PERFORM private.audit(i.organization_id, 'improvement.result', i.id::text, jsonb_build_object('result', res));
  IF res = 'nao_funcionou' THEN
    INSERT INTO public.improvements (organization_id, title, description, how, source, kind, modelo, sistema, department_id,
                                     artifact_kind, artifact_id, parent_id, version)
    VALUES (i.organization_id, left('Ajustar: ' || i.title, 160),
            left(format('A versão %s não trouxe o resultado esperado (antes: %s · depois: %s). Revise e ajuste antes de colocar no ar de novo.',
                        i.version, b::text, a::text), 2000),
            i.how, 'monitor', i.kind, i.modelo, i.sistema, i.department_id, i.artifact_kind, i.artifact_id, i.id, i.version + 1)
    RETURNING * INTO fix;
    PERFORM private.notify_improvement(fix);
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.evaluate_improvement(uuid) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.create_improvement(uuid, text, text, text, text, uuid), public.approve_improvement(uuid),
  public.link_improvement_artifact(uuid, text, uuid), public.set_improvement_live(uuid, integer),
  public.discard_improvement(uuid, text), public.close_improvement_now(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_improvement(uuid, text, text, text, text, uuid), public.approve_improvement(uuid),
  public.link_improvement_artifact(uuid, text, uuid), public.set_improvement_live(uuid, integer),
  public.discard_improvement(uuid, text), public.close_improvement_now(uuid) TO authenticated;

-- Backend grava melhorias vindas do planejamento e das avaliações (e avisa quem aprova).
CREATE OR REPLACE FUNCTION public.service_add_improvements(org uuid, src text, items jsonb, replace_suggested boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE x jsonb; n integer := 0; rec public.improvements; dept uuid;
BEGIN
  IF src NOT IN ('plano', 'avaliacoes') THEN RAISE EXCEPTION 'origem inválida'; END IF;
  IF replace_suggested THEN
    DELETE FROM public.improvements WHERE organization_id = org AND source = src AND status = 'sugerida';
  END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(coalesce(items, '[]'::jsonb)) LIMIT 30 LOOP
    CONTINUE WHEN coalesce(btrim(x->>'title'), '') = '';
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.improvements WHERE organization_id = org AND status IN ('sugerida', 'aprovada', 'no_ar')
                           AND lower(title) = lower(left(btrim(x->>'title'), 160)));
    SELECT id INTO dept FROM public.departments WHERE organization_id = org AND coalesce(x->>'setor', '') <> ''
      AND lower(name) = lower(btrim(x->>'setor')) LIMIT 1;
    INSERT INTO public.improvements (organization_id, title, description, how, source, kind, modelo, sistema, department_id)
    VALUES (org, left(btrim(x->>'title'), 160), left(x->>'description', 2000), left(x->>'how', 4000), src,
            CASE WHEN x->>'kind' IN ('automacao', 'agente', 'processo', 'integracao') THEN x->>'kind' ELSE 'processo' END,
            CASE WHEN x->>'modelo' ~ '^[a-z_]{2,30}$' THEN x->>'modelo' END, left(x->>'sistema', 80), dept)
    RETURNING * INTO rec;
    IF src = 'avaliacoes' THEN PERFORM private.notify_improvement(rec); END IF;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.service_add_improvements(uuid, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_add_improvements(uuid, text, jsonb, boolean) TO service_role;

-- Monitor diário: fecha a medição das melhorias que já passaram do prazo.
CREATE OR REPLACE FUNCTION private.improvements_tick()
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT id FROM public.improvements
           WHERE status = 'no_ar' AND live_at + make_interval(days => measure_days) <= now() LIMIT 200 LOOP
    PERFORM private.evaluate_improvement(r.id);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION private.improvements_tick() FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'improvements-monitor') THEN PERFORM cron.unschedule('improvements-monitor'); END IF;
  PERFORM cron.schedule('improvements-monitor', '0 11 * * *', 'SELECT private.improvements_tick()');
END $$;
