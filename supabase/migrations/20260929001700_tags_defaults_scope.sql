-- =============================================================================
-- Etiquetas padrão e etiquetas por setor (pedido em 29/09)
--  * Etiquetas padrão do sistema (VIP, Urgente, Retornar contato...) criadas em
--    toda empresa nova e nas atuais; o dono pode renomear/excluir e recriar com
--    "Adicionar etiquetas padrão".
--  * Quem gerencia etiquetas associa cada etiqueta a um ou mais setores (sem setor
--    = geral). Atendente só vê e usa as gerais e as dos setores a que pertence;
--    quem vê todas as conversas ou gerencia etiquetas vê todas.
-- Idempotente.
-- =============================================================================

ALTER TABLE public.tags ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.tag_departments (
  tag_id uuid NOT NULL,
  department_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  PRIMARY KEY (tag_id, department_id),
  FOREIGN KEY (tag_id, organization_id) REFERENCES public.tags (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (department_id, organization_id) REFERENCES public.departments (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS tag_departments_dept_idx ON public.tag_departments (department_id);

-- Pode ver/marcar com esta etiqueta? Geral, de um setor meu, ou vejo tudo.
CREATE OR REPLACE FUNCTION private.can_use_tag(org uuid, tag uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.is_member(org) AND (
    private.has_permission(org, 'conversations.view_all') OR private.has_permission(org, 'library.manage')
    OR NOT EXISTS (SELECT 1 FROM public.tag_departments td WHERE td.tag_id = tag)
    OR EXISTS (SELECT 1 FROM public.tag_departments td WHERE td.tag_id = tag AND private.in_department(td.department_id)))
$$;
REVOKE ALL ON FUNCTION private.can_use_tag(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_use_tag(uuid, uuid) TO authenticated;

ALTER TABLE public.tag_departments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tag_departments FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.tag_departments TO authenticated;
DROP POLICY IF EXISTS tag_departments_select ON public.tag_departments;
CREATE POLICY tag_departments_select ON public.tag_departments FOR SELECT TO authenticated
  USING (private.is_member(organization_id));
DROP POLICY IF EXISTS tag_departments_manage ON public.tag_departments;
CREATE POLICY tag_departments_manage ON public.tag_departments FOR ALL TO authenticated
  USING (private.has_permission(organization_id, 'library.manage'))
  WITH CHECK (private.has_permission(organization_id, 'library.manage'));

DROP POLICY IF EXISTS "org: ver" ON public.tags;
CREATE POLICY "org: ver" ON public.tags FOR SELECT TO authenticated
  USING (private.can_use_tag(organization_id, id));

DROP POLICY IF EXISTS "org: ver" ON public.contact_tags;
CREATE POLICY "org: ver" ON public.contact_tags FOR SELECT TO authenticated
  USING (private.can_see_contact(organization_id, contact_id) AND private.can_use_tag(organization_id, tag_id));
DROP POLICY IF EXISTS "org: marcar" ON public.contact_tags;
CREATE POLICY "org: marcar" ON public.contact_tags FOR ALL TO authenticated
  USING (private.can_see_contact(organization_id, contact_id) AND private.has_permission(organization_id, 'conversations.attend')
         AND private.can_use_tag(organization_id, tag_id))
  WITH CHECK (private.can_see_contact(organization_id, contact_id) AND private.has_permission(organization_id, 'conversations.attend')
         AND private.can_use_tag(organization_id, tag_id));

-- Etiquetas padrão.
CREATE OR REPLACE FUNCTION private.seed_default_tags(org uuid)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer;
BEGIN
  INSERT INTO public.tags (organization_id, name, color, icon, is_default)
  SELECT org, d.name, d.color, d.icon, true FROM (VALUES
    ('VIP', '#F59E0B', 'crown'),
    ('Novo cliente', '#3FB8BE', 'star'),
    ('Retornar contato', '#6C8EF5', 'clock'),
    ('Urgente', '#EF4444', 'alert-triangle'),
    ('Reclamação', '#EC4899', 'flag'),
    ('Orçamento enviado', '#8B5CF6', 'briefcase'),
    ('Aguardando pagamento', '#F59E0B', 'dollar-sign'),
    ('Pedido em andamento', '#10B981', 'truck'),
    ('Não incomodar', '#64748B', 'ban')
  ) AS d(name, color, icon)
  ON CONFLICT (organization_id, name) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION private.seed_default_tags(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.add_default_tags(org uuid)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.has_permission(org, 'library.manage') THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  RETURN private.seed_default_tags(org);
END $$;
REVOKE ALL ON FUNCTION public.add_default_tags(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_default_tags(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.org_default_tags()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.seed_default_tags(NEW.id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.org_default_tags() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS org_default_tags ON public.organizations;
CREATE TRIGGER org_default_tags AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION private.org_default_tags();

-- Empresas que já existem (ambiente de teste).
DO $$
DECLARE o uuid;
BEGIN
  FOR o IN SELECT id FROM public.organizations LOOP PERFORM private.seed_default_tags(o); END LOOP;
END $$;
