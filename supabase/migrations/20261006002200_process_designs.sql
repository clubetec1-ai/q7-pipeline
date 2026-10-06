-- Processos como dado (desenho 07, fatia 3): o Arquiteto transforma cada processo contado no
-- Diagnóstico (company_profiles.processes, que continua sendo a fonte) num desenho estruturado:
-- gatilho, passos com a decisão de automação (fluxo | modelo | ia | pessoa), exceções, dados do
-- cliente (sensíveis marcados), base legal, prazo, indicadores e riscos. Só o servidor grava o
-- desenho (validado em _shared/process-design.ts); dono ou responsável da área do setor aprovam.
-- Idempotente.
CREATE TABLE IF NOT EXISTS public.process_designs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id uuid,
  setor text NOT NULL CHECK (char_length(setor) BETWEEN 1 AND 80),
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 120),
  design jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(design) = 'object' AND octet_length(design::text) <= 60000),
  status text NOT NULL DEFAULT 'proposto' CHECK (status IN ('proposto', 'aprovado', 'arquivado')),
  version int NOT NULL DEFAULT 1,
  architect_note text CHECK (architect_note IS NULL OR char_length(architect_note) <= 800),
  proposed_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT process_designs_id_org UNIQUE (id, organization_id),
  CONSTRAINT process_designs_department_fk FOREIGN KEY (department_id, organization_id)
    REFERENCES public.departments (id, organization_id) ON DELETE SET NULL (department_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS process_designs_name_uq ON public.process_designs (organization_id, lower(setor), lower(nome));
ALTER TABLE public.process_designs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.process_designs FROM anon, authenticated;
GRANT SELECT ON public.process_designs TO authenticated;

-- Quem aprova o processo do setor: dono/admin, ou o responsável (ou substituto) da área ligada ao setor.
CREATE OR REPLACE FUNCTION private.can_approve_process(org uuid, dept uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.has_permission(org, 'org.settings')
    OR (dept IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.org_areas a
      WHERE a.organization_id = org AND a.department_id = dept AND a.approval_mode = 'responsavel'
        AND private.is_area_approver(a.id)))
$$;
REVOKE ALL ON FUNCTION private.can_approve_process(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_approve_process(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "ler: dono ou responsavel da area" ON public.process_designs;
CREATE POLICY "ler: dono ou responsavel da area" ON public.process_designs FOR SELECT TO authenticated
  USING (private.can_approve_process(organization_id, department_id));

-- Servidor (Arquiteto): grava o desenho; se mudou um aprovado, volta a "proposto" com versão nova.
CREATE OR REPLACE FUNCTION public.service_process_design_save(org uuid, p_setor text, p_nome text, p_design jsonb)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE dept uuid; cur public.process_designs; rid uuid;
BEGIN
  IF jsonb_typeof(p_design) <> 'object' THEN RAISE EXCEPTION 'desenho inválido' USING ERRCODE = '22023'; END IF;
  SELECT id INTO dept FROM public.departments WHERE organization_id = org AND lower(btrim(name)) = lower(btrim(p_setor)) LIMIT 1;
  SELECT * INTO cur FROM public.process_designs
  WHERE organization_id = org AND lower(setor) = lower(btrim(p_setor)) AND lower(nome) = lower(btrim(p_nome)) FOR UPDATE;
  IF cur.id IS NULL THEN
    INSERT INTO public.process_designs (organization_id, department_id, setor, nome, design)
    VALUES (org, dept, left(btrim(p_setor), 80), left(btrim(p_nome), 120), p_design) RETURNING id INTO rid;
  ELSE
    UPDATE public.process_designs
    SET design = p_design, department_id = dept, status = 'proposto', architect_note = NULL,
        version = CASE WHEN cur.status = 'aprovado' AND cur.design IS DISTINCT FROM p_design THEN cur.version + 1 ELSE cur.version END,
        approved_by = NULL, approved_at = NULL, proposed_at = now(), updated_at = now()
    WHERE id = cur.id RETURNING id INTO rid;
  END IF;
  PERFORM private.audit(org, 'process.designed', rid::text, jsonb_build_object('setor', p_setor, 'nome', p_nome), 'ai_agent', 'arquiteto');
  RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.service_process_design_save(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_process_design_save(uuid, text, text, jsonb) TO service_role;

-- Dono ou responsável da área: aprovar o desenho.
CREATE OR REPLACE FUNCTION public.approve_process_design(p_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.process_designs;
BEGIN
  SELECT * INTO d FROM public.process_designs WHERE id = p_id FOR UPDATE;
  IF d.id IS NULL OR NOT private.can_approve_process(d.organization_id, d.department_id) THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  IF d.status <> 'proposto' THEN RAISE EXCEPTION 'só desenho proposto pode ser aprovado' USING ERRCODE = '22023'; END IF;
  UPDATE public.process_designs SET status = 'aprovado', approved_by = auth.uid(), approved_at = now(), updated_at = now() WHERE id = p_id;
  PERFORM private.audit(d.organization_id, 'process.approved', p_id::text, jsonb_build_object('version', d.version));
END $$;
REVOKE ALL ON FUNCTION public.approve_process_design(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_process_design(uuid) TO authenticated;

-- Dono ou responsável: pedir ajuste ao Arquiteto (o texto vai junto no próximo desenho).
CREATE OR REPLACE FUNCTION public.set_process_design_note(p_id uuid, p_note text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.process_designs;
BEGIN
  SELECT * INTO d FROM public.process_designs WHERE id = p_id FOR UPDATE;
  IF d.id IS NULL OR NOT private.can_approve_process(d.organization_id, d.department_id) THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  IF char_length(coalesce(p_note, '')) > 800 THEN RAISE EXCEPTION 'pedido de ajuste longo demais' USING ERRCODE = '22023'; END IF;
  UPDATE public.process_designs SET architect_note = nullif(btrim(p_note), ''), updated_at = now() WHERE id = p_id;
  PERFORM private.audit(d.organization_id, 'process.note', p_id::text, '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.set_process_design_note(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_process_design_note(uuid, text) TO authenticated;

-- Dono ou responsável: arquivar (processo que não existe mais).
CREATE OR REPLACE FUNCTION public.archive_process_design(p_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.process_designs;
BEGIN
  SELECT * INTO d FROM public.process_designs WHERE id = p_id FOR UPDATE;
  IF d.id IS NULL OR NOT private.can_approve_process(d.organization_id, d.department_id) THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  UPDATE public.process_designs SET status = 'arquivado', updated_at = now() WHERE id = p_id;
  PERFORM private.audit(d.organization_id, 'process.archived', p_id::text, '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.archive_process_design(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_process_design(uuid) TO authenticated;

-- Recomeçar o Diagnóstico apaga os desenhos junto.
CREATE OR REPLACE FUNCTION private.designs_on_profile_reset()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.steps = '{}'::jsonb THEN DELETE FROM public.process_designs WHERE organization_id = NEW.organization_id; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS designs_on_profile_reset ON public.company_profiles;
CREATE TRIGGER designs_on_profile_reset AFTER UPDATE OF steps ON public.company_profiles
  FOR EACH ROW EXECUTE FUNCTION private.designs_on_profile_reset();

-- Quem pode pedir o desenho de um processo do setor (o nome do setor vira o setor da empresa).
CREATE OR REPLACE FUNCTION public.can_design_process(org uuid, p_setor text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.can_approve_process(org,
    (SELECT id FROM public.departments WHERE organization_id = org AND lower(btrim(name)) = lower(btrim(p_setor)) LIMIT 1))
$$;
REVOKE ALL ON FUNCTION public.can_design_process(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_design_process(uuid, text) TO authenticated;
