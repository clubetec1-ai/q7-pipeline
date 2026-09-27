-- =============================================================================
-- Nome da pessoa na equipe (por organização)
--  * organization_members.display_name: o nome que a equipe e o cliente veem.
--    Fica por organização — o admin de uma empresa nunca altera como a pessoa
--    aparece em outra (profiles é global).
--  * set_member_name: a própria pessoa define UMA vez (se estiver vazio);
--    depois só quem tem members.manage (dono/admin). O nome do dono, só o dono.
--  * A coluna não é gravável direto pelo navegador (GRANT por coluna).
-- Idempotente.
-- =============================================================================

ALTER TABLE public.organization_members ADD COLUMN IF NOT EXISTS display_name text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organization_members_display_name_len') THEN
    ALTER TABLE public.organization_members ADD CONSTRAINT organization_members_display_name_len
      CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 2 AND 80);
  END IF;
END $$;

-- Quem já tinha nome no perfil continua com ele.
UPDATE public.organization_members m SET display_name = left(trim(p.full_name), 80)
FROM public.profiles p
WHERE p.user_id = m.user_id AND m.display_name IS NULL AND char_length(trim(coalesce(p.full_name, ''))) >= 2;

-- Membro novo começa com o nome do cadastro, se houver.
CREATE OR REPLACE FUNCTION private.member_default_name()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.display_name IS NULL THEN
    SELECT left(trim(full_name), 80) INTO NEW.display_name FROM public.profiles
    WHERE user_id = NEW.user_id AND char_length(trim(coalesce(full_name, ''))) >= 2;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.member_default_name() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS member_default_name ON public.organization_members;
CREATE TRIGGER member_default_name BEFORE INSERT ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION private.member_default_name();

CREATE OR REPLACE FUNCTION public.set_member_name(org uuid, member uuid, name text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.organization_members; v text := trim(regexp_replace(coalesce(name, ''), '\s+', ' ', 'g'));
BEGIN
  SELECT * INTO m FROM public.organization_members WHERE organization_id = org AND user_id = member;
  IF m.user_id IS NULL OR NOT private.is_member(org) THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  IF NOT (
       (member = (SELECT auth.uid()) AND coalesce(m.display_name, '') = '')          -- primeira vez, a própria pessoa
    OR (private.has_permission(org, 'members.manage')
        AND (m.role <> 'owner' OR private.has_permission(org, 'org.billing')))       -- dono/admin; nome do dono só o dono
  ) THEN
    RAISE EXCEPTION 'só o dono ou um admin pode alterar o nome' USING ERRCODE = '42501';
  END IF;
  IF char_length(v) < 2 OR char_length(v) > 80 THEN
    RAISE EXCEPTION 'o nome precisa ter de 2 a 80 caracteres' USING ERRCODE = '22023';
  END IF;
  UPDATE public.organization_members SET display_name = v WHERE organization_id = org AND user_id = member;
  PERFORM private.audit(org, 'member.renamed', member::text,
    jsonb_build_object('self', member = (SELECT auth.uid()), 'first', coalesce(m.display_name, '') = ''));
END $$;
REVOKE ALL ON FUNCTION public.set_member_name(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_name(uuid, uuid, text) TO authenticated;
