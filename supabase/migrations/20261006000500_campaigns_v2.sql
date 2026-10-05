-- =============================================================================
-- Campanhas (Fase 3, item 19a): teste A/B, arquivo da biblioteca e resultado.
--  * A/B: segunda versão (texto, ou modelo no número oficial); ao iniciar, os
--    contatos são alternados entre A e B.
--  * Arquivo da biblioteca (só número por QR Code — no oficial, fora das 24h, só
--    modelo aprovado): vai junto, com o texto como legenda.
--  * Resultado: quem respondeu em até 7 dias depois do envio e quem saiu da lista,
--    por versão.
-- Idempotente.
-- =============================================================================
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS message_b text CHECK (message_b IS NULL OR char_length(message_b) <= 4000);
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS template_name_b text CHECK (template_name_b IS NULL OR template_name_b ~ '^[a-z0-9_]{1,512}$');
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS library_file_id uuid REFERENCES public.library_files(id) ON DELETE SET NULL;
ALTER TABLE public.campaign_recipients ADD COLUMN IF NOT EXISTS variant text NOT NULL DEFAULT 'A' CHECK (variant IN ('A', 'B'));
GRANT INSERT (message_b, template_name_b, library_file_id), UPDATE (message_b, template_name_b, library_file_id) ON public.campaigns TO authenticated;

-- Guarda: número, grupos e arquivo só da própria empresa.
CREATE OR REPLACE FUNCTION private.campaign_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft' AND current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'campanha já iniciada não pode ser editada' USING ERRCODE = '42501';
  END IF;
  IF NEW.instance_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.whatsapp_instances i WHERE i.id = NEW.instance_id AND i.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'número inválido' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(NEW.group_ids) g
             WHERE NOT EXISTS (SELECT 1 FROM public.contact_groups cg WHERE cg.id = g AND cg.organization_id = NEW.organization_id)) THEN
    RAISE EXCEPTION 'grupo inválido' USING ERRCODE = '42501';
  END IF;
  IF NEW.library_file_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.library_files f WHERE f.id = NEW.library_file_id AND f.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'arquivo inválido' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- Iniciar: congela a lista e, com A/B, alterna as versões.
CREATE OR REPLACE FUNCTION public.start_campaign(campaign uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.campaigns; inst public.whatsapp_instances; n integer; ab boolean;
BEGIN
  SELECT * INTO c FROM public.campaigns WHERE id = campaign FOR UPDATE;
  IF c.id IS NULL OR NOT private.has_permission(c.organization_id, 'campaigns.manage') THEN
    RAISE EXCEPTION 'campanha não encontrada' USING ERRCODE = '42501';
  END IF;
  IF c.status <> 'draft' THEN RAISE EXCEPTION 'campanha já iniciada' USING ERRCODE = '22023'; END IF;
  SELECT * INTO inst FROM public.whatsapp_instances WHERE id = c.instance_id AND organization_id = c.organization_id;
  IF inst.id IS NULL OR inst.status = 'disabled' THEN RAISE EXCEPTION 'escolha um número ativo' USING ERRCODE = '22023'; END IF;
  IF inst.provider = 'cloud' AND (c.template_name IS NULL OR c.template_lang IS NULL) THEN
    RAISE EXCEPTION 'número da Meta precisa de modelo aprovado' USING ERRCODE = '22023';
  END IF;
  IF inst.provider = 'cloud' AND c.library_file_id IS NOT NULL THEN
    RAISE EXCEPTION 'no número oficial da Meta o arquivo não vai junto (só modelo aprovado)' USING ERRCODE = '22023';
  END IF;
  IF inst.provider <> 'cloud' AND coalesce(btrim(c.message), '') = '' THEN
    RAISE EXCEPTION 'escreva a mensagem' USING ERRCODE = '22023';
  END IF;
  IF cardinality(c.group_ids) = 0 THEN RAISE EXCEPTION 'escolha ao menos um grupo' USING ERRCODE = '22023'; END IF;
  ab := CASE WHEN inst.provider = 'cloud' THEN c.template_name_b IS NOT NULL ELSE coalesce(btrim(c.message_b), '') <> '' END;

  INSERT INTO public.campaign_recipients (organization_id, campaign_id, contact_id, phone, name, status, error)
  SELECT DISTINCT ON (ct.id) c.organization_id, c.id, ct.id, ct.phone, ct.name,
         CASE WHEN ct.opted_out_at IS NOT NULL OR ct.anonymized_at IS NOT NULL THEN 'skipped' ELSE 'pending' END,
         CASE WHEN ct.opted_out_at IS NOT NULL THEN 'pediu para não receber' WHEN ct.anonymized_at IS NOT NULL THEN 'anonimizado' END
  FROM public.contact_group_members m
  JOIN public.contacts ct ON ct.id = m.contact_id AND ct.organization_id = c.organization_id
  WHERE m.organization_id = c.organization_id AND m.group_id = ANY (c.group_ids) AND coalesce(ct.phone, '') <> ''
  ON CONFLICT (campaign_id, contact_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RAISE EXCEPTION 'nenhum contato com telefone nesses grupos' USING ERRCODE = '22023'; END IF;

  IF ab THEN
    UPDATE public.campaign_recipients r SET variant = 'B'
    FROM (SELECT id, row_number() OVER (ORDER BY id) rn FROM public.campaign_recipients WHERE campaign_id = c.id) x
    WHERE r.id = x.id AND x.rn % 2 = 0;
  END IF;

  UPDATE public.campaigns SET status = 'running', started_at = now(),
    total = n, skipped = (SELECT count(*) FROM public.campaign_recipients r WHERE r.campaign_id = c.id AND r.status = 'skipped')
  WHERE id = c.id;
  INSERT INTO public.audit_log (organization_id, actor_id, action, target, meta)
  VALUES (c.organization_id, auth.uid(), 'campaign.start', c.id::text, jsonb_build_object('total', n, 'ab', ab));
  RETURN jsonb_build_object('ok', true, 'total', n);
END $$;

-- Resultado por versão: enviados, responderam (até 7 dias depois do envio) e saíram da lista.
CREATE OR REPLACE FUNCTION public.campaign_results(campaign uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.campaigns; out jsonb;
BEGIN
  SELECT * INTO c FROM public.campaigns WHERE id = campaign;
  IF c.id IS NULL OR NOT private.has_permission(c.organization_id, 'campaigns.manage') THEN
    RAISE EXCEPTION 'campanha não encontrada' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('versao', v.variant, 'enviados', v.enviados, 'responderam', v.responderam, 'sairam', v.sairam)
         ORDER BY v.variant), '[]'::jsonb) INTO out
  FROM (
    SELECT r.variant,
      count(*) FILTER (WHERE r.status = 'sent') enviados,
      count(*) FILTER (WHERE r.status = 'sent' AND EXISTS (
        SELECT 1 FROM public.conversations cv JOIN public.messages m ON m.conversation_id = cv.id AND m.organization_id = c.organization_id
        WHERE cv.organization_id = c.organization_id AND cv.instance_id = c.instance_id AND cv.contact_phone = r.phone
          AND m.direction = 'inbound' AND m.created_at > r.sent_at AND m.created_at <= r.sent_at + interval '7 days')) responderam,
      count(*) FILTER (WHERE r.status = 'sent' AND EXISTS (
        SELECT 1 FROM public.contacts ct WHERE ct.id = r.contact_id AND ct.organization_id = c.organization_id AND ct.opted_out_at > r.sent_at)) sairam
    FROM public.campaign_recipients r
    WHERE r.campaign_id = c.id AND r.organization_id = c.organization_id
    GROUP BY r.variant
  ) v;
  RETURN out;
END $$;
REVOKE ALL ON FUNCTION public.campaign_results(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.campaign_results(uuid) TO authenticated;
