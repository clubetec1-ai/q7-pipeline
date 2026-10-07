-- Etapa B, item 6 (atendimento), parte 1. Idempotente.
--  1. Exportação de contatos com limite e marca d'água: no máximo 3 exportações por pessoa a cada 24 h e 20 mil contatos
--     por arquivo; cada arquivo leva um código único (registrado na auditoria) — se o arquivo vazar, dá para saber quem
--     exportou e quando.
--  2. Pedido do titular pelo WhatsApp (LGPD art. 18): "quero que apaguem meus dados" vira um pedido para o dono/admin,
--     com aviso no sino; anonimizar o contato fecha o pedido; recusar exige o motivo (ex.: guarda obrigatória por lei).

-- 1. Exportação
CREATE OR REPLACE FUNCTION public.export_contacts(org uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE rows jsonb; n integer; code text; feitas int;
BEGIN
  IF NOT private.is_member(org) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem acesso');
  END IF;
  IF NOT private.has_permission(org, 'contacts.export') THEN
    PERFORM private.security_alert(org, 'export_denied', jsonb_build_object('what', 'contacts'));
    RETURN jsonb_build_object('ok', false, 'error',
      'Você não tem permissão para exportar contatos. O dono e os administradores foram avisados.');
  END IF;
  SELECT count(*) INTO feitas FROM public.audit_log
  WHERE organization_id = org AND actor_id = auth.uid() AND action = 'contacts.export' AND created_at > now() - interval '24 hours';
  IF feitas >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Limite de 3 exportações a cada 24 horas por pessoa. Use o arquivo que já exportou ou tente amanhã.');
  END IF;
  SELECT count(*) INTO n FROM public.contacts c WHERE c.organization_id = org;
  IF n > 20000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Mais de 20 mil contatos: peça a exportação completa ao suporte (fica registrada).');
  END IF;
  code := 'EXP-' || upper(encode(extensions.gen_random_bytes(4), 'hex'));
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'nome', c.name, 'telefone', c.phone, 'email', c.email, 'documento', c.document,
           'criado_em', c.created_at) ORDER BY c.created_at), '[]'::jsonb)
    INTO rows
  FROM public.contacts c WHERE c.organization_id = org;
  INSERT INTO public.audit_log (organization_id, actor_id, action, target, meta)
  VALUES (org, auth.uid(), 'contacts.export', code, jsonb_build_object('count', n, 'codigo', code));
  RETURN jsonb_build_object('ok', true, 'rows', rows, 'count', n, 'codigo', code,
    'marca', 'Exportado por ' || coalesce((SELECT email FROM auth.users WHERE id = auth.uid()), 'usuário') || ' em ' ||
             to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || ' — código ' || code ||
             ' — uso restrito à empresa, dados pessoais protegidos pela LGPD; não compartilhe.');
END $$;
REVOKE ALL ON FUNCTION public.export_contacts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.export_contacts(uuid) TO authenticated;

-- 2. Pedido do titular
CREATE TABLE IF NOT EXISTS public.lgpd_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  canal text NOT NULL DEFAULT 'whatsapp' CHECK (canal IN ('whatsapp', 'email', 'messenger', 'instagram', 'outro')),
  status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'atendido', 'recusado')),
  motivo text CHECK (motivo IS NULL OR char_length(motivo) <= 1000),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lgpd_requests_open_uq ON public.lgpd_requests (contact_id) WHERE status = 'aberto';
CREATE INDEX IF NOT EXISTS lgpd_requests_org_idx ON public.lgpd_requests (organization_id, status, created_at DESC);
ALTER TABLE public.lgpd_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lgpd_requests FROM anon, authenticated;
GRANT SELECT ON public.lgpd_requests TO authenticated;
DROP POLICY IF EXISTS "ler: dono e admin" ON public.lgpd_requests;
CREATE POLICY "ler: dono e admin" ON public.lgpd_requests FOR SELECT TO authenticated USING (private.has_permission(organization_id, 'org.settings'));

-- Servidor: registra o pedido (um aberto por contato) e avisa dono/admin. Devolve true se é pedido novo.
CREATE OR REPLACE FUNCTION public.service_lgpd_request_create(org uuid, p_contact uuid, p_conv uuid, p_canal text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE rid uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.contacts WHERE id = p_contact AND organization_id = org) THEN
    RAISE EXCEPTION 'contato não encontrado nesta empresa' USING ERRCODE = '22023';
  END IF;
  IF p_conv IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.conversations WHERE id = p_conv AND organization_id = org) THEN
    RAISE EXCEPTION 'conversa não encontrada nesta empresa' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.lgpd_requests (organization_id, contact_id, conversation_id, canal)
  VALUES (org, p_contact, p_conv, CASE WHEN p_canal IN ('whatsapp', 'email', 'messenger', 'instagram') THEN p_canal ELSE 'outro' END)
  ON CONFLICT (contact_id) WHERE status = 'aberto' DO NOTHING RETURNING id INTO rid;
  IF rid IS NULL THEN RETURN false; END IF;
  PERFORM private.notify_org_admins(org, 'lgpd_request', jsonb_build_object('id', rid, 'contact_id', p_contact, 'conversation_id', p_conv));
  PERFORM private.audit(org, 'lgpd.request', rid::text, jsonb_build_object('canal', p_canal), 'system', 'titular');
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.service_lgpd_request_create(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_lgpd_request_create(uuid, uuid, uuid, text) TO service_role;

-- Dono/admin recusa com motivo (ex.: guarda obrigatória por lei). Atender = anonimizar o contato (fecha sozinho).
CREATE OR REPLACE FUNCTION public.decline_lgpd_request(p_id uuid, p_motivo text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.lgpd_requests; m text := nullif(left(btrim(coalesce(p_motivo, '')), 1000), '');
BEGIN
  SELECT * INTO r FROM public.lgpd_requests WHERE id = p_id FOR UPDATE;
  IF r.id IS NULL OR NOT private.has_permission(r.organization_id, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF r.status <> 'aberto' THEN RAISE EXCEPTION 'este pedido já foi decidido' USING ERRCODE = '22023'; END IF;
  IF m IS NULL OR char_length(m) < 10 THEN RAISE EXCEPTION 'escreva o motivo da recusa (a pessoa tem direito de saber)' USING ERRCODE = '22023'; END IF;
  UPDATE public.lgpd_requests SET status = 'recusado', motivo = m, decided_by = auth.uid(), decided_at = now() WHERE id = p_id;
  PERFORM private.audit(r.organization_id, 'lgpd.declined', p_id::text, '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.decline_lgpd_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_lgpd_request(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION private.lgpd_request_on_anonymize()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.anonymized_at IS NOT NULL AND OLD.anonymized_at IS NULL THEN
    UPDATE public.lgpd_requests SET status = 'atendido', decided_at = now(), decided_by = auth.uid()
    WHERE contact_id = NEW.id AND organization_id = NEW.organization_id AND status = 'aberto';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.lgpd_request_on_anonymize() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS lgpd_request_on_anonymize ON public.contacts;
CREATE TRIGGER lgpd_request_on_anonymize AFTER UPDATE OF anonymized_at ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION private.lgpd_request_on_anonymize();
