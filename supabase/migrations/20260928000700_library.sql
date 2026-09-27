-- =============================================================================
-- Biblioteca de arquivos da empresa
--  * library_files: catálogo; arquivos em media/{org}/library/{arquivo}.
--  * Ler: qualquer membro da organização (atendente envia, IA usa).
--    Subir/apagar/editar: library.manage. Nunca de outra organização.
--  * Resposta rápida pode levar um arquivo da biblioteca.
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.library_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description text CHECK (description IS NULL OR char_length(description) <= 500),
  media_path text NOT NULL,
  mime text,
  size bigint,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  UNIQUE (media_path),
  -- O arquivo precisa estar na pasta da própria organização.
  CHECK (media_path LIKE organization_id::text || '/library/%' AND media_path NOT LIKE '%..%')
);
CREATE INDEX IF NOT EXISTS library_files_org_idx ON public.library_files (organization_id, name);

ALTER TABLE public.library_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.library_files FROM anon;
GRANT SELECT, INSERT, DELETE ON public.library_files TO authenticated;
GRANT UPDATE (name, description) ON public.library_files TO authenticated;
DROP POLICY IF EXISTS "org: ver" ON public.library_files;
DROP POLICY IF EXISTS "org: gerenciar" ON public.library_files;
CREATE POLICY "org: ver" ON public.library_files FOR SELECT TO authenticated
  USING (private.is_member(organization_id));
CREATE POLICY "org: gerenciar" ON public.library_files FOR ALL TO authenticated
  USING (private.has_permission(organization_id, 'library.manage'))
  WITH CHECK (private.has_permission(organization_id, 'library.manage'));

-- Storage: media/{org}/library/{arquivo}
CREATE OR REPLACE FUNCTION private.library_org(path text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE parts text[] := string_to_array(path, '/');
BEGIN
  IF array_length(parts, 1) <> 3 OR parts[1] !~ '^[0-9a-f-]{36}$' OR parts[2] <> 'library'
     OR parts[3] !~ '^[A-Za-z0-9._-]{1,120}$' THEN
    RETURN NULL;
  END IF;
  RETURN parts[1]::uuid;
END $$;
REVOKE ALL ON FUNCTION private.library_org(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.library_org(text) TO authenticated;

DROP POLICY IF EXISTS "library: ler" ON storage.objects;
DROP POLICY IF EXISTS "library: enviar" ON storage.objects;
DROP POLICY IF EXISTS "library: apagar" ON storage.objects;
CREATE POLICY "library: ler" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'media' AND private.is_member(private.library_org(name)));
CREATE POLICY "library: enviar" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media' AND private.has_permission(private.library_org(name), 'library.manage'));
CREATE POLICY "library: apagar" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'media' AND private.has_permission(private.library_org(name), 'library.manage'));

-- Resposta rápida com arquivo (apagar o arquivo só desliga o anexo).
ALTER TABLE public.quick_replies ADD COLUMN IF NOT EXISTS library_file_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quick_replies_library_file_fk') THEN
    ALTER TABLE public.quick_replies ADD CONSTRAINT quick_replies_library_file_fk
      FOREIGN KEY (library_file_id, organization_id) REFERENCES public.library_files (id, organization_id)
      ON DELETE SET NULL (library_file_id);
  END IF;
END $$;
