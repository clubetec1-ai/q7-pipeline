-- =============================================================================
-- IA lê imagens e PDFs recebidos
--  * messages.media_text: descrição da imagem (modelo com visão da IA da empresa)
--    ou texto do PDF. Entra no histórico da IA de atendimento e aparece para o
--    atendente como "Lido pela IA". Liga/desliga: settings.ai_read_media.
--  * Navegador não grava (UPDATE em messages já é bloqueado).
--  * Anonimização LGPD passa a limpar media_text também.
-- Idempotente.
-- =============================================================================

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_text text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_media_text_len') THEN
    ALTER TABLE public.messages ADD CONSTRAINT messages_media_text_len CHECK (media_text IS NULL OR char_length(media_text) <= 8000);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.service_anonymize_contact(org uuid, contact uuid, actor uuid, reason text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ct public.contacts;
  convs uuid[];
  media text[];
  tag text;
BEGIN
  SELECT * INTO ct FROM public.contacts WHERE id = contact AND organization_id = org FOR UPDATE;
  IF ct.id IS NULL THEN RAISE EXCEPTION 'contato não encontrado' USING ERRCODE = '42501'; END IF;
  IF ct.anonymized_at IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already', true, 'media', '[]'::jsonb); END IF;
  tag := 'anon-' || left(replace(ct.id::text, '-', ''), 10);

  SELECT array_agg(id) INTO convs FROM public.conversations
  WHERE organization_id = org AND (contact_id = contact
     OR (ct.phone IS NOT NULL AND contact_phone = ct.phone)
     OR (ct.email IS NOT NULL AND lower(contact_email) = lower(ct.email)));
  convs := coalesce(convs, '{}');

  SELECT array_agg(media_path) INTO media FROM public.messages
  WHERE organization_id = org AND conversation_id = ANY (convs) AND media_path IS NOT NULL;

  UPDATE public.messages SET content = '[conteúdo removido — LGPD]', media_path = NULL, media_name = NULL, media_text = NULL,
    email_subject = CASE WHEN email_subject IS NULL THEN NULL ELSE '[removido — LGPD]' END
  WHERE organization_id = org AND conversation_id = ANY (convs);
  UPDATE public.internal_notes SET content = '[nota removida — LGPD]'
  WHERE organization_id = org AND conversation_id = ANY (convs);
  UPDATE public.tickets SET rating_comment = NULL WHERE organization_id = org AND conversation_id = ANY (convs);
  UPDATE public.flow_runs SET vars = '{}'::jsonb WHERE organization_id = org AND conversation_id = ANY (convs);
  UPDATE public.followups SET text_override = NULL WHERE organization_id = org AND conversation_id = ANY (convs);
  UPDATE public.conversations SET contact_id = contact, contact_name = 'Anonimizado',
    contact_phone = CASE WHEN channel = 'email' THEN NULL ELSE tag || '-' || left(replace(id::text, '-', ''), 6) END,
    contact_email = CASE WHEN channel = 'email' THEN tag || '-' || left(replace(id::text, '-', ''), 6) || '@anonimizado.invalid' END
  WHERE organization_id = org AND id = ANY (convs);
  IF coalesce(ct.phone, '') <> '' THEN
    UPDATE public.inbound_events SET payload = '{}'::jsonb
    WHERE organization_id = org AND payload::text LIKE '%' || ct.phone || '%';
  END IF;
  UPDATE public.campaign_recipients SET phone = tag, name = NULL WHERE organization_id = org AND contact_id = contact;
  DELETE FROM public.contact_tags WHERE organization_id = org AND contact_id = contact;
  DELETE FROM public.contact_group_members WHERE organization_id = org AND contact_id = contact;
  UPDATE public.contacts SET name = 'Anonimizado', phone = NULL, email = NULL, document = NULL, notes = NULL,
    custom = '{}'::jsonb, anonymized_at = now(), opted_out_at = coalesce(opted_out_at, now())
  WHERE id = contact;

  INSERT INTO public.audit_log (organization_id, actor_id, action, target, meta)
  VALUES (org, actor, 'contact.anonymize', contact::text,
          jsonb_build_object('motivo', left(coalesce(reason, ''), 300), 'conversas', cardinality(convs), 'arquivos', coalesce(cardinality(media), 0)));
  RETURN jsonb_build_object('ok', true, 'conversations', cardinality(convs), 'media', to_jsonb(coalesce(media, '{}')));
END $$;
REVOKE ALL ON FUNCTION public.service_anonymize_contact(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_anonymize_contact(uuid, uuid, uuid, text) TO service_role;
