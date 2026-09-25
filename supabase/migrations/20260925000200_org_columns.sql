-- =============================================================================
-- ClubeCRM — organização em todas as tabelas existentes.
-- Spec: docs/superpowers/specs/2026-09-24-multi-tenant-equipes-design.md §6.2, §6.5
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Colunas novas
-- -----------------------------------------------------------------------------
ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS webhook_secret text,
  ADD COLUMN IF NOT EXISTS secret_name text;
ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.agent_configs
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS assigned_to uuid,
  ADD COLUMN IF NOT EXISTS department_id uuid;
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.followups
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- user_id vira histórico (spec §6.2): deixa de ser obrigatório.
ALTER TABLE public.whatsapp_instances ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.pipeline_stages    ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.conversations      ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.messages           ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.followups          ALTER COLUMN user_id DROP NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. Herança de organização do registro pai
-- -----------------------------------------------------------------------------
-- Filhas (conversa ← instância; mensagem e follow-up ← conversa) recebem a
-- organização do pai; valor divergente é recusado. Raízes sem organização
-- recebem a única organização ativa do usuário (compatibilidade com o app e
-- as funções atuais, que ainda não enviam organization_id). Linha nenhuma muda
-- de organização depois de criada.
CREATE OR REPLACE FUNCTION private.inherit_org()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  parent_org uuid;
  orgs uuid[];
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.organization_id IS NOT NULL
     AND NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'registro não pode mudar de organização' USING ERRCODE = '42501';
  END IF;

  IF TG_TABLE_NAME = 'conversations' THEN
    SELECT organization_id INTO parent_org FROM public.whatsapp_instances WHERE id = NEW.instance_id;
  ELSIF TG_TABLE_NAME IN ('messages', 'followups') THEN
    SELECT organization_id INTO parent_org FROM public.conversations WHERE id = NEW.conversation_id;
  ELSE
    IF NEW.organization_id IS NULL THEN
      SELECT array_agg(m.organization_id) INTO orgs
      FROM public.organization_members m
      JOIN public.organizations o ON o.id = m.organization_id AND o.status = 'active'
      WHERE m.user_id = coalesce((SELECT auth.uid()), NEW.user_id) AND m.status = 'active';
      IF cardinality(orgs) = 1 THEN
        NEW.organization_id := orgs[1];
      ELSE
        RAISE EXCEPTION 'informe organization_id (% organizações possíveis)', coalesce(cardinality(orgs), 0)
          USING ERRCODE = '23502';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF parent_org IS NULL THEN
    RAISE EXCEPTION 'registro pai sem organização' USING ERRCODE = '23502';
  END IF;
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := parent_org;
  ELSIF NEW.organization_id <> parent_org THEN
    RAISE EXCEPTION 'organization_id diverge do registro pai' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.inherit_org() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS inherit_org ON public.whatsapp_instances;
CREATE TRIGGER inherit_org BEFORE INSERT OR UPDATE OF organization_id ON public.whatsapp_instances
  FOR EACH ROW EXECUTE FUNCTION private.inherit_org();
DROP TRIGGER IF EXISTS inherit_org ON public.pipeline_stages;
CREATE TRIGGER inherit_org BEFORE INSERT OR UPDATE OF organization_id ON public.pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION private.inherit_org();
DROP TRIGGER IF EXISTS inherit_org ON public.agent_configs;
CREATE TRIGGER inherit_org BEFORE INSERT OR UPDATE OF organization_id ON public.agent_configs
  FOR EACH ROW EXECUTE FUNCTION private.inherit_org();
DROP TRIGGER IF EXISTS inherit_org ON public.conversations;
CREATE TRIGGER inherit_org BEFORE INSERT OR UPDATE OF organization_id, instance_id ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION private.inherit_org();
DROP TRIGGER IF EXISTS inherit_org ON public.messages;
CREATE TRIGGER inherit_org BEFORE INSERT OR UPDATE OF organization_id, conversation_id ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.inherit_org();
DROP TRIGGER IF EXISTS inherit_org ON public.followups;
CREATE TRIGGER inherit_org BEFORE INSERT OR UPDATE OF organization_id, conversation_id ON public.followups
  FOR EACH ROW EXECUTE FUNCTION private.inherit_org();

-- -----------------------------------------------------------------------------
-- 3. Cadastro: por enquanto só cria o perfil. A criação da organização na
--    instalação vazia volta na migration org_templates_signup.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data ->> 'full_name');
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Migração dos dados existentes (spec §6.5)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  org uuid;
  admin_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations) THEN
    SELECT user_id INTO admin_id FROM public.user_roles WHERE role = 'admin' LIMIT 1;
    INSERT INTO public.organizations (name, slug, template_key, created_by)
    VALUES ('Clubetec', 'clubetec', 'generico', admin_id)
    RETURNING id INTO org;
    IF admin_id IS NOT NULL THEN
      INSERT INTO public.organization_members (organization_id, user_id, role, status)
      VALUES (org, admin_id, 'owner', 'active');
      INSERT INTO public.platform_operators (user_id) VALUES (admin_id) ON CONFLICT DO NOTHING;
    END IF;
    INSERT INTO public.organization_members (organization_id, user_id, role, status)
    SELECT org, p.user_id, 'agent', 'active' FROM public.profiles p
    WHERE p.user_id IS DISTINCT FROM admin_id
    ON CONFLICT DO NOTHING;
    INSERT INTO public.departments (organization_id, name, color)
    VALUES (org, 'Comercial', '#3FB8BE') ON CONFLICT DO NOTHING;
  END IF;

  SELECT id INTO org FROM public.organizations WHERE slug = 'clubetec';
  IF org IS NOT NULL THEN
    UPDATE public.whatsapp_instances SET organization_id = org WHERE organization_id IS NULL;
    UPDATE public.pipeline_stages SET organization_id = org WHERE organization_id IS NULL;
    UPDATE public.agent_configs SET organization_id = org WHERE organization_id IS NULL;
    UPDATE public.conversations c SET organization_id = w.organization_id
      FROM public.whatsapp_instances w WHERE w.id = c.instance_id AND c.organization_id IS NULL;
    UPDATE public.messages m SET organization_id = c.organization_id
      FROM public.conversations c WHERE c.id = m.conversation_id AND m.organization_id IS NULL;
    UPDATE public.followups f SET organization_id = c.organization_id
      FROM public.conversations c WHERE c.id = f.conversation_id AND f.organization_id IS NULL;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Obrigatoriedade, chaves e índices
-- -----------------------------------------------------------------------------
ALTER TABLE public.whatsapp_instances ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.pipeline_stages    ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.agent_configs      ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.conversations      ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.messages           ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.followups          ALTER COLUMN organization_id SET NOT NULL;

-- agent_configs passa a ser um por organização. user_id continua único porque
-- a tela de configurações atual grava com upsert por user_id (troca no 1D).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_configs_pkey'
             AND conrelid = 'public.agent_configs'::regclass
             AND pg_get_constraintdef(oid) LIKE '%(user_id)%') THEN
    ALTER TABLE public.agent_configs DROP CONSTRAINT agent_configs_pkey;
    ALTER TABLE public.agent_configs ADD CONSTRAINT agent_configs_pkey PRIMARY KEY (organization_id);
    ALTER TABLE public.agent_configs ALTER COLUMN user_id DROP NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_configs_user_id_key') THEN
    ALTER TABLE public.agent_configs ADD CONSTRAINT agent_configs_user_id_key UNIQUE (user_id);
  END IF;

  -- Conversa única por organização + número + contato.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_user_instance_phone_key') THEN
    ALTER TABLE public.conversations DROP CONSTRAINT conversations_user_instance_phone_key;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_org_instance_phone_key') THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_org_instance_phone_key UNIQUE (organization_id, instance_id, contact_phone);
  END IF;

  -- Departamento e responsável da conversa têm de ser da mesma organização.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_department_fk') THEN
    ALTER TABLE public.conversations ADD CONSTRAINT conversations_department_fk
      FOREIGN KEY (department_id, organization_id)
      REFERENCES public.departments (id, organization_id) ON DELETE SET NULL (department_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_assignee_fk') THEN
    ALTER TABLE public.conversations ADD CONSTRAINT conversations_assignee_fk
      FOREIGN KEY (organization_id, assigned_to)
      REFERENCES public.organization_members (organization_id, user_id) ON DELETE SET NULL (assigned_to);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS whatsapp_instances_org_idx ON public.whatsapp_instances (organization_id);
CREATE INDEX IF NOT EXISTS pipeline_stages_org_idx ON public.pipeline_stages (organization_id);
CREATE INDEX IF NOT EXISTS conversations_org_assignee_idx ON public.conversations (organization_id, assigned_to);
CREATE INDEX IF NOT EXISTS conversations_org_department_idx ON public.conversations (organization_id, department_id);
CREATE INDEX IF NOT EXISTS messages_org_idx ON public.messages (organization_id);
CREATE INDEX IF NOT EXISTS followups_org_idx ON public.followups (organization_id);
