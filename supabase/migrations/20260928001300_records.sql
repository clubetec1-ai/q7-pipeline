-- =============================================================================
-- Registros personalizados + campos personalizados do contato
--  * record_types: tipos por organização com campos configuráveis (jsonb).
--    Tipo reservado 'contato' = campos personalizados de contacts.custom.
--  * records: registros de um tipo, opcionalmente ligados a um contato.
--  * Validação no banco (tipo, obrigatório, opções, tamanho); chave desconhecida
--    é descartada. Acesso por tipo: 'team' (quem atende) ou 'managers'
--    (org.settings / reports.view). Histórico no audit_log (só quais campos).
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.record_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key ~ '^[a-z0-9_]{1,40}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description text CHECK (description IS NULL OR char_length(description) <= 500),
  access text NOT NULL DEFAULT 'team' CHECK (access IN ('team', 'managers')),
  link_contact boolean NOT NULL DEFAULT true,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, key),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type_id uuid NOT NULL,
  contact_id uuid,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  title text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (type_id, organization_id) REFERENCES public.record_types (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id, organization_id) REFERENCES public.contacts (id, organization_id) ON DELETE SET NULL (contact_id)
);
CREATE INDEX IF NOT EXISTS records_type_idx ON public.records (organization_id, type_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS records_contact_idx ON public.records (contact_id) WHERE contact_id IS NOT NULL;

-- Definição dos campos: [{key,label,type,options?,required?,ai_readable?,sensitive?}]
CREATE OR REPLACE FUNCTION private.check_fields(defs jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE f jsonb; keys text[] := ARRAY[]::text[];
BEGIN
  IF jsonb_typeof(defs) <> 'array' OR jsonb_array_length(defs) > 40 THEN
    RAISE EXCEPTION 'até 40 campos por tipo' USING ERRCODE = '22023';
  END IF;
  FOR f IN SELECT * FROM jsonb_array_elements(defs) LOOP
    IF coalesce(f ->> 'key', '') !~ '^[a-z0-9_]{1,40}$' OR (f ->> 'key') = ANY (keys) THEN
      RAISE EXCEPTION 'chave de campo inválida ou repetida: %', f ->> 'key' USING ERRCODE = '22023';
    END IF;
    keys := keys || (f ->> 'key');
    IF char_length(coalesce(f ->> 'label', '')) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'nome do campo inválido' USING ERRCODE = '22023';
    END IF;
    IF coalesce(f ->> 'type', '') NOT IN ('text', 'long_text', 'number', 'money', 'date', 'select', 'boolean', 'email', 'phone') THEN
      RAISE EXCEPTION 'tipo de campo inválido: %', f ->> 'type' USING ERRCODE = '22023';
    END IF;
    IF f ->> 'type' = 'select' AND (jsonb_typeof(f -> 'options') <> 'array'
        OR jsonb_array_length(f -> 'options') NOT BETWEEN 1 AND 50) THEN
      RAISE EXCEPTION 'lista “%” precisa de 1 a 50 opções', f ->> 'label' USING ERRCODE = '22023';
    END IF;
  END LOOP;
END $$;

-- Limpa e valida valores conforme os campos. Chave desconhecida some.
CREATE OR REPLACE FUNCTION private.clean_values(defs jsonb, vals jsonb, enforce_required boolean)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE f jsonb; k text; t text; v jsonb; s text; out jsonb := '{}'::jsonb;
BEGIN
  IF vals IS NULL OR jsonb_typeof(vals) <> 'object' THEN vals := '{}'::jsonb; END IF;
  FOR f IN SELECT * FROM jsonb_array_elements(coalesce(defs, '[]'::jsonb)) LOOP
    k := f ->> 'key'; t := f ->> 'type'; v := vals -> k;
    s := CASE WHEN v IS NULL OR jsonb_typeof(v) = 'null' THEN NULL ELSE trim(v #>> '{}') END;
    IF s IS NULL OR s = '' THEN
      IF enforce_required AND coalesce((f ->> 'required')::boolean, false) THEN
        RAISE EXCEPTION 'preencha “%”', f ->> 'label' USING ERRCODE = '22023';
      END IF;
      CONTINUE;
    END IF;
    IF t IN ('number', 'money') THEN
      IF replace(s, ',', '.') !~ '^-?\d{1,15}(\.\d{1,4})?$' THEN RAISE EXCEPTION '“%” precisa ser um número', f ->> 'label' USING ERRCODE = '22023'; END IF;
      out := out || jsonb_build_object(k, replace(s, ',', '.')::numeric);
    ELSIF t = 'date' THEN
      IF s !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION '“%” precisa ser uma data', f ->> 'label' USING ERRCODE = '22023'; END IF;
      PERFORM s::date;
      out := out || jsonb_build_object(k, s);
    ELSIF t = 'boolean' THEN
      out := out || jsonb_build_object(k, s IN ('true', 't', '1', 'sim'));
    ELSIF t = 'select' THEN
      IF NOT (f -> 'options') ? s THEN RAISE EXCEPTION 'opção inválida em “%”', f ->> 'label' USING ERRCODE = '22023'; END IF;
      out := out || jsonb_build_object(k, s);
    ELSIF t = 'email' THEN
      IF s !~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN RAISE EXCEPTION '“%” precisa ser um e-mail', f ->> 'label' USING ERRCODE = '22023'; END IF;
      out := out || jsonb_build_object(k, lower(left(s, 200)));
    ELSIF t = 'phone' THEN
      IF regexp_replace(s, '\D', '', 'g') !~ '^\d{8,15}$' THEN RAISE EXCEPTION '“%” precisa ser um telefone', f ->> 'label' USING ERRCODE = '22023'; END IF;
      out := out || jsonb_build_object(k, regexp_replace(s, '\D', '', 'g'));
    ELSE
      out := out || jsonb_build_object(k, left(s, CASE WHEN t = 'long_text' THEN 10000 ELSE 2000 END));
    END IF;
  END LOOP;
  RETURN out;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION 'data inválida' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION private.check_fields(jsonb), private.clean_values(jsonb, jsonb, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.record_type_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.check_fields(NEW.fields);
  IF NEW.key = 'contato' THEN NEW.link_contact := false; NEW.access := 'team'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS record_type_guard ON public.record_types;
CREATE TRIGGER record_type_guard BEFORE INSERT OR UPDATE ON public.record_types
  FOR EACH ROW EXECUTE FUNCTION private.record_type_guard();

CREATE OR REPLACE FUNCTION private.record_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE rt public.record_types;
BEGIN
  SELECT * INTO rt FROM public.record_types WHERE id = NEW.type_id;
  IF rt.key = 'contato' THEN RAISE EXCEPTION 'campos do contato ficam na ficha' USING ERRCODE = '22023'; END IF;
  IF NOT rt.link_contact THEN NEW.contact_id := NULL; END IF;
  NEW.data := private.clean_values(rt.fields, NEW.data, true);
  NEW.title := left(coalesce((SELECT NEW.data ->> (f ->> 'key') FROM jsonb_array_elements(rt.fields) f
                              WHERE NEW.data ? (f ->> 'key') LIMIT 1), rt.name), 200);
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS record_guard ON public.records;
CREATE TRIGGER record_guard BEFORE INSERT OR UPDATE ON public.records
  FOR EACH ROW EXECUTE FUNCTION private.record_guard();

-- Campos do contato: contacts.custom validado pelo tipo 'contato' (se existir).
CREATE OR REPLACE FUNCTION private.contact_custom_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE defs jsonb;
BEGIN
  SELECT fields INTO defs FROM public.record_types WHERE organization_id = NEW.organization_id AND key = 'contato';
  IF defs IS NOT NULL THEN NEW.custom := private.clean_values(defs, NEW.custom, false); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS contact_custom_guard ON public.contacts;
CREATE TRIGGER contact_custom_guard BEFORE INSERT OR UPDATE OF custom ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION private.contact_custom_guard();

-- Histórico: quem, quando, quais campos (sem valores — minimização).
CREATE OR REPLACE FUNCTION private.record_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE changed text[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM private.audit(OLD.organization_id, 'record.deleted', OLD.id::text, jsonb_build_object('type', OLD.type_id));
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(k) INTO changed FROM (
      SELECT key AS k FROM jsonb_each(NEW.data) WHERE NEW.data -> key IS DISTINCT FROM OLD.data -> key
      UNION SELECT key FROM jsonb_each(OLD.data) WHERE NOT NEW.data ? key) x;
  END IF;
  PERFORM private.audit(NEW.organization_id, CASE WHEN TG_OP = 'INSERT' THEN 'record.created' ELSE 'record.updated' END,
    NEW.id::text, jsonb_strip_nulls(jsonb_build_object('type', NEW.type_id, 'fields', changed)));
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS record_audit ON public.records;
CREATE TRIGGER record_audit AFTER INSERT OR UPDATE OR DELETE ON public.records
  FOR EACH ROW EXECUTE FUNCTION private.record_audit();
REVOKE ALL ON FUNCTION private.record_type_guard(), private.record_guard(), private.contact_custom_guard(),
  private.record_audit() FROM PUBLIC, anon, authenticated;

-- Acesso por tipo.
CREATE OR REPLACE FUNCTION private.can_use_record_type(type_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.record_types t WHERE t.id = type_id AND (
    (t.access = 'team' AND private.has_permission(t.organization_id, 'conversations.attend'))
    OR private.has_permission(t.organization_id, 'org.settings')
    OR private.has_permission(t.organization_id, 'reports.view')))
$$;
REVOKE ALL ON FUNCTION private.can_use_record_type(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_use_record_type(uuid) TO authenticated;

ALTER TABLE public.record_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.record_types, public.records FROM anon, authenticated;
GRANT SELECT, DELETE ON public.record_types, public.records TO authenticated;
GRANT INSERT (id, organization_id, key, name, description, access, link_contact, fields, created_by) ON public.record_types TO authenticated;
GRANT UPDATE (name, description, access, link_contact, fields) ON public.record_types TO authenticated;
GRANT INSERT (id, organization_id, type_id, contact_id, data, created_by) ON public.records TO authenticated;
GRANT UPDATE (contact_id, data) ON public.records TO authenticated;

DROP POLICY IF EXISTS "org: ver" ON public.record_types;
DROP POLICY IF EXISTS "org: gerenciar" ON public.record_types;
CREATE POLICY "org: ver" ON public.record_types FOR SELECT TO authenticated
  USING (private.is_member(organization_id) AND (key = 'contato' OR private.can_use_record_type(id)));
CREATE POLICY "org: gerenciar" ON public.record_types FOR ALL TO authenticated
  USING (private.has_permission(organization_id, 'org.settings'))
  WITH CHECK (private.has_permission(organization_id, 'org.settings'));

DROP POLICY IF EXISTS "tipo: usar" ON public.records;
CREATE POLICY "tipo: usar" ON public.records FOR ALL TO authenticated
  USING (private.can_use_record_type(type_id)
         AND (contact_id IS NULL OR private.can_see_contact(organization_id, contact_id)))
  WITH CHECK (private.can_use_record_type(type_id)
         AND (contact_id IS NULL OR private.can_see_contact(organization_id, contact_id)));
