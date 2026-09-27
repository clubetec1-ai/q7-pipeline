-- =============================================================================
-- ClubeCRM — mídia nas conversas e status de entrega (etapa 2B).
-- Spec: docs/superpowers/specs/2026-09-24-atendimento-humano-design.md §6
-- Idempotente.
-- =============================================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS media_path text,
  ADD COLUMN IF NOT EXISTS media_mime text,
  ADD COLUMN IF NOT EXISTS media_size bigint,
  ADD COLUMN IF NOT EXISTS media_name text,
  ADD COLUMN IF NOT EXISTS sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS error text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_type_check') THEN
    ALTER TABLE public.messages ADD CONSTRAINT messages_type_check CHECK (type IN
      ('text', 'image', 'audio', 'voice', 'video', 'document', 'sticker', 'location', 'contact', 'template'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_status_check') THEN
    ALTER TABLE public.messages ADD CONSTRAINT messages_status_check
      CHECK (status IS NULL OR status IN ('pending', 'sent', 'delivered', 'read', 'failed'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS messages_provider_message_id_key
  ON public.messages (organization_id, provider_message_id) WHERE provider_message_id IS NOT NULL;

-- Status só anda para frente (sent → delivered → read); failed a qualquer momento.
CREATE OR REPLACE FUNCTION public.service_update_message_status(org uuid, pmid text, new_status text)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.messages
  SET status = new_status
  WHERE organization_id = org AND provider_message_id = pmid
    AND new_status IN ('sent', 'delivered', 'read', 'failed')
    AND (new_status = 'failed'
         OR array_position(ARRAY['pending', 'sent', 'delivered', 'read'], coalesce(status, 'pending'))
          < array_position(ARRAY['pending', 'sent', 'delivered', 'read'], new_status))
$$;
REVOKE ALL ON FUNCTION public.service_update_message_status(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_update_message_status(uuid, text, text) TO service_role;

-- -----------------------------------------------------------------------------
-- Storage privado: media/{org}/{conversa}/{arquivo}
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('media', 'media', false, 104857600, ARRAY[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr', 'audio/webm',
  'video/mp4', 'video/3gpp',
  'application/pdf', 'text/plain', 'text/csv', 'application/zip',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/octet-stream'
])
ON CONFLICT (id) DO UPDATE
  SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Acesso a um arquivo = poder ver a conversa do caminho. Caminho fora do
-- formato devolve falso (sem erro).
CREATE OR REPLACE FUNCTION private.can_access_media(path text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE parts text[] := string_to_array(path, '/'); c public.conversations;
BEGIN
  IF array_length(parts, 1) <> 3
     OR parts[1] !~ '^[0-9a-f-]{36}$' OR parts[2] !~ '^[0-9a-f-]{36}$' OR parts[3] = '' THEN
    RETURN false;
  END IF;
  SELECT * INTO c FROM public.conversations WHERE id = parts[2]::uuid AND organization_id = parts[1]::uuid;
  RETURN c.id IS NOT NULL AND private.can_see_conversation(c.organization_id, c.department_id, c.assigned_to);
END $$;
REVOKE ALL ON FUNCTION private.can_access_media(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_access_media(text) TO authenticated;

DROP POLICY IF EXISTS "media: ler" ON storage.objects;
DROP POLICY IF EXISTS "media: enviar" ON storage.objects;
CREATE POLICY "media: ler" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'media' AND private.can_access_media(name));
CREATE POLICY "media: enviar" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media' AND private.can_access_media(name));
-- Sem update/delete para o navegador.
