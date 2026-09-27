-- =============================================================================
-- ClubeCRM — RLS por organização em todas as tabelas de public.
-- Spec: docs/superpowers/specs/2026-09-24-multi-tenant-equipes-design.md §5.3, §6.4
-- Idempotente. Regras de acesso ficam em private.* (org_core); aqui só se
-- aplica cada regra à sua tabela.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Remove as policies antigas (por user_id / has_role)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "own_agent_config" ON public.agent_configs;
DROP POLICY IF EXISTS "Admins can delete app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Admins can insert app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Admins can update app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "Admins can view app_settings" ON public.app_settings;
DROP POLICY IF EXISTS "own_conversations" ON public.conversations;
DROP POLICY IF EXISTS "Users manage their own followups" ON public.followups;
DROP POLICY IF EXISTS "own_messages" ON public.messages;
DROP POLICY IF EXISTS "Users manage their own stages" ON public.pipeline_stages;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can delete user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can insert user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can update user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins can view all whatsapp instances" ON public.whatsapp_instances;
DROP POLICY IF EXISTS "Users can manage own instances" ON public.whatsapp_instances;

-- Reexecução: remove também as policies criadas por esta migration.
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT tablename, policyname FROM pg_policies
           WHERE schemaname = 'public' AND policyname LIKE 'org:%' LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Ninguém anônimo lê ou grava nada em public; RLS ligada em tudo.
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c
           WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Organização e equipe
-- -----------------------------------------------------------------------------
CREATE POLICY "org: ver" ON public.organizations FOR SELECT TO authenticated
  USING (private.is_member(id) OR private.is_platform_operator());
CREATE POLICY "org: editar" ON public.organizations FOR UPDATE TO authenticated
  USING (private.has_permission(id, 'org.settings'))
  WITH CHECK (private.has_permission(id, 'org.settings'));
-- Status, plano e slug só mudam pela plataforma (service_role).
REVOKE UPDATE ON public.organizations FROM authenticated;
GRANT UPDATE (name, settings) ON public.organizations TO authenticated;

-- Entrada de membro só por convite (Edge Function manage-members, 1C).
CREATE POLICY "org: ver membros" ON public.organization_members FOR SELECT TO authenticated
  USING (private.is_member(organization_id));
CREATE POLICY "org: alterar membros" ON public.organization_members FOR UPDATE TO authenticated
  USING (private.has_permission(organization_id, 'members.manage'))
  WITH CHECK (private.has_permission(organization_id, 'members.manage'));
CREATE POLICY "org: remover membros" ON public.organization_members FOR DELETE TO authenticated
  USING (private.has_permission(organization_id, 'members.manage'));
REVOKE UPDATE ON public.organization_members FROM authenticated;
GRANT UPDATE (role, status) ON public.organization_members TO authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['departments', 'department_members', 'teams', 'team_members'] LOOP
    EXECUTE format('CREATE POLICY "org: ver" ON public.%I FOR SELECT TO authenticated
      USING (private.is_member(organization_id))', t);
    EXECUTE format('CREATE POLICY "org: gerenciar" ON public.%I FOR ALL TO authenticated
      USING (private.has_permission(organization_id, %L))
      WITH CHECK (private.has_permission(organization_id, %L))', t, 'departments.manage', 'departments.manage');
  END LOOP;
END $$;

CREATE POLICY "org: ver" ON public.pipeline_stages FOR SELECT TO authenticated
  USING (private.is_member(organization_id));
CREATE POLICY "org: gerenciar" ON public.pipeline_stages FOR ALL TO authenticated
  USING (private.has_permission(organization_id, 'pipeline.manage'))
  WITH CHECK (private.has_permission(organization_id, 'pipeline.manage'));

-- Números: todo membro vê (nome, status) para exibir as conversas.
-- ATENÇÃO (trade-off até o 1C/1D): instance_token ainda está em texto e
-- legível por membros da própria organização. No 1C o token passa a ser lido
-- só do Vault e a coluna é anulada; no 1D o SELECT por coluna é restringido.
CREATE POLICY "org: ver" ON public.whatsapp_instances FOR SELECT TO authenticated
  USING (private.is_member(organization_id));
CREATE POLICY "org: gerenciar" ON public.whatsapp_instances FOR ALL TO authenticated
  USING (private.has_permission(organization_id, 'org.settings'))
  WITH CHECK (private.has_permission(organization_id, 'org.settings'));

-- Configuração da IA (inclui a chave da Groq): só quem administra a organização.
CREATE POLICY "org: gerenciar" ON public.agent_configs FOR ALL TO authenticated
  USING (private.has_permission(organization_id, 'org.settings'))
  WITH CHECK (private.has_permission(organization_id, 'org.settings'));

-- -----------------------------------------------------------------------------
-- 4. Atendimento
-- -----------------------------------------------------------------------------
CREATE POLICY "org: ver" ON public.conversations FOR SELECT TO authenticated
  USING (private.can_see_conversation(organization_id, department_id, assigned_to));
CREATE POLICY "org: criar" ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (private.has_permission(organization_id, 'conversations.attend'));
-- WITH CHECK não exige continuar vendo a conversa: transferir para outro
-- departamento a torna invisível para quem transferiu, e isso é esperado.
CREATE POLICY "org: atender" ON public.conversations FOR UPDATE TO authenticated
  USING (private.can_see_conversation(organization_id, department_id, assigned_to)
         AND private.has_permission(organization_id, 'conversations.attend'))
  WITH CHECK (private.has_permission(organization_id, 'conversations.attend'));
CREATE POLICY "org: apagar" ON public.conversations FOR DELETE TO authenticated
  USING (private.has_permission(organization_id, 'org.settings'));

-- Mensagens e follow-ups herdam a visibilidade da conversa: a subconsulta em
-- conversations já passa pela RLS dela.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['messages', 'followups'] LOOP
    EXECUTE format('CREATE POLICY "org: ver" ON public.%1$I FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.conversations c
                     WHERE c.id = %1$I.conversation_id AND c.organization_id = %1$I.organization_id))', t);
    EXECUTE format('CREATE POLICY "org: criar" ON public.%1$I FOR INSERT TO authenticated
      WITH CHECK (private.has_permission(organization_id, %2$L)
                  AND EXISTS (SELECT 1 FROM public.conversations c
                              WHERE c.id = %1$I.conversation_id AND c.organization_id = %1$I.organization_id))',
      t, 'conversations.attend');
    EXECUTE format('CREATE POLICY "org: alterar" ON public.%1$I FOR UPDATE TO authenticated
      USING (private.has_permission(organization_id, %2$L)
             AND EXISTS (SELECT 1 FROM public.conversations c
                         WHERE c.id = %1$I.conversation_id AND c.organization_id = %1$I.organization_id))
      WITH CHECK (private.has_permission(organization_id, %2$L))', t, 'conversations.attend');
  END LOOP;
END $$;
-- Follow-up agendado pode ser cancelado (apagado) por quem atende a conversa.
CREATE POLICY "org: apagar" ON public.followups FOR DELETE TO authenticated
  USING (private.has_permission(organization_id, 'conversations.attend')
         AND EXISTS (SELECT 1 FROM public.conversations c
                     WHERE c.id = followups.conversation_id AND c.organization_id = followups.organization_id));

-- -----------------------------------------------------------------------------
-- 5. Perfis: o próprio e o de quem divide organização ativa
-- -----------------------------------------------------------------------------
CREATE POLICY "org: ver" ON public.profiles FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid())
         OR EXISTS (SELECT 1 FROM public.organization_members them
                    WHERE them.user_id = profiles.user_id
                      AND private.is_member(them.organization_id)));
CREATE POLICY "org: editar o proprio" ON public.profiles FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY "org: criar o proprio" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

-- -----------------------------------------------------------------------------
-- 6. Plataforma, auditoria, modelos
-- -----------------------------------------------------------------------------
-- audit_log: leitura para quem gerencia membros; escrita só por private.audit.
CREATE POLICY "org: ver" ON public.audit_log FOR SELECT TO authenticated
  USING (private.has_permission(organization_id, 'members.manage') OR private.is_platform_operator());

CREATE POLICY "org: ver" ON public.platform_operators FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR private.is_platform_operator());

-- A organização vê o acesso de suporte ativo (aviso no topo da tela).
-- Abertura só pela Edge Function platform-orgs (1C), que audita.
CREATE POLICY "org: ver" ON public.support_access FOR SELECT TO authenticated
  USING (private.is_platform_operator() OR private.is_member(organization_id));

CREATE POLICY "org: ver" ON public.org_templates FOR SELECT TO authenticated
  USING (active OR private.is_platform_operator());

-- Legado: user_roles só leitura do próprio; app_settings só operadores.
CREATE POLICY "org: ver o proprio" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "org: operador" ON public.app_settings FOR ALL TO authenticated
  USING (private.is_platform_operator())
  WITH CHECK (private.is_platform_operator());

-- org_secrets e inbound_events: RLS ligada e nenhuma policy (negação total).
