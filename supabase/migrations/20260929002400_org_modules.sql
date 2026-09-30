-- =============================================================================
-- Módulos por empresa (pedido em 30/09)
-- Base "Atendimento" sempre ativa (Conversas, Kanban, contatos, etiquetas, equipe,
-- chat, 1 número de WhatsApp, relatórios básicos). Módulos que a Clubetec liga ou
-- desliga por empresa em Plataforma:
--   diagnostico · ia · canais · telefonia · campanhas · cobrancas · gestao
-- A trava vale no BANCO (gatilhos nas tabelas de entrada de cada módulo) e nas
-- Edge Functions; a tela só esconde. Empresas atuais e novas começam com todos
-- ligados (fase de testes); planos e cobrança vêm depois.
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.org_modules (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  module text NOT NULL CHECK (module IN ('diagnostico', 'ia', 'canais', 'telefonia', 'campanhas', 'cobrancas', 'gestao')),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  PRIMARY KEY (organization_id, module)
);
ALTER TABLE public.org_modules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.org_modules FROM anon, authenticated;
GRANT SELECT ON public.org_modules TO authenticated;
DROP POLICY IF EXISTS org_modules_select ON public.org_modules;
CREATE POLICY org_modules_select ON public.org_modules FOR SELECT TO authenticated
  USING (private.is_member(organization_id) OR private.is_platform_operator());

CREATE OR REPLACE FUNCTION private.module_on(org uuid, m text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.org_modules WHERE organization_id = org AND module = m AND enabled)
$$;
REVOKE ALL ON FUNCTION private.module_on(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.module_on(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.require_module(org uuid, m text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.module_on(org, m) THEN
    RAISE EXCEPTION 'módulo "%" não está ativo para esta empresa', m USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.require_module(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.require_module(uuid, text) TO authenticated, service_role;

-- Para as Edge Functions (service_role): o módulo está ativo?
CREATE OR REPLACE FUNCTION public.service_module_on(org uuid, m text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.module_on(org, m)
$$;
REVOKE ALL ON FUNCTION public.service_module_on(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_module_on(uuid, text) TO service_role;

-- Operador liga/desliga (auditado).
CREATE OR REPLACE FUNCTION public.platform_set_module(org uuid, m text, on_off boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'só a Clubetec' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.org_modules (organization_id, module, enabled, updated_at, updated_by)
  VALUES (org, m, on_off, now(), (SELECT auth.uid()))
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now(), updated_by = EXCLUDED.updated_by;
  PERFORM private.audit(org, CASE WHEN on_off THEN 'module.enabled' ELSE 'module.disabled' END, m, '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.platform_set_module(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_set_module(uuid, text, boolean) TO authenticated;

-- Todos ligados nas empresas atuais e nas novas (fase de testes).
CREATE OR REPLACE FUNCTION private.seed_org_modules(org uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.org_modules (organization_id, module)
  SELECT org, m FROM unnest(ARRAY['diagnostico', 'ia', 'canais', 'telefonia', 'campanhas', 'cobrancas', 'gestao']) m
  ON CONFLICT DO NOTHING
$$;
REVOKE ALL ON FUNCTION private.seed_org_modules(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION private.org_modules_default()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN PERFORM private.seed_org_modules(NEW.id); RETURN NEW; END $$;
REVOKE ALL ON FUNCTION private.org_modules_default() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS org_modules_default ON public.organizations;
CREATE TRIGGER org_modules_default AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION private.org_modules_default();
DO $$ DECLARE o uuid; BEGIN FOR o IN SELECT id FROM public.organizations LOOP PERFORM private.seed_org_modules(o); END LOOP; END $$;

-- -----------------------------------------------------------------------------
-- Travas no banco (gatilhos nas tabelas de entrada de cada módulo)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.module_gate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m text := TG_ARGV[0];
BEGIN
  -- Fluxo: só publicar exige o módulo (rascunho pode).
  IF TG_TABLE_NAME = 'flow_versions' AND NEW.status IS DISTINCT FROM 'published' THEN RETURN NEW; END IF;
  -- Campanha: criar e colocar para rodar exigem o módulo.
  IF TG_TABLE_NAME = 'campaigns' AND TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM 'running' THEN RETURN NEW; END IF;
  -- Avaliação automática: sem o módulo, simplesmente não cria (não quebra o atendimento).
  IF TG_TABLE_NAME = 'ticket_reviews' THEN
    IF private.module_on(NEW.organization_id, m) THEN RETURN NEW; END IF;
    RETURN NULL;
  END IF;
  PERFORM private.require_module(NEW.organization_id, m);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.module_gate() FROM PUBLIC, anon, authenticated;

-- Números: o 1º (QR) é da base; do 2º em diante, ou oficial da Meta, exige "canais".
CREATE OR REPLACE FUNCTION private.module_gate_numbers()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN RETURN NEW; END IF;
  IF coalesce(NEW.provider, 'uazapi') = 'cloud'
     OR EXISTS (SELECT 1 FROM public.whatsapp_instances w WHERE w.organization_id = NEW.organization_id AND w.id <> NEW.id) THEN
    PERFORM private.require_module(NEW.organization_id, 'canais');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.module_gate_numbers() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE g record;
BEGIN
  FOR g IN SELECT * FROM (VALUES
    ('campaigns', 'campanhas', 'INSERT OR UPDATE OF status'),
    ('charges', 'cobrancas', 'INSERT'),
    ('calls', 'telefonia', 'INSERT'),
    ('email_accounts', 'canais', 'INSERT'),
    ('knowledge_docs', 'ia', 'INSERT'),
    ('flow_versions', 'ia', 'INSERT OR UPDATE OF status'),
    ('ticket_reviews', 'gestao', 'INSERT'),
    ('improvements', 'gestao', 'INSERT')
  ) AS t(tbl, m, ev) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zz_module_gate ON public.%I', g.tbl);
    EXECUTE format('CREATE TRIGGER zz_module_gate BEFORE %s ON public.%I FOR EACH ROW EXECUTE FUNCTION private.module_gate(%L)', g.ev, g.tbl, g.m);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS zz_module_gate ON public.whatsapp_instances;
CREATE TRIGGER zz_module_gate BEFORE INSERT ON public.whatsapp_instances FOR EACH ROW EXECUTE FUNCTION private.module_gate_numbers();
