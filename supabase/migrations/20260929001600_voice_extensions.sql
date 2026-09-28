-- =============================================================================
-- Ramal (pedido em 29/09): a Clubetec cadastra os ramais do PBX contratado
-- (número, usuário, servidor, senha) e entrega pronto; o dono/admin escolhe o
-- atendente de cada ramal; o atendente usa em WebRTC (telefone no navegador),
-- em "só SIP" (MicroSIP/aparelho, com identificação de quem liga) ou desliga.
--  * Senha do ramal só no Vault. Só volta para o navegador do próprio atendente,
--    com o ramal em WebRTC (o telefone do navegador precisa dela para registrar).
--  * Cadastro/alteração/exclusão do ramal: só operador da plataforma.
--  * Ligações: histórico imutável pelo navegador; cada um vê as suas, quem vê
--    todas as conversas vê todas; outra empresa nunca.
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.pbx_extensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  number text NOT NULL CHECK (number ~ '^[0-9]{2,12}$'),
  sip_user text NOT NULL CHECK (sip_user ~ '^[A-Za-z0-9._@+-]{1,64}$'),
  sip_domain text NOT NULL CHECK (sip_domain ~ '^[A-Za-z0-9.-]{3,253}(:[0-9]{2,5})?$'),
  wss_url text CHECK (wss_url IS NULL OR wss_url ~ '^wss://[A-Za-z0-9.-]{3,253}(:[0-9]{2,5})?(/[A-Za-z0-9._~/-]*)?$'),
  provider text NOT NULL DEFAULT 'handphone' CHECK (provider IN ('handphone', 'nvoip', 'outro')),
  label text CHECK (label IS NULL OR length(label) <= 60),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  mode text NOT NULL DEFAULT 'webrtc' CHECK (mode IN ('webrtc', 'sip', 'off')),
  has_password boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number),
  UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS pbx_extensions_one_per_user ON public.pbx_extensions (organization_id, user_id) WHERE user_id IS NOT NULL;
DROP TRIGGER IF EXISTS update_pbx_extensions_updated_at ON public.pbx_extensions;
CREATE TRIGGER update_pbx_extensions_updated_at BEFORE UPDATE ON public.pbx_extensions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.pbx_extensions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pbx_extensions FROM anon, authenticated;
GRANT SELECT ON public.pbx_extensions TO authenticated;
DROP POLICY IF EXISTS pbx_extensions_select ON public.pbx_extensions;
CREATE POLICY pbx_extensions_select ON public.pbx_extensions FOR SELECT TO authenticated
  USING (private.is_platform_operator()
         OR private.has_permission(organization_id, 'members.manage')
         OR (user_id = (SELECT auth.uid()) AND private.is_member(organization_id)));

CREATE TABLE IF NOT EXISTS public.calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  extension_id uuid,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  phone text NOT NULL CHECK (phone ~ '^[0-9]{2,20}$'),
  contact_id uuid,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing', 'answered', 'missed', 'ended', 'failed')),
  source text NOT NULL CHECK (source IN ('webrtc', 'sip', 'pbx')),
  started_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  ended_at timestamptz,
  duration_s integer CHECK (duration_s IS NULL OR duration_s BETWEEN 0 AND 86400),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (extension_id, organization_id) REFERENCES public.pbx_extensions (id, organization_id) ON DELETE SET NULL (extension_id),
  FOREIGN KEY (contact_id, organization_id) REFERENCES public.contacts (id, organization_id) ON DELETE SET NULL (contact_id)
);
CREATE INDEX IF NOT EXISTS calls_org_started_idx ON public.calls (organization_id, started_at DESC);
CREATE INDEX IF NOT EXISTS calls_contact_idx ON public.calls (contact_id) WHERE contact_id IS NOT NULL;

ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.calls FROM anon, authenticated;
GRANT SELECT ON public.calls TO authenticated;
DROP POLICY IF EXISTS calls_select ON public.calls;
CREATE POLICY calls_select ON public.calls FOR SELECT TO authenticated
  USING (private.is_member(organization_id) AND (
    user_id = (SELECT auth.uid())
    OR private.has_permission(organization_id, 'conversations.view_all')
    OR (contact_id IS NOT NULL AND private.can_see_contact(organization_id, contact_id))));

-- -----------------------------------------------------------------------------
-- Operador da plataforma: cadastra, altera e exclui ramais.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.operator_save_extension(
  org uuid, ext uuid, p_number text, p_sip_user text, p_sip_domain text, p_wss_url text,
  p_provider text, p_label text, p_password text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE rid uuid;
BEGIN
  IF NOT private.is_platform_operator() THEN
    RAISE EXCEPTION 'só a Clubetec cadastra ramais' USING ERRCODE = '42501';
  END IF;
  IF ext IS NULL THEN
    INSERT INTO public.pbx_extensions (organization_id, number, sip_user, sip_domain, wss_url, provider, label)
    VALUES (org, trim(p_number), trim(p_sip_user), lower(trim(p_sip_domain)), nullif(trim(coalesce(p_wss_url, '')), ''),
            coalesce(nullif(p_provider, ''), 'handphone'), nullif(trim(coalesce(p_label, '')), ''))
    RETURNING id INTO rid;
  ELSE
    UPDATE public.pbx_extensions SET number = trim(p_number), sip_user = trim(p_sip_user),
      sip_domain = lower(trim(p_sip_domain)), wss_url = nullif(trim(coalesce(p_wss_url, '')), ''),
      provider = coalesce(nullif(p_provider, ''), 'handphone'), label = nullif(trim(coalesce(p_label, '')), '')
    WHERE id = ext AND organization_id = org
    RETURNING id INTO rid;
    IF rid IS NULL THEN RAISE EXCEPTION 'ramal não encontrado' USING ERRCODE = 'P0002'; END IF;
  END IF;
  IF coalesce(length(p_password), 0) > 0 THEN
    IF length(p_password) > 128 THEN RAISE EXCEPTION 'senha longa demais' USING ERRCODE = '22023'; END IF;
    PERFORM private.put_secret(format('ext:%s:password', rid), p_password);
    UPDATE public.pbx_extensions SET has_password = true WHERE id = rid;
  END IF;
  PERFORM private.audit(org, CASE WHEN ext IS NULL THEN 'extension.created' ELSE 'extension.updated' END,
                        rid::text, jsonb_build_object('number', trim(p_number), 'password_changed', coalesce(length(p_password), 0) > 0));
  RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION public.operator_delete_extension(ext uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e public.pbx_extensions;
BEGIN
  IF NOT private.is_platform_operator() THEN
    RAISE EXCEPTION 'só a Clubetec exclui ramais' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.pbx_extensions WHERE id = ext RETURNING * INTO e;
  IF e.id IS NULL THEN RETURN; END IF;
  DELETE FROM vault.secrets WHERE name = format('ext:%s:password', e.id);
  PERFORM private.audit(e.organization_id, 'extension.deleted', e.id::text, jsonb_build_object('number', e.number));
END $$;

-- -----------------------------------------------------------------------------
-- Dono/admin (ou operador): escolhe o atendente do ramal.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_extension(ext uuid, member uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e public.pbx_extensions;
BEGIN
  SELECT * INTO e FROM public.pbx_extensions WHERE id = ext;
  IF e.id IS NULL OR NOT (private.has_permission(e.organization_id, 'members.manage') OR private.is_platform_operator()) THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  IF member IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.organization_members
      WHERE organization_id = e.organization_id AND user_id = member AND status = 'active') THEN
    RAISE EXCEPTION 'pessoa não é da equipe desta empresa' USING ERRCODE = '42501';
  END IF;
  UPDATE public.pbx_extensions SET user_id = NULL WHERE organization_id = e.organization_id AND user_id = member AND id <> e.id;
  UPDATE public.pbx_extensions SET user_id = member WHERE id = e.id;
  PERFORM private.audit(e.organization_id, 'extension.assigned', e.id::text, jsonb_build_object('number', e.number, 'user', member));
END $$;

-- Modo do ramal: o próprio atendente ou quem gerencia a equipe.
CREATE OR REPLACE FUNCTION public.set_extension_mode(ext uuid, p_mode text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e public.pbx_extensions;
BEGIN
  SELECT * INTO e FROM public.pbx_extensions WHERE id = ext;
  IF e.id IS NULL OR NOT (
       (e.user_id = (SELECT auth.uid()) AND private.has_permission(e.organization_id, 'conversations.attend'))
       OR private.has_permission(e.organization_id, 'members.manage') OR private.is_platform_operator()) THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  IF p_mode NOT IN ('webrtc', 'sip', 'off') THEN RAISE EXCEPTION 'modo inválido' USING ERRCODE = '22023'; END IF;
  UPDATE public.pbx_extensions SET mode = p_mode WHERE id = e.id;
END $$;

-- Ramal de quem está logado. A senha só vem em WebRTC (registro no navegador).
CREATE OR REPLACE FUNCTION public.my_extension(org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e public.pbx_extensions;
BEGIN
  IF NOT private.has_permission(org, 'conversations.attend') THEN RETURN NULL; END IF;
  SELECT * INTO e FROM public.pbx_extensions WHERE organization_id = org AND user_id = (SELECT auth.uid());
  IF e.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id', e.id, 'number', e.number, 'sip_user', e.sip_user, 'sip_domain', e.sip_domain,
    'wss_url', e.wss_url, 'provider', e.provider, 'mode', e.mode, 'has_password', e.has_password,
    'password', CASE WHEN e.mode = 'webrtc' AND e.wss_url IS NOT NULL
                     THEN private.get_secret(format('ext:%s:password', e.id)) END);
END $$;

-- -----------------------------------------------------------------------------
-- Ligações: o atendente registra as suas (WebRTC ou MicroSIP/aparelho).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_call(
  org uuid, call uuid, p_direction text, p_phone text, p_status text, p_source text,
  p_answered_at timestamptz DEFAULT NULL, p_ended_at timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  me uuid := (SELECT auth.uid());
  digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  ct uuid; ex uuid; rid uuid; c public.calls;
BEGIN
  IF NOT private.has_permission(org, 'conversations.attend') THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('ringing', 'answered', 'missed', 'ended', 'failed') THEN
    RAISE EXCEPTION 'situação inválida' USING ERRCODE = '22023';
  END IF;
  IF call IS NOT NULL THEN
    SELECT * INTO c FROM public.calls WHERE id = call AND organization_id = org AND user_id = me;
    IF c.id IS NULL THEN RAISE EXCEPTION 'ligação não encontrada' USING ERRCODE = 'P0002'; END IF;
    IF c.ended_at IS NOT NULL THEN RETURN c.id; END IF; -- encerrada não muda mais
    -- LEAST ignora NULL: só limita ao "agora" quando o horário veio.
    p_answered_at := CASE WHEN p_answered_at IS NOT NULL THEN least(p_answered_at, now()) END;
    p_ended_at := CASE WHEN p_ended_at IS NOT NULL THEN least(p_ended_at, now()) END;
    UPDATE public.calls SET status = p_status,
      answered_at = coalesce(answered_at, p_answered_at),
      ended_at = p_ended_at,
      duration_s = CASE WHEN p_ended_at IS NOT NULL AND coalesce(answered_at, p_answered_at) IS NOT NULL
        THEN greatest(0, least(86400, extract(epoch FROM p_ended_at - coalesce(answered_at, p_answered_at))::int)) END
    WHERE id = c.id;
    RETURN c.id;
  END IF;
  IF p_direction NOT IN ('in', 'out') OR p_source NOT IN ('webrtc', 'sip') OR length(digits) < 2 THEN
    RAISE EXCEPTION 'ligação inválida' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO ex FROM public.pbx_extensions WHERE organization_id = org AND user_id = me;
  -- Cliente pelo final do número (com ou sem 55/DDD/nono dígito), dentro da empresa.
  IF length(digits) >= 8 THEN
    SELECT id INTO ct FROM public.contacts
    WHERE organization_id = org AND anonymized_at IS NULL
      AND right(regexp_replace(phone, '\D', '', 'g'), 8) = right(digits, 8)
    ORDER BY (regexp_replace(phone, '\D', '', 'g') LIKE '%' || right(digits, 10)) DESC, updated_at DESC LIMIT 1;
  END IF;
  INSERT INTO public.calls (organization_id, extension_id, user_id, direction, phone, contact_id, status, source)
  VALUES (org, ex, me, p_direction, digits, ct, p_status, p_source)
  RETURNING id INTO rid;
  RETURN rid;
END $$;

-- Quem está ligando? Só entre os clientes que a pessoa pode ver (RLS).
CREATE OR REPLACE FUNCTION public.lookup_caller(org uuid, p_phone text)
RETURNS TABLE (contact_id uuid, name text, phone text, conversation_id uuid, channel text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH d AS (SELECT regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') AS digits)
  SELECT c.id, c.name, c.phone,
    (SELECT cv.id FROM public.conversations cv WHERE cv.contact_id = c.id ORDER BY cv.last_message_at DESC NULLS LAST LIMIT 1),
    (SELECT cv.channel FROM public.conversations cv WHERE cv.contact_id = c.id ORDER BY cv.last_message_at DESC NULLS LAST LIMIT 1)
  FROM public.contacts c, d
  WHERE c.organization_id = org AND length(d.digits) >= 8 AND c.anonymized_at IS NULL
    AND right(regexp_replace(c.phone, '\D', '', 'g'), 8) = right(d.digits, 8)
  ORDER BY (regexp_replace(c.phone, '\D', '', 'g') LIKE '%' || right(d.digits, 10)) DESC, c.updated_at DESC
  LIMIT 5
$$;

REVOKE ALL ON FUNCTION public.operator_save_extension(uuid, uuid, text, text, text, text, text, text, text),
  public.operator_delete_extension(uuid), public.assign_extension(uuid, uuid), public.set_extension_mode(uuid, text),
  public.my_extension(uuid), public.log_call(uuid, uuid, text, text, text, text, timestamptz, timestamptz),
  public.lookup_caller(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_save_extension(uuid, uuid, text, text, text, text, text, text, text),
  public.operator_delete_extension(uuid), public.assign_extension(uuid, uuid), public.set_extension_mode(uuid, text),
  public.my_extension(uuid), public.log_call(uuid, uuid, text, text, text, text, timestamptz, timestamptz),
  public.lookup_caller(uuid, text) TO authenticated;
