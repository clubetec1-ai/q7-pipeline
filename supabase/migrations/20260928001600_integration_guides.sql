-- =============================================================================
-- Guia de integração (tela Integrações) + pedidos de ajuda ao time Clubetec
--  * integration_guides: guia gerado pela IA por organização (passos, config do
--    bloco "Consultar sistema", resposta de teste, fluxo criado). Só org.settings.
--    A config só é gravada pelo backend (testada pela guarda de rede do HTTP).
--  * service_requests: "Pedir ajuda ao time Clubetec" — a empresa cria e vê os
--    seus; operadores da plataforma veem todos (serviço pago).
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.integration_guides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  system text NOT NULL CHECK (char_length(system) BETWEEN 1 AND 80),
  goal text NOT NULL CHECK (char_length(goal) BETWEEN 1 AND 500),
  title text,
  guide jsonb NOT NULL DEFAULT '{}'::jsonb,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  sample jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'tested', 'installed')),
  flow_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);
CREATE INDEX IF NOT EXISTS integration_guides_org_idx ON public.integration_guides (organization_id, created_at DESC);
ALTER TABLE public.integration_guides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.integration_guides FROM anon, authenticated;
GRANT SELECT, DELETE ON public.integration_guides TO authenticated;
DROP POLICY IF EXISTS "org: dono/admin" ON public.integration_guides;
CREATE POLICY "org: dono/admin" ON public.integration_guides FOR ALL TO authenticated
  USING (private.has_permission(organization_id, 'org.settings'))
  WITH CHECK (private.has_permission(organization_id, 'org.settings'));

CREATE TABLE IF NOT EXISTS public.service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  guide_id uuid,
  topic text NOT NULL CHECK (char_length(topic) BETWEEN 1 AND 120),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'canceled')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (guide_id, organization_id) REFERENCES public.integration_guides (id, organization_id) ON DELETE SET NULL (guide_id)
);
ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_requests FROM anon, authenticated;
GRANT SELECT ON public.service_requests TO authenticated;
GRANT INSERT (organization_id, guide_id, topic, message, created_by) ON public.service_requests TO authenticated;
DROP POLICY IF EXISTS "org: ver" ON public.service_requests;
DROP POLICY IF EXISTS "org: pedir" ON public.service_requests;
CREATE POLICY "org: ver" ON public.service_requests FOR SELECT TO authenticated
  USING (private.has_permission(organization_id, 'org.settings') OR private.is_platform_operator());
CREATE POLICY "org: pedir" ON public.service_requests FOR INSERT TO authenticated
  WITH CHECK (private.has_permission(organization_id, 'org.settings') AND created_by = (SELECT auth.uid()));

-- Operador atualiza a situação do pedido (auditado).
CREATE OR REPLACE FUNCTION public.platform_set_request_status(request uuid, new_status text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE o uuid;
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF new_status NOT IN ('open', 'in_progress', 'done', 'canceled') THEN RAISE EXCEPTION 'situação inválida' USING ERRCODE = '22023'; END IF;
  UPDATE public.service_requests SET status = new_status WHERE id = request RETURNING organization_id INTO o;
  IF o IS NULL THEN RAISE EXCEPTION 'pedido não encontrado' USING ERRCODE = '22023'; END IF;
  PERFORM private.audit(o, 'platform.request_status', request::text, jsonb_build_object('status', new_status));
END $$;
REVOKE ALL ON FUNCTION public.platform_set_request_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_request_status(uuid, text) TO authenticated;
