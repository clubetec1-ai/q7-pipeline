-- =============================================================================
-- Gestão de etiquetas e grupos de clientes (pedido em 29/09)
--  * Ícone (lista fixa) além da cor; renomear/excluir já são permitidos por quem
--    gerencia (etiquetas: library.manage; grupos: contacts.groups_manage).
--  * Juntar duplicados: move as marcações e apaga o de origem (mesma empresa;
--    grupo sensível só junta com sensível, para não expor quem estava escondido).
--  * Contagem por etiqueta/grupo respeita o que cada pessoa pode ver (RLS).
--  * Exclusões vão para a auditoria.
-- Idempotente.
-- =============================================================================

ALTER TABLE public.tags ADD COLUMN IF NOT EXISTS icon text;
ALTER TABLE public.contact_groups ADD COLUMN IF NOT EXISTS icon text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tags_icon_check') THEN
    ALTER TABLE public.tags ADD CONSTRAINT tags_icon_check CHECK (icon IS NULL OR icon ~ '^[a-z0-9-]{2,30}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contact_groups_icon_check') THEN
    ALTER TABLE public.contact_groups ADD CONSTRAINT contact_groups_icon_check CHECK (icon IS NULL OR icon ~ '^[a-z0-9-]{2,30}$');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.merge_tags(source uuid, target uuid)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.tags; t public.tags; n integer;
BEGIN
  SELECT * INTO s FROM public.tags WHERE id = source;
  SELECT * INTO t FROM public.tags WHERE id = target;
  IF s.id IS NULL OR t.id IS NULL OR s.id = t.id OR s.organization_id <> t.organization_id
     OR NOT private.has_permission(s.organization_id, 'library.manage') THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.contact_tags (organization_id, contact_id, tag_id)
  SELECT s.organization_id, ct.contact_id, t.id FROM public.contact_tags ct WHERE ct.tag_id = s.id
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM public.tags WHERE id = s.id;
  PERFORM private.audit(s.organization_id, 'tag.merged', t.id::text, jsonb_build_object('from', s.name, 'into', t.name));
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.merge_groups(source uuid, target uuid)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.contact_groups; t public.contact_groups; n integer;
BEGIN
  SELECT * INTO s FROM public.contact_groups WHERE id = source;
  SELECT * INTO t FROM public.contact_groups WHERE id = target;
  IF s.id IS NULL OR t.id IS NULL OR s.id = t.id OR s.organization_id <> t.organization_id
     OR NOT private.has_permission(s.organization_id, 'contacts.groups_manage') THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  IF s.sensitive <> t.sensitive THEN
    RAISE EXCEPTION 'grupo sensível só pode ser juntado com outro sensível' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.contact_group_members (organization_id, group_id, contact_id)
  SELECT s.organization_id, t.id, m.contact_id FROM public.contact_group_members m WHERE m.group_id = s.id
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM public.contact_groups WHERE id = s.id;
  PERFORM private.audit(s.organization_id, 'group.merged', t.id::text, jsonb_build_object('from', s.name, 'into', t.name));
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.merge_tags(uuid, uuid), public.merge_groups(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_tags(uuid, uuid), public.merge_groups(uuid, uuid) TO authenticated;

-- Quantos clientes em cada etiqueta/grupo (só o que a pessoa enxerga).
CREATE OR REPLACE FUNCTION public.tag_group_counts(org uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'tags', coalesce((SELECT jsonb_object_agg(tag_id, n) FROM (SELECT tag_id, count(*) n FROM public.contact_tags
              WHERE organization_id = org GROUP BY tag_id) x), '{}'::jsonb),
    'groups', coalesce((SELECT jsonb_object_agg(group_id, n) FROM (SELECT group_id, count(*) n FROM public.contact_group_members
              WHERE organization_id = org GROUP BY group_id) x), '{}'::jsonb))
$$;
REVOKE ALL ON FUNCTION public.tag_group_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tag_group_counts(uuid) TO authenticated;

-- Exclusão de etiqueta/grupo fica na auditoria.
CREATE OR REPLACE FUNCTION private.audit_tag_group_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.audit_log (organization_id, actor_id, action, target, meta)
  VALUES (OLD.organization_id, auth.uid(), CASE TG_TABLE_NAME WHEN 'tags' THEN 'tag.deleted' ELSE 'group.deleted' END,
          OLD.id::text, jsonb_build_object('name', OLD.name));
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION private.audit_tag_group_delete() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS audit_tag_delete ON public.tags;
CREATE TRIGGER audit_tag_delete AFTER DELETE ON public.tags FOR EACH ROW EXECUTE FUNCTION private.audit_tag_group_delete();
DROP TRIGGER IF EXISTS audit_group_delete ON public.contact_groups;
CREATE TRIGGER audit_group_delete AFTER DELETE ON public.contact_groups FOR EACH ROW EXECUTE FUNCTION private.audit_tag_group_delete();
