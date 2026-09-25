-- =============================================================================
-- ClubeCRM — núcleo multi-tenant: organizações, papéis, departamentos, grupos,
-- plataforma, auditoria e funções de permissão.
-- Spec: docs/superpowers/specs/2026-09-24-multi-tenant-equipes-design.md §5, §6.1
-- Idempotente: pode rodar de novo sem erro.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
-- Policies executam com o papel de quem consulta: precisa de USAGE para chamar
-- as funções. O schema não é exposto pela API (só `public` é).
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

DO $$ BEGIN
  CREATE TYPE public.org_role AS ENUM ('owner', 'admin', 'supervisor', 'agent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- Tabelas
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  plan text,
  template_key text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.org_role NOT NULL DEFAULT 'agent',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'disabled')),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS organization_members_user_idx ON public.organization_members (user_id);

-- As chaves compostas (id, organization_id) permitem FKs que garantem, no
-- próprio banco, que departamento, grupo e membro são da mesma organização.
CREATE TABLE IF NOT EXISTS public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text,
  business_hours jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name),
  UNIQUE (id, organization_id)
);

CREATE TABLE IF NOT EXISTS public.department_members (
  department_id uuid NOT NULL,
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, user_id),
  FOREIGN KEY (department_id, organization_id)
    REFERENCES public.departments (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id)
    REFERENCES public.organization_members (organization_id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS department_members_user_idx ON public.department_members (user_id);
CREATE INDEX IF NOT EXISTS department_members_org_idx ON public.department_members (organization_id, user_id);

-- "Grupos": equipes dentro de um departamento (spec §6.1).
CREATE TABLE IF NOT EXISTS public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  department_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department_id, name),
  UNIQUE (id, organization_id),
  FOREIGN KEY (department_id, organization_id)
    REFERENCES public.departments (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS teams_org_idx ON public.teams (organization_id);

CREATE TABLE IF NOT EXISTS public.team_members (
  team_id uuid NOT NULL,
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id),
  FOREIGN KEY (team_id, organization_id)
    REFERENCES public.teams (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, user_id)
    REFERENCES public.organization_members (organization_id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS team_members_org_idx ON public.team_members (organization_id, user_id);

CREATE TABLE IF NOT EXISTS public.platform_operators (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.support_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  operator_id uuid NOT NULL REFERENCES public.platform_operators(user_id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at <= created_at + interval '2 hours')
);
CREATE INDEX IF NOT EXISTS support_access_lookup_idx
  ON public.support_access (organization_id, operator_id, expires_at);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  actor_id uuid,
  actor_type text NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user', 'ai_agent', 'system')),
  agent_key text,
  action text NOT NULL,
  target text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_org_idx ON public.audit_log (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.org_templates (
  key text PRIMARY KEY,
  name text NOT NULL,
  description text,
  payload jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Só referência ao Vault, por nome (spec §6.3). Nunca o valor.
CREATE TABLE IF NOT EXISTS public.org_secrets (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  secret_name text NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, name)
);

CREATE TABLE IF NOT EXISTS public.inbound_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_message_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processed', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (instance_id, provider_message_id)
);
CREATE INDEX IF NOT EXISTS inbound_events_pending_idx
  ON public.inbound_events (status, created_at) WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS inbound_events_org_idx ON public.inbound_events (organization_id);

-- RLS ligada já na criação; as policies vêm na migration org_rls. Sem policy,
-- ninguém do navegador lê nada — o padrão seguro.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['organizations', 'organization_members', 'departments',
    'department_members', 'teams', 'team_members', 'platform_operators', 'support_access',
    'audit_log', 'org_templates', 'org_secrets', 'inbound_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['organizations', 'organization_members', 'departments',
    'teams', 'org_templates'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS update_%1$s_updated_at ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER update_%1$s_updated_at BEFORE UPDATE ON public.%1$I
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- Permissões: uma matriz, um lugar (spec §5.2)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.role_permissions(r public.org_role)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE r
    WHEN 'owner' THEN ARRAY['org.billing', 'org.settings', 'members.manage',
      'departments.manage', 'pipeline.manage', 'conversations.view_all',
      'conversations.view_department', 'conversations.reassign', 'reports.view',
      'library.manage', 'contacts.groups_manage', 'conversations.attend']
    WHEN 'admin' THEN ARRAY['org.settings', 'members.manage', 'departments.manage',
      'pipeline.manage', 'conversations.view_all', 'conversations.view_department',
      'conversations.reassign', 'reports.view', 'library.manage',
      'contacts.groups_manage', 'conversations.attend']
    WHEN 'supervisor' THEN ARRAY['conversations.view_department',
      'conversations.reassign', 'reports.view', 'library.manage',
      'contacts.groups_manage', 'conversations.attend']
    WHEN 'agent' THEN ARRAY['conversations.attend']
    ELSE ARRAY[]::text[]
  END
$$;

CREATE OR REPLACE FUNCTION private.is_platform_operator()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_operators
                 WHERE user_id = (SELECT auth.uid()))
$$;

CREATE OR REPLACE FUNCTION private.has_support_access(org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.support_access
                 WHERE organization_id = org
                   AND operator_id = (SELECT auth.uid())
                   AND expires_at > now())
$$;

-- Papel ativo do usuário numa organização ativa. NULL = sem acesso.
CREATE OR REPLACE FUNCTION private.member_role(org uuid)
RETURNS public.org_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.role
  FROM public.organization_members m
  JOIN public.organizations o ON o.id = m.organization_id
  WHERE m.organization_id = org
    AND m.user_id = (SELECT auth.uid())
    AND m.status = 'active'
    AND o.status = 'active'
$$;

-- Permissões efetivas: as do papel, ou as de suporte (admin sem
-- members.manage e org.billing) enquanto o acesso de suporte valer (§5.4).
CREATE OR REPLACE FUNCTION private.effective_permissions(org uuid)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.org_role;
BEGIN
  IF org IS NULL OR (SELECT auth.uid()) IS NULL THEN RETURN ARRAY[]::text[]; END IF;
  r := private.member_role(org);
  IF r IS NOT NULL THEN RETURN private.role_permissions(r); END IF;
  IF private.has_support_access(org) THEN
    RETURN array_remove(array_remove(private.role_permissions('admin'),
      'members.manage'), 'org.billing');
  END IF;
  RETURN ARRAY[]::text[];
END $$;

CREATE OR REPLACE FUNCTION private.is_member(org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT cardinality(private.effective_permissions(org)) > 0
$$;

CREATE OR REPLACE FUNCTION private.has_permission(org uuid, perm text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT perm = ANY (private.effective_permissions(org))
$$;

CREATE OR REPLACE FUNCTION private.in_department(dept uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.department_members
                 WHERE department_id = dept AND user_id = (SELECT auth.uid()))
$$;

-- Visibilidade de conversa (spec §5.3).
CREATE OR REPLACE FUNCTION private.can_see_conversation(org uuid, dept uuid, assignee uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  perms text[] := private.effective_permissions(org);
  uid uuid := (SELECT auth.uid());
  mode text;
BEGIN
  IF cardinality(perms) = 0 THEN RETURN false; END IF;
  IF 'conversations.view_all' = ANY (perms) THEN RETURN true; END IF;
  IF assignee = uid THEN RETURN true; END IF;
  -- Fila geral: sem departamento e sem responsável.
  IF dept IS NULL AND assignee IS NULL THEN
    RETURN 'conversations.attend' = ANY (perms);
  END IF;
  IF dept IS NULL OR NOT private.in_department(dept) THEN RETURN false; END IF;
  IF 'conversations.view_department' = ANY (perms) THEN RETURN true; END IF;
  SELECT coalesce(settings ->> 'agent_visibility', 'own_and_queue') INTO mode
  FROM public.organizations WHERE id = org;
  RETURN mode = 'department' OR assignee IS NULL;
END $$;

-- Permissões para o frontend esconder botões. Quem garante é a RLS.
CREATE OR REPLACE FUNCTION public.my_permissions(org uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.effective_permissions(org)
$$;

-- Único caminho de escrita no audit_log.
CREATE OR REPLACE FUNCTION private.audit(
  org uuid, act text, tgt text, info jsonb DEFAULT '{}'::jsonb,
  a_type text DEFAULT 'user', a_key text DEFAULT NULL)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.audit_log (organization_id, actor_id, actor_type, agent_key, action, target, meta)
  VALUES (org, (SELECT auth.uid()), a_type, a_key, act, tgt, coalesce(info, '{}'::jsonb))
$$;

-- -----------------------------------------------------------------------------
-- Guardas
-- -----------------------------------------------------------------------------
-- Só owner mexe em owner; a organização nunca fica sem owner ativo.
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

DROP TRIGGER IF EXISTS guard_owner ON public.organization_members;
CREATE TRIGGER guard_owner BEFORE INSERT OR UPDATE OR DELETE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION private.guard_owner();

-- Grupo só aceita quem já é do departamento do grupo.
CREATE OR REPLACE FUNCTION private.guard_team_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.teams t
    JOIN public.department_members dm ON dm.department_id = t.department_id
    WHERE t.id = NEW.team_id AND dm.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'a pessoa precisa ser do departamento do grupo' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_team_member ON public.team_members;
CREATE TRIGGER guard_team_member BEFORE INSERT OR UPDATE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION private.guard_team_member();

-- -----------------------------------------------------------------------------
-- Quem pode chamar o quê
-- -----------------------------------------------------------------------------
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  private.role_permissions(public.org_role), private.is_platform_operator(),
  private.has_support_access(uuid), private.member_role(uuid),
  private.effective_permissions(uuid), private.is_member(uuid),
  private.has_permission(uuid, text), private.in_department(uuid),
  private.can_see_conversation(uuid, uuid, uuid)
TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.audit(uuid, text, text, jsonb, text, text) TO service_role;
-- Legado: as policies antigas usam has_role até a migration org_rls substituí-las.
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated;
REVOKE ALL ON FUNCTION public.my_permissions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_permissions(uuid) TO authenticated;
