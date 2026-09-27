-- Toda mudança de membro vai para o audit_log, venha da tela (RLS) ou de uma
-- Edge Function. Sem e-mail no registro: o alvo é o id do usuário.
CREATE OR REPLACE FUNCTION private.audit_member_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM private.audit(NEW.organization_id, 'member.insert', NEW.user_id::text,
      jsonb_build_object('role', NEW.role, 'status', NEW.status));
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status THEN
      PERFORM private.audit(NEW.organization_id, 'member.update', NEW.user_id::text,
        jsonb_build_object('role', jsonb_build_array(OLD.role, NEW.role),
                           'status', jsonb_build_array(OLD.status, NEW.status)));
    END IF;
  ELSE
    -- Em cascata (organização apagada) não há o que registrar.
    IF EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.organization_id) THEN
      PERFORM private.audit(OLD.organization_id, 'member.delete', OLD.user_id::text,
        jsonb_build_object('role', OLD.role));
    END IF;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.audit_member_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audit_member_change ON public.organization_members;
CREATE TRIGGER audit_member_change AFTER INSERT OR UPDATE OR DELETE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION private.audit_member_change();
