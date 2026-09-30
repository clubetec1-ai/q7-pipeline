-- =============================================================================
-- Correção (teste de ponta a ponta, 01/10): o dono convidado de uma empresa nova
-- não conseguia aceitar o convite ("apenas um owner pode alterar outro owner").
-- Exceção única e segura: a própria pessoa ativando o próprio convite, sem mudar
-- papel nem empresa. Todo o resto da proteção de dono continua igual.
-- Idempotente.
-- =============================================================================

CREATE OR REPLACE FUNCTION private.guard_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  org uuid := coalesce(NEW.organization_id, OLD.organization_id);
  uid uuid := (SELECT auth.uid());
  touches_owner boolean;
  caller_is_owner boolean;
BEGIN
  -- Organização sendo apagada (cascata): nada a proteger.
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = org) THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  touches_owner := (TG_OP <> 'INSERT' AND OLD.role = 'owner')
                OR (TG_OP <> 'DELETE' AND NEW.role = 'owner');
  -- Aceitar o próprio convite (invited → active, sem mudar papel nem empresa) é
  -- permitido: é assim que o dono de uma empresa nova criada pela Clubetec entra.
  IF TG_OP = 'UPDATE' AND uid IS NOT NULL AND OLD.user_id = uid AND NEW.user_id = uid
     AND OLD.status = 'invited' AND NEW.status = 'active'
     AND NEW.role = OLD.role AND NEW.organization_id = OLD.organization_id THEN
    RETURN NEW;
  END IF;

  IF touches_owner AND uid IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.organization_members
                   WHERE organization_id = org AND user_id = uid
                     AND role = 'owner' AND status = 'active')
    INTO caller_is_owner;
    IF NOT caller_is_owner THEN
      RAISE EXCEPTION 'apenas um owner pode alterar outro owner' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP <> 'INSERT' AND OLD.role = 'owner' AND OLD.status = 'active'
     AND (TG_OP = 'DELETE' OR NEW.role <> 'owner' OR NEW.status <> 'active') THEN
    IF NOT EXISTS (SELECT 1 FROM public.organization_members
                   WHERE organization_id = org AND role = 'owner' AND status = 'active'
                     AND user_id <> OLD.user_id) THEN
      RAISE EXCEPTION 'a organização precisa de ao menos um owner ativo' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
