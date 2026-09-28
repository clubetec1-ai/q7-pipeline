-- =============================================================================
-- Ramal online? (pedido em 29/09) O telefone do atendente (WebRTC) informa se
-- registrou na central, com um sinal a cada 2 min; a Clubetec e o dono veem em
-- Plataforma/Equipe. MicroSIP/aparelho não é monitorado pelo navegador.
-- Só o atendente do ramal informa o status do próprio ramal.
-- Idempotente.
-- =============================================================================

ALTER TABLE public.pbx_extensions
  ADD COLUMN IF NOT EXISTS reg_state text,
  ADD COLUMN IF NOT EXISTS reg_detail text,
  ADD COLUMN IF NOT EXISTS reg_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pbx_extensions_reg_state_check') THEN
    ALTER TABLE public.pbx_extensions ADD CONSTRAINT pbx_extensions_reg_state_check
      CHECK (reg_state IS NULL OR reg_state IN ('online', 'offline', 'error'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.report_extension_status(ext uuid, p_state text, p_detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e public.pbx_extensions;
BEGIN
  SELECT * INTO e FROM public.pbx_extensions WHERE id = ext;
  IF e.id IS NULL OR e.user_id IS DISTINCT FROM (SELECT auth.uid())
     OR NOT private.has_permission(e.organization_id, 'conversations.attend') THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  IF p_state NOT IN ('online', 'offline', 'error') THEN RAISE EXCEPTION 'situação inválida' USING ERRCODE = '22023'; END IF;
  UPDATE public.pbx_extensions
  SET reg_state = p_state, reg_detail = left(nullif(trim(coalesce(p_detail, '')), ''), 160), reg_at = now()
  WHERE id = e.id;
END $$;
REVOKE ALL ON FUNCTION public.report_extension_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_extension_status(uuid, text, text) TO authenticated;

-- Sem endereço WebRTC (wss) não há telefone no navegador: o modo vira MicroSIP/aparelho.
CREATE OR REPLACE FUNCTION private.extension_mode_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.wss_url IS NULL AND NEW.mode = 'webrtc' THEN NEW.mode := 'sip'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.extension_mode_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS extension_mode_guard ON public.pbx_extensions;
CREATE TRIGGER extension_mode_guard BEFORE INSERT OR UPDATE ON public.pbx_extensions
  FOR EACH ROW EXECUTE FUNCTION private.extension_mode_guard();
UPDATE public.pbx_extensions SET mode = 'sip' WHERE wss_url IS NULL AND mode = 'webrtc';

-- Instalação dos ramais pela Clubetec: lista da equipe da empresa (nome, e-mail,
-- papel) para já associar cada ramal a uma pessoa. Só operador; nada de conversa.
CREATE OR REPLACE FUNCTION public.operator_org_members(org uuid)
RETURNS TABLE (user_id uuid, name text, email text, role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_operator() THEN
    RAISE EXCEPTION 'só a Clubetec' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT m.user_id, coalesce(nullif(trim(m.display_name), ''), split_part(u.email, '@', 1))::text, u.email::text, m.role::text
  FROM public.organization_members m JOIN auth.users u ON u.id = m.user_id
  WHERE m.organization_id = org AND m.status = 'active'
  ORDER BY 2;
END $$;
REVOKE ALL ON FUNCTION public.operator_org_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_org_members(uuid) TO authenticated;
