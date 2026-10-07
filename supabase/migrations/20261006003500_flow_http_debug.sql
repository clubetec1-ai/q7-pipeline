-- Etapa B, item 6: modo depuração do bloco HTTP dos fluxos. O dono liga por 1 hora no editor do fluxo; enquanto ligado,
-- cada chamada do bloco HTTP guarda o resultado (situação, tempo, erro e o começo da resposta, sem dados pessoais) para
-- ver o que o outro sistema devolveu. Tudo some 1 hora depois. Idempotente.
ALTER TABLE public.flows ADD COLUMN IF NOT EXISTS http_debug_until timestamptz;

CREATE TABLE IF NOT EXISTS public.flow_http_debug (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  flow_id uuid NOT NULL REFERENCES public.flows(id) ON DELETE CASCADE,
  node_id text NOT NULL CHECK (char_length(node_id) <= 80),
  ok boolean NOT NULL,
  status int,
  ms int NOT NULL DEFAULT 0,
  error text CHECK (error IS NULL OR char_length(error) <= 300),
  body text CHECK (body IS NULL OR char_length(body) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS flow_http_debug_flow_idx ON public.flow_http_debug (flow_id, created_at DESC);
ALTER TABLE public.flow_http_debug ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.flow_http_debug FROM anon, authenticated;
GRANT SELECT ON public.flow_http_debug TO authenticated;
DROP POLICY IF EXISTS "ler: dono" ON public.flow_http_debug;
CREATE POLICY "ler: dono" ON public.flow_http_debug FOR SELECT TO authenticated USING (private.has_permission(organization_id, 'org.settings'));

-- Dono liga (por 1 hora) ou desliga a depuração de um fluxo.
CREATE OR REPLACE FUNCTION public.set_flow_http_debug(p_flow uuid, p_on boolean)
RETURNS timestamptz LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE f public.flows; until timestamptz;
BEGIN
  SELECT * INTO f FROM public.flows WHERE id = p_flow FOR UPDATE;
  IF f.id IS NULL OR NOT private.has_permission(f.organization_id, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  until := CASE WHEN p_on THEN now() + interval '1 hour' END;
  UPDATE public.flows SET http_debug_until = until WHERE id = p_flow;
  IF NOT p_on THEN DELETE FROM public.flow_http_debug WHERE flow_id = p_flow; END IF;
  PERFORM private.audit(f.organization_id, 'flow.http_debug', p_flow::text, jsonb_build_object('ligado', p_on));
  RETURN until;
END $$;
REVOKE ALL ON FUNCTION public.set_flow_http_debug(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_flow_http_debug(uuid, boolean) TO authenticated;

-- Servidor: guarda a chamada só se a depuração do fluxo estiver ligada (no máximo 1 hora à frente) e limpa o que passou de 1 hora.
CREATE OR REPLACE FUNCTION public.service_flow_http_debug_log(org uuid, p_flow uuid, p_node text, p_ok boolean, p_status int, p_ms int, p_error text, p_body text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  DELETE FROM public.flow_http_debug WHERE organization_id = org AND created_at < now() - interval '1 hour';
  IF NOT EXISTS (SELECT 1 FROM public.flows WHERE id = p_flow AND organization_id = org
                 AND http_debug_until > now() AND http_debug_until <= now() + interval '65 minutes') THEN
    RETURN false;
  END IF;
  INSERT INTO public.flow_http_debug (organization_id, flow_id, node_id, ok, status, ms, error, body)
  VALUES (org, p_flow, left(coalesce(p_node, '?'), 80), p_ok, p_status, coalesce(p_ms, 0), left(private.scrub(p_error), 300), left(p_body, 2000));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.service_flow_http_debug_log(uuid, uuid, text, boolean, int, int, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_flow_http_debug_log(uuid, uuid, text, boolean, int, int, text, text) TO service_role;

-- Limpeza diária também apaga depuração esquecida.
CREATE OR REPLACE FUNCTION private.ai_housekeeping_tick()
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM public.ai_suggestions WHERE (used_at IS NOT NULL AND used_at < now() - interval '30 days') OR created_at < now() - interval '90 days';
  DELETE FROM public.agent_tasks WHERE status <> 'aberta' AND coalesce(done_at, created_at) < now() - interval '90 days';
  DELETE FROM public.flow_http_debug WHERE created_at < now() - interval '1 hour';
$$;
REVOKE ALL ON FUNCTION private.ai_housekeeping_tick() FROM PUBLIC, anon, authenticated;
