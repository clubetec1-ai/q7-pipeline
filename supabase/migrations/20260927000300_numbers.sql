-- =============================================================================
-- ClubeCRM — vários números por organização (etapa 4A).
-- Spec: docs/superpowers/specs/2026-09-24-multiplos-numeros-design.md §7, §8, §11
-- Idempotente.
-- =============================================================================

ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS connected_via text,
  ADD COLUMN IF NOT EXISTS health_status text,
  ADD COLUMN IF NOT EXISTS health_error text,
  ADD COLUMN IF NOT EXISTS quality_rating text,
  ADD COLUMN IF NOT EXISTS messaging_limit_tier text,
  ADD COLUMN IF NOT EXISTS last_health_check_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_instances_connected_via_check') THEN
    ALTER TABLE public.whatsapp_instances ADD CONSTRAINT whatsapp_instances_connected_via_check
      CHECK (connected_via IS NULL OR connected_via IN ('embedded_signup', 'manual', 'qr'));
  END IF;
END $$;

-- O mesmo número da Meta não pode estar em duas organizações.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_instances_phone_number_id_key
  ON public.whatsapp_instances (phone_number_id) WHERE phone_number_id IS NOT NULL;

-- Limite de números do plano (settings.max_numbers; padrão 5). Conferido no
-- servidor antes de criar número.
CREATE OR REPLACE FUNCTION public.service_can_add_number(org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT count(*) FROM public.whatsapp_instances WHERE organization_id = org)
       < coalesce((SELECT (settings ->> 'max_numbers')::int FROM public.organizations WHERE id = org), 5)
$$;
REVOKE ALL ON FUNCTION public.service_can_add_number(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_can_add_number(uuid) TO service_role;

-- Remoção de segredo ao excluir um número (só service_role, só nomes de instância).
CREATE OR REPLACE FUNCTION public.service_delete_instance_secrets(instance uuid)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM vault.secrets WHERE name LIKE format('instance:%s:%%', instance)
$$;
REVOKE ALL ON FUNCTION public.service_delete_instance_secrets(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_delete_instance_secrets(uuid) TO service_role;

-- Auditoria de números: conectar, mudar status e excluir.
CREATE OR REPLACE FUNCTION private.audit_instance_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM private.audit(NEW.organization_id, 'number.connected', NEW.id::text,
      jsonb_build_object('provider', NEW.provider, 'via', NEW.connected_via));
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status AND 'disabled' IN (NEW.status, OLD.status) THEN
      PERFORM private.audit(NEW.organization_id, 'number.status', NEW.id::text,
        jsonb_build_object('status', jsonb_build_array(OLD.status, NEW.status)));
    END IF;
  ELSIF EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.organization_id) THEN
    PERFORM private.audit(OLD.organization_id, 'number.deleted', OLD.id::text,
      jsonb_build_object('provider', OLD.provider));
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.audit_instance_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS audit_instance_change ON public.whatsapp_instances;
CREATE TRIGGER audit_instance_change AFTER INSERT OR UPDATE OR DELETE ON public.whatsapp_instances
  FOR EACH ROW EXECUTE FUNCTION private.audit_instance_change();

-- Token de administrador da Uazapi (plataforma) sai do texto e vai para o Vault.
CREATE OR REPLACE FUNCTION public.set_platform_secret(secret_key text, secret_value text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_operator() THEN
    RAISE EXCEPTION 'apenas operadores da plataforma' USING ERRCODE = '42501';
  END IF;
  IF secret_key NOT IN ('uazapi_admin_token') THEN
    RAISE EXCEPTION 'segredo desconhecido' USING ERRCODE = '22023';
  END IF;
  IF coalesce(length(trim(secret_value)), 0) = 0 THEN
    RAISE EXCEPTION 'valor do segredo vazio' USING ERRCODE = '22023';
  END IF;
  PERFORM private.put_secret('platform:' || secret_key, secret_value);
  PERFORM private.audit(NULL, 'secret.set', 'platform:' || secret_key, '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.set_platform_secret(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_platform_secret(text, text) TO authenticated;

DO $$
DECLARE v text;
BEGIN
  SELECT value INTO v FROM public.app_settings WHERE key = 'uazapi_admin_token' AND coalesce(value, '') <> '';
  IF v IS NOT NULL THEN
    PERFORM private.put_secret('platform:uazapi_admin_token', v);
    IF private.get_secret('platform:uazapi_admin_token') IS DISTINCT FROM v THEN
      RAISE EXCEPTION 'conferência do Vault falhou para o token da Uazapi';
    END IF;
  END IF;
  -- Cópias em texto de tokens da Uazapi deixam de existir.
  DELETE FROM public.app_settings WHERE key IN ('uazapi_admin_token', 'uazapi_instance_token');
END $$;
