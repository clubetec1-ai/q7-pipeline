-- =============================================================================
-- Cérebro, fatia 1 (docs/design/03-cerebro.md §2.1 e §2.3): áreas de gestão com
-- responsável que aprova as propostas da área.
--  * org_areas: Vendas, Atendimento, Financeiro… (ligadas ou não a um setor da fila),
--    responsável e substituto (membros ativos da MESMA empresa — FK composta);
--  * improvements.area_id: a proposta pertence a uma área;
--  * can_approve_improvement: dono/admin sempre; responsável da área quando o modo é
--    "responsavel"; regra antiga (supervisor do setor) continua; agente/integração só dono;
--  * o responsável vê e é avisado das propostas da sua área.
-- Navegador só lê; escrita por RPC com auditoria. Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.org_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key IN ('vendas', 'atendimento', 'financeiro', 'administrativo', 'marketing', 'rh', 'operacao', 'pos_venda', 'outra')),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 60),
  department_id uuid,
  approver_id uuid,
  backup_approver_id uuid,
  approval_mode text NOT NULL DEFAULT 'responsavel' CHECK (approval_mode IN ('responsavel', 'dono')),
  agent_enabled boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name),
  UNIQUE (id, organization_id),
  CONSTRAINT org_areas_department_fk FOREIGN KEY (department_id, organization_id)
    REFERENCES public.departments (id, organization_id) ON DELETE SET NULL (department_id),
  CONSTRAINT org_areas_approver_fk FOREIGN KEY (organization_id, approver_id)
    REFERENCES public.organization_members (organization_id, user_id) ON DELETE SET NULL (approver_id),
  CONSTRAINT org_areas_backup_fk FOREIGN KEY (organization_id, backup_approver_id)
    REFERENCES public.organization_members (organization_id, user_id) ON DELETE SET NULL (backup_approver_id)
);
CREATE INDEX IF NOT EXISTS org_areas_org_idx ON public.org_areas (organization_id);
ALTER TABLE public.org_areas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.org_areas FROM anon, authenticated;
GRANT SELECT ON public.org_areas TO authenticated;
GRANT ALL ON public.org_areas TO service_role;

-- A pessoa é responsável (ou substituta) desta área, membro ativo da empresa?
CREATE OR REPLACE FUNCTION private.is_area_approver(area uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_areas a
    WHERE a.id = area AND a.enabled
      AND (SELECT auth.uid()) IN (a.approver_id, a.backup_approver_id)
      AND private.is_member(a.organization_id))
$$;
REVOKE ALL ON FUNCTION private.is_area_approver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_area_approver(uuid) TO authenticated;

DROP POLICY IF EXISTS "org: ver" ON public.org_areas;
CREATE POLICY "org: ver" ON public.org_areas FOR SELECT TO authenticated
  USING (private.has_permission(organization_id, 'org.settings') OR private.is_area_approver(id));

-- Criar ou editar área (só dono/admin). area NULL = nova.
CREATE OR REPLACE FUNCTION public.set_org_area(org uuid, area uuid, p_key text, p_name text, department uuid,
  approver uuid, backup uuid, mode text, agent_on boolean, on_off boolean)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.org_areas; nid uuid;
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF approver IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = org AND user_id = approver AND status = 'active') THEN
    RAISE EXCEPTION 'o responsável precisa ser da equipe desta empresa' USING ERRCODE = '22023';
  END IF;
  IF backup IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id = org AND user_id = backup AND status = 'active') THEN
    RAISE EXCEPTION 'o substituto precisa ser da equipe desta empresa' USING ERRCODE = '22023';
  END IF;
  IF area IS NULL THEN
    INSERT INTO public.org_areas (organization_id, key, name, department_id, approver_id, backup_approver_id, approval_mode, agent_enabled, enabled)
    VALUES (org, p_key, btrim(p_name), department, approver, backup, coalesce(mode, 'responsavel'), coalesce(agent_on, false), coalesce(on_off, true))
    RETURNING id INTO nid;
    PERFORM private.audit(org, 'area.created', nid::text, jsonb_build_object('name', btrim(p_name), 'approver', approver));
    RETURN nid;
  END IF;
  SELECT * INTO a FROM public.org_areas WHERE id = area AND organization_id = org FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'área não encontrada' USING ERRCODE = '42501'; END IF;
  UPDATE public.org_areas SET key = p_key, name = btrim(p_name), department_id = department, approver_id = approver,
    backup_approver_id = backup, approval_mode = coalesce(mode, 'responsavel'), agent_enabled = coalesce(agent_on, false),
    enabled = coalesce(on_off, true), updated_at = now()
  WHERE id = area;
  PERFORM private.audit(org, 'area.saved', area::text,
    jsonb_build_object('name', btrim(p_name), 'approver_before', a.approver_id, 'approver', approver, 'mode', mode, 'enabled', on_off));
  RETURN area;
END $$;
REVOKE ALL ON FUNCTION public.set_org_area(uuid, uuid, text, text, uuid, uuid, uuid, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_org_area(uuid, uuid, text, text, uuid, uuid, uuid, text, boolean, boolean) TO authenticated;

-- Sugere as áreas a partir dos setores e do catálogo (desligadas: o dono confere e liga).
CREATE OR REPLACE FUNCTION public.seed_org_areas(org uuid)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d record; k text; n integer := 0; c integer;
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  FOR d IN SELECT id, name FROM public.departments WHERE organization_id = org LOOP
    k := CASE
      WHEN d.name ~* '(vend|comerc)' THEN 'vendas'
      WHEN d.name ~* '(financ|cobran|fatur)' THEN 'financeiro'
      WHEN d.name ~* '(market|divulga)' THEN 'marketing'
      WHEN d.name ~* '(rh|recursos humanos|pessoas)' THEN 'rh'
      WHEN d.name ~* '(admin|secret)' THEN 'administrativo'
      WHEN d.name ~* '(suporte|atendim|sac|recep)' THEN 'atendimento'
      WHEN d.name ~* '(p[oó]s.?venda|implant)' THEN 'pos_venda'
      ELSE 'operacao' END;
    INSERT INTO public.org_areas (organization_id, key, name, department_id, enabled)
    VALUES (org, k, d.name, d.id, false) ON CONFLICT (organization_id, name) DO NOTHING;
    GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
  END LOOP;
  -- Áreas de gestão que toda empresa tem, mesmo sem fila própria.
  FOR k IN SELECT unnest(ARRAY['vendas', 'atendimento', 'financeiro', 'marketing', 'administrativo']) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.org_areas WHERE organization_id = org AND key = k) THEN
      INSERT INTO public.org_areas (organization_id, key, name, enabled)
      VALUES (org, k, CASE k WHEN 'vendas' THEN 'Vendas' WHEN 'atendimento' THEN 'Atendimento' WHEN 'financeiro' THEN 'Financeiro'
                             WHEN 'marketing' THEN 'Marketing' ELSE 'Administrativo' END, false)
      ON CONFLICT (organization_id, name) DO NOTHING;
      GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
    END IF;
  END LOOP;
  PERFORM private.audit(org, 'area.seeded', 'org_areas', jsonb_build_object('added', n));
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.seed_org_areas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_org_areas(uuid) TO authenticated;

-- Propostas ganham área; o cérebro vira uma origem possível.
ALTER TABLE public.improvements ADD COLUMN IF NOT EXISTS area_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'improvements_area_fk') THEN
    ALTER TABLE public.improvements ADD CONSTRAINT improvements_area_fk FOREIGN KEY (area_id, organization_id)
      REFERENCES public.org_areas (id, organization_id) ON DELETE SET NULL (area_id);
  END IF;
  ALTER TABLE public.improvements DROP CONSTRAINT IF EXISTS improvements_source_check;
  ALTER TABLE public.improvements ADD CONSTRAINT improvements_source_check
    CHECK (source IN ('plano', 'avaliacoes', 'monitor', 'manual', 'cerebro'));
END $$;
CREATE INDEX IF NOT EXISTS improvements_area_idx ON public.improvements (area_id) WHERE area_id IS NOT NULL;

-- Dono escolhe a área de uma proposta (ou tira).
CREATE OR REPLACE FUNCTION public.set_improvement_area(improvement uuid, area uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.improvements;
BEGIN
  SELECT * INTO i FROM public.improvements WHERE id = improvement FOR UPDATE;
  IF i.id IS NULL OR NOT private.has_permission(i.organization_id, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF area IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.org_areas WHERE id = area AND organization_id = i.organization_id) THEN
    RAISE EXCEPTION 'área não encontrada' USING ERRCODE = '22023';
  END IF;
  UPDATE public.improvements SET area_id = area, updated_at = now() WHERE id = i.id;
  PERFORM private.audit(i.organization_id, 'improvement.area', i.id::text, jsonb_build_object('area', area));
  IF area IS NOT NULL AND i.status = 'sugerida' THEN
    PERFORM private.notify_improvement((SELECT x FROM public.improvements x WHERE x.id = i.id));
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_improvement_area(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_improvement_area(uuid, uuid) TO authenticated;

-- Quem aprova: dono/admin; responsável da área (modo responsavel, só processo/automação); regra antiga do setor.
CREATE OR REPLACE FUNCTION private.can_approve_improvement(i public.improvements)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.has_permission(i.organization_id, 'org.settings')
      OR (i.kind IN ('processo', 'automacao') AND (
            (i.area_id IS NOT NULL AND private.is_area_approver(i.area_id)
             AND EXISTS (SELECT 1 FROM public.org_areas a WHERE a.id = i.area_id AND a.approval_mode = 'responsavel'))
         OR (i.department_id IS NOT NULL AND private.has_permission(i.organization_id, 'reports.view')
             AND private.in_department(i.department_id))))
$$;
REVOKE ALL ON FUNCTION private.can_approve_improvement(public.improvements) FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "org: ver" ON public.improvements;
CREATE POLICY "org: ver" ON public.improvements FOR SELECT TO authenticated USING (
  private.has_permission(organization_id, 'org.settings')
  OR (area_id IS NOT NULL AND private.is_area_approver(area_id))
  OR (private.has_permission(organization_id, 'reports.view')
      AND (department_id IS NULL OR private.has_permission(organization_id, 'conversations.view_all')
           OR private.in_department(department_id))));

-- Avisa quem aprova: dono/admin, supervisores do setor e responsável/substituto da área.
CREATE OR REPLACE FUNCTION private.notify_improvement(i public.improvements)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.notifications (organization_id, user_id, kind, ref)
  SELECT DISTINCT i.organization_id, m.user_id, 'improvement',
         jsonb_build_object('improvement_id', i.id, 'title', left(i.title, 120), 'source', i.source)
  FROM public.organization_members m
  WHERE m.organization_id = i.organization_id AND m.status = 'active'
    AND (m.role IN ('owner', 'admin')
         OR (m.role = 'supervisor' AND i.department_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.department_members dm WHERE dm.department_id = i.department_id AND dm.user_id = m.user_id))
         OR (i.area_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM public.org_areas a WHERE a.id = i.area_id AND a.enabled
                 AND m.user_id IN (a.approver_id, a.backup_approver_id))))
$$;
REVOKE ALL ON FUNCTION private.notify_improvement(public.improvements) FROM PUBLIC, anon, authenticated;
