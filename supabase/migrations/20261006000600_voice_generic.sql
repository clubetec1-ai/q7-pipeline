-- =============================================================================
-- Telefonia genérica pré-configurada (Fase 3, item 15).
--  * O dono/admin cadastra a central (qualquer SIP com WebRTC/WSS: Asterisk/FreePBX,
--    3CX, Nvoip, Handphone ou outra) e os ramais sozinho; senha só no Vault.
--    O operador da Clubetec continua podendo fazer por ele.
--  * Histórico de ligações de qualquer central pela API aberta (POST /calls,
--    permissão "calls:write" na chave) — sem código por fornecedor.
-- Idempotente.
-- =============================================================================
ALTER TABLE public.pbx_extensions DROP CONSTRAINT IF EXISTS pbx_extensions_provider_check;
ALTER TABLE public.pbx_extensions ADD CONSTRAINT pbx_extensions_provider_check
  CHECK (provider IN ('handphone', 'nvoip', 'asterisk', '3cx', 'outro'));

ALTER TABLE public.api_keys DROP CONSTRAINT IF EXISTS api_keys_scopes_check;
ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_scopes_check CHECK (cardinality(scopes) >= 1
  AND scopes <@ ARRAY['contacts:read', 'contacts:write', 'messages:send', 'conversations:read', 'funnel:write', 'calls:write']);

-- Cadastrar/alterar ramal: dono/admin da empresa (com o módulo) ou operador.
CREATE OR REPLACE FUNCTION public.save_extension(
  org uuid, ext uuid, p_number text, p_sip_user text, p_sip_domain text, p_wss_url text,
  p_provider text, p_label text, p_password text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE rid uuid; prov text := coalesce(nullif(p_provider, ''), 'outro');
BEGIN
  IF NOT (private.has_permission(org, 'org.settings') OR private.is_platform_operator()) THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  PERFORM private.require_module(org, 'telefonia');
  IF ext IS NULL AND (SELECT count(*) FROM public.pbx_extensions WHERE organization_id = org) >= 100 THEN
    RAISE EXCEPTION 'limite de 100 ramais' USING ERRCODE = '22023';
  END IF;
  IF ext IS NULL THEN
    INSERT INTO public.pbx_extensions (organization_id, number, sip_user, sip_domain, wss_url, provider, label)
    VALUES (org, trim(p_number), trim(p_sip_user), lower(trim(p_sip_domain)), nullif(trim(coalesce(p_wss_url, '')), ''),
            prov, nullif(trim(coalesce(p_label, '')), ''))
    RETURNING id INTO rid;
  ELSE
    UPDATE public.pbx_extensions SET number = trim(p_number), sip_user = trim(p_sip_user),
      sip_domain = lower(trim(p_sip_domain)), wss_url = nullif(trim(coalesce(p_wss_url, '')), ''),
      provider = prov, label = nullif(trim(coalesce(p_label, '')), '')
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
                        rid::text, jsonb_build_object('number', trim(p_number), 'provider', prov, 'password_changed', coalesce(length(p_password), 0) > 0));
  RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.save_extension(uuid, uuid, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_extension(uuid, uuid, text, text, text, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_extension(ext uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e public.pbx_extensions;
BEGIN
  SELECT * INTO e FROM public.pbx_extensions WHERE id = ext;
  IF e.id IS NULL OR NOT (private.has_permission(e.organization_id, 'org.settings') OR private.is_platform_operator()) THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.pbx_extensions WHERE id = e.id;
  DELETE FROM vault.secrets WHERE name = format('ext:%s:password', e.id);
  PERFORM private.audit(e.organization_id, 'extension.deleted', e.id::text, jsonb_build_object('number', e.number));
END $$;
REVOKE ALL ON FUNCTION public.delete_extension(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_extension(uuid) TO authenticated;
