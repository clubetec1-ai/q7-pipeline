# 1B — Multi-tenant: banco, permissões e isolamento — Implementation Plan

> **For agentic workers:** executar **inline** com superpowers:executing-plans (preferência do usuário: menos tokens). Plano enxuto: define arquivos, assinaturas, regras e testes; o código é escrito uma vez, na execução. Steps usam checkbox (`- [ ]`).

**Goal:** Transformar o banco do ClubeCRM em multi-tenant (organizações, papéis, departamentos, grupos, plataforma, auditoria, segredos no Vault, modelos prontos), com isolamento garantido por RLS e provado por teste automático — sem quebrar o app e as Edge Functions atuais.

**Architecture:** Cinco migrations novas, em ordem, cada uma idempotente. Toda regra de acesso mora em funções `private.*` únicas (matriz de permissões, visibilidade). Linhas-filhas herdam `organization_id` do pai por trigger (conversa ← instância, mensagem/follow-up ← conversa), o que evita divergência e mantém compatíveis o app e as funções que ainda não enviam `organization_id`. Colunas antigas de segredo **não** são anuladas aqui (as funções ainda as leem); isso fica no 1C.

**Tech Stack:** Postgres 17 (Supabase), PL/pgSQL, Supabase Vault, MCP Supabase (`apply_migration`, `execute_sql`, `get_advisors`).

**Spec:** `docs/superpowers/specs/2026-09-24-multi-tenant-equipes-design.md` §5, §6, §7, §10, §11.1, §16.1. Grupos de clientes (`contact_groups`) **não** entram aqui — são do subprojeto 2.

## Global Constraints

- Projeto: `ulmndwlralgjbwlebxmo` (Postgres 17). É ambiente de **teste** (decisão do usuário, 25/09/2026): aplicar direto, sem homologação. Dados atuais: 1 usuário, 1 conversa, 67 mensagens, 1 instância.
- `supabase/migrations/20260101000000_q7_init.sql` **não** é alterada. Só migrations novas, timestamp posterior, idempotentes (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY IF EXISTS`).
- Funções auxiliares em `private`, `SECURITY DEFINER STABLE`, `SET search_path = ''` (nomes sempre qualificados), `REVOKE ALL ... FROM PUBLIC, anon` e `GRANT EXECUTE` só a `authenticated` quando usadas em policy.
- Nas policies: `(select auth.uid())`, nunca `auth.uid()` direto.
- RLS ligada em **todas** as tabelas de `public`. Tabelas só de backend (`org_secrets`, `inbound_events`) com RLS e **nenhuma** policy.
- `audit_log`: só INSERT (via função), sem UPDATE/DELETE para ninguém.
- Organização nunca vem do cliente como credencial: sempre derivada de associação ou do registro pai.
- Nada em `conversations`/`messages` é apagado.
- Commits em português, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch `feat/multi-tenant-banco` a partir de `feat/backup-externo`. PR ao final; merge só com pedido do usuário.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/tests/isolation.sql` | teste de isolamento completo em `BEGIN … ROLLBACK`; `RAISE EXCEPTION` na 1ª falha; `RAISE NOTICE 'ISOLATION OK'` no fim |
| `supabase/migrations/20260925000100_org_core.sql` | enum `org_role`; tabelas novas; funções `private.*` de permissão/visibilidade; guarda de owner; `audit_log` + `private.audit(...)` |
| `supabase/migrations/20260925000200_org_columns.sql` | `organization_id` e colunas novas nas tabelas existentes; triggers de herança; backfill da org "Clubetec"; `NOT NULL`; índices; unique de conversa |
| `supabase/migrations/20260925000300_org_rls.sql` | remove policies antigas por `user_id`; cria policies por organização em todas as tabelas |
| `supabase/migrations/20260925000400_org_secrets.sql` | `private.get_secret`, RPCs `set_org_secret`/`set_instance_secret`; cópia dos segredos em texto para o Vault com conferência (colunas antigas mantidas) |
| `supabase/migrations/20260925000500_org_templates_signup.sql` | seed de `org_templates` (6 modelos); `private.apply_template`; novo `handle_new_user`; RPC `my_permissions` |
| `scripts/check-setup.mjs` | passa a conferir as tabelas novas |

---

### Task 0: Branch

- [ ] `git checkout feat/backup-externo && git pull && git checkout -b feat/multi-tenant-banco`

---

### Task 1: Teste de isolamento (vermelho primeiro)

**Files:** Create `supabase/tests/isolation.sql`

**Interfaces — Produces:** script autocontido; sucesso = termina com `NOTICE: ISOLATION OK`; falha = `ERROR: FALHOU <caso>`.

- [ ] **Step 1: Estrutura do script**
  - `BEGIN;` … `ROLLBACK;`. Helper local `pg_temp.as_user(uid uuid)` que faz `set_config('request.jwt.claims', json_build_object('sub', uid, 'role','authenticated')::text, true)` e `SET LOCAL ROLE authenticated`; `pg_temp.as_admin()` faz `RESET ROLE`.
  - `pg_temp.expect(cond boolean, caso text)` → `RAISE EXCEPTION 'FALHOU %', caso` se falso.
  - `pg_temp.expect_denied(sql text, caso text)` → executa com `EXECUTE`; passa se der erro **ou** afetar 0 linhas (`GET DIAGNOSTICS`); falha se afetar ≥1.
- [ ] **Step 2: Cenário (como superusuário)** — inserir em `auth.users` 9 usuários com ids fixos (`'00000000-0000-0000-0000-0000000000a1'` etc.): em A `owner_a, admin_a, sup_a, agent_a, agent2_a`; em B `owner_b, agent_b`; `operator` (em `platform_operators`, sem associação); `outsider` (sem nada). Orgs A e B; em A departamentos `D1, D2` (sup_a e agent_a em D1; agent2_a em D2), grupo `G1` em D1; instância A e B; em A conversas: `c_a_agent` (D1, atribuída a agent_a), `c_a_queue_d1` (D1, sem responsável), `c_a_d2` (D2, sem responsável), `c_a_general` (sem depto, sem responsável); B espelhado com `c_b`. Mensagem e follow-up em cada conversa.
- [ ] **Step 3: Casos** (um `expect` cada, nome entre aspas):
  1. `"sentinela RLS"` — `SELECT count(*) FROM pg_tables t JOIN pg_class c ON c.relname=t.tablename AND c.relnamespace='public'::regnamespace WHERE t.schemaname='public' AND NOT c.relrowsecurity` = 0.
  2. Para **cada** tabela de `public` com `organization_id` (lista montada dinamicamente de `information_schema.columns`): como `agent_b`, `SELECT count(*)` de linhas da org A = 0 — `"leitura cruzada <tabela>"`; `expect_denied` de `UPDATE … SET organization_id=organization_id WHERE organization_id=<A>` e `DELETE … WHERE organization_id=<A>` — `"escrita cruzada <tabela>"`.
  3. `"insert em org alheia"` — como `owner_b`, `INSERT INTO departments(organization_id,name) VALUES (<A>,'x')` falha.
  4. Visibilidade `own_and_queue`: `agent_a` vê `c_a_agent`, `c_a_queue_d1`, `c_a_general`; **não** vê `c_a_d2`. `agent2_a` não vê `c_a_agent` nem `c_a_queue_d1`.
  5. Modo `department` (`UPDATE organizations SET settings = settings || '{"agent_visibility":"department"}'`): `agent_a` vê tudo de D1 + fila geral; não vê `c_a_d2`.
  6. `sup_a` vê D1 inteiro + fila geral, não vê `c_a_d2`; `admin_a` vê as 4.
  7. Filhos herdam: `messages`/`followups` visíveis exatamente nas mesmas conversas do caso 4.
  8. `"admin não altera owner"` — como `admin_a`, `UPDATE organization_members SET role='agent' WHERE user_id=owner_a` falha/0 linhas.
  9. `"org sem owner"` — como superusuário, rebaixar o único owner de A → erro.
  10. `"org suspensa"` — `UPDATE organizations SET status='suspended'` em A; `agent_a` e `admin_a` leem 0 conversas; reativar depois.
  11. Suporte: `operator` lê 0 conversas de A; com `support_access` válido lê 4; com `expires_at = now() - interval '1 min'` lê 0.
  12. `"segredos invisíveis"` — como `owner_a`: `org_secrets` e `inbound_events` retornam 0 linhas; `SELECT` em `vault.decrypted_secrets` dá erro de permissão.
  13. `"audit imutável"` — como `owner_a`, `UPDATE`/`DELETE` em `audit_log` afetam 0 linhas; `INSERT` direto falha.
  14. `"herança de org"` — como superusuário, inserir `messages` sem `organization_id` numa conversa de A → linha fica com org A; inserir com org B numa conversa de A → erro.
  15. `"grupo só com membro do depto"` — `team_members` com `agent2_a` (D2) em `G1` (D1) → erro.
  16. `"outsider"` — `outsider` lê 0 linhas em todas as tabelas.
  17. `"my_permissions"` — `agent_a` recebe `conversations.attend` e não recebe `members.manage`.
- [ ] **Step 4: Rodar e ver falhar** — `execute_sql` com o conteúdo do arquivo. Expected: `ERROR` (tabelas `organizations` etc. não existem).
- [ ] **Step 5: Commit** — `Teste de isolamento multi-tenant (ainda vermelho)`.

---

### Task 2: Núcleo — tabelas novas e funções de permissão

**Files:** Create `supabase/migrations/20260925000100_org_core.sql`

**Interfaces — Produces:**
- `public.org_role` enum: `owner, admin, supervisor, agent`.
- Tabelas do spec §6.1 **exatamente** como lá (incluindo `teams`, `team_members`, `audit_log.actor_type`/`agent_key`), com `organization_id` em todas as de organização; `org_secrets.secret_name text`, não `secret_id`. Timestamps `created_at/updated_at` + trigger `update_updated_at_column` existente.
- `private.role_permissions(r public.org_role) RETURNS text[]` IMMUTABLE — a matriz do §5.2, uma linha por papel (inclui `contacts.groups_manage` para owner/admin/supervisor; `conversations.view_department` para agent é resolvido por `agent_visibility`, não pela matriz).
- `private.is_platform_operator() RETURNS boolean`.
- `private.has_support_access(org uuid) RETURNS boolean` — `expires_at > now()` para `operator_id = auth.uid()`.
- `private.member_role(org uuid) RETURNS public.org_role` — papel ativo do usuário em org **ativa**; se só há suporte válido, retorna `'admin'`; senão `NULL`.
- `private.is_member(org uuid) RETURNS boolean` — `member_role(org) IS NOT NULL`.
- `private.has_permission(org uuid, perm text) RETURNS boolean` — `perm = ANY(role_permissions(member_role(org)))`, retirando `members.manage` e `org.billing` quando o acesso vem só de suporte.
- `private.in_department(dept uuid) RETURNS boolean`.
- `private.can_see_conversation(org uuid, dept uuid, assignee uuid) RETURNS boolean` — regras do §5.3 exatamente (incl. fila geral e `agent_visibility` lido de `organizations.settings`, padrão `own_and_queue`).
- `private.audit(org uuid, action text, target text, meta jsonb, actor_type text DEFAULT 'user', agent_key text DEFAULT NULL)` — único caminho de escrita no `audit_log` (SECURITY DEFINER).
- Trigger `private.guard_owner()` em `organization_members` (BEFORE UPDATE/DELETE): impede que não-owner altere/remova owner e impede que a org fique sem owner ativo.
- Trigger `private.guard_team_member()` em `team_members`: exige que o usuário esteja em `department_members` do departamento do grupo e que as `organization_id` batam.

- [ ] **Step 1:** escrever a migration.
- [ ] **Step 2:** `apply_migration` (`org_core`). Expected: sucesso.
- [ ] **Step 3:** rodar de novo o mesmo SQL (idempotência). Expected: sucesso.
- [ ] **Step 4:** commit — `Nucleo multi-tenant: organizacoes, papeis, departamentos, grupos e permissoes`.

---

### Task 3: Colunas de organização nas tabelas existentes

**Files:** Create `supabase/migrations/20260925000200_org_columns.sql`

**Interfaces — Consumes:** tabelas da Task 2. **Produces:** colunas do §6.2; triggers de herança.

- [ ] **Step 1: Colunas** — `organization_id uuid REFERENCES organizations` em `whatsapp_instances, pipeline_stages, conversations, messages, followups, agent_configs`; `conversations.assigned_to uuid REFERENCES auth.users`, `conversations.department_id uuid REFERENCES departments`; `followups.created_by uuid`; `whatsapp_instances.webhook_secret text`, `whatsapp_instances.secret_name text`; `agent_configs.organization_id` com unique.
- [ ] **Step 2: Herança** — `private.inherit_org()` BEFORE INSERT/UPDATE OF organization_id:
  - `conversations` ← `whatsapp_instances.organization_id` via `instance_id`;
  - `messages`, `followups` ← `conversations.organization_id` via `conversation_id`;
  - se `NEW.organization_id` vier preenchido e **diferente** do pai → `RAISE EXCEPTION 'organization_id diverge do registro pai'`;
  - raízes (`whatsapp_instances`, `pipeline_stages`, `agent_configs`) sem org: preencher com a **única** org ativa de `auth.uid()` (ou do `user_id` da linha quando chamado por `service_role`); se houver 0 ou 2+ → erro pedindo `organization_id`. (Compatibilidade com o app atual até o 1D.)
- [ ] **Step 3: Backfill** — se não existe organização: criar "Clubetec" (`slug 'clubetec'`, `template_key 'generico'`); o usuário com `user_roles.role='admin'` vira `owner` ativo + `platform_operators`; demais usuários de `profiles` viram `agent` ativos; `UPDATE` de `organization_id` em todas as linhas (raízes pela org Clubetec, filhas pela herança); criar departamento "Comercial".
- [ ] **Step 4:** `ALTER … SET NOT NULL` em `organization_id` de todas; índices `organization_id` em todas, `(organization_id, assigned_to)` e `(organization_id, department_id)` em `conversations`; unique de conversa vira `(organization_id, instance_id, contact_phone)` (dropar a antiga pelo nome real, consultado antes em `pg_constraint`).
- [ ] **Step 5:** `apply_migration`; conferir `SELECT count(*) FROM <t> WHERE organization_id IS NULL` = 0 em cada tabela e que as contagens de `conversations`/`messages` continuam 1/67.
- [ ] **Step 6:** commit — `Organizacao em todas as tabelas, com heranca do registro pai`.

---

### Task 4: RLS por organização

**Files:** Create `supabase/migrations/20260925000300_org_rls.sql`

- [ ] **Step 1:** `DROP POLICY IF EXISTS` de **todas** as policies atuais de `public` (listar antes com `SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname='public'` e escrever os drops pelo nome).
- [ ] **Step 2: Policies** (todas `TO authenticated`):

| Tabela | SELECT | INSERT/UPDATE (WITH CHECK igual ao USING) | DELETE |
|---|---|---|---|
| `organizations` | `is_member(id) OR is_platform_operator()` | UPDATE: `has_permission(id,'org.settings')` | — (só operador via função no 1C) |
| `organization_members` | `is_member(organization_id)` | `has_permission(organization_id,'members.manage')` (guarda de owner no trigger) | idem |
| `departments`, `department_members`, `teams`, `team_members` | `is_member(organization_id)` | `has_permission(organization_id,'departments.manage')` | idem |
| `pipeline_stages` | `is_member(organization_id)` | `has_permission(organization_id,'pipeline.manage')` | idem |
| `whatsapp_instances`, `agent_configs` | `is_member(organization_id)` — **sem** colunas de segredo: revogar `SELECT (instance_token, webhook_secret)` e `(groq_api_key)` de `authenticated` via GRANT por coluna | `has_permission(organization_id,'org.settings')` | idem |
| `conversations` | `can_see_conversation(organization_id, department_id, assigned_to)` | UPDATE: mesmo + `has_permission(organization_id,'conversations.attend')`; INSERT: `has_permission(organization_id,'conversations.attend')` | `has_permission(organization_id,'org.settings')` |
| `messages`, `followups` | `EXISTS` conversa visível (via `can_see_conversation` da conversa pai) | INSERT/UPDATE: conversa visível + `conversations.attend` | — |
| `profiles` | próprio perfil **ou** perfil de quem divide organização ativa | UPDATE: só o próprio | — |
| `audit_log` | `has_permission(organization_id,'members.manage') OR is_platform_operator()` | nenhuma (escrita só por `private.audit`) | nenhuma |
| `platform_operators`, `support_access`, `org_templates` | operador (`org_templates` SELECT também para membros, `active`) | só operador | só operador |
| `org_secrets`, `inbound_events` | nenhuma | nenhuma | nenhuma |
| `user_roles`, `app_settings` | manter leitura só do próprio / só operador; sem escrita pelo navegador | — | — |

- [ ] **Step 3:** `apply_migration`; rodar `supabase/tests/isolation.sql` — agora os casos 1–13, 15–16 devem passar; 14 e 17 dependem das Tasks 3/6 (14 já passa). Corrigir até verde, exceto 17.
- [ ] **Step 4:** `get_advisors` (security). Expected: nenhum alerta novo de RLS/`search_path`.
- [ ] **Step 5:** smoke do app: abrir o CRM logado como o owner e conferir Conversas (1 conversa, 67 mensagens), Kanban e Configurações carregando. Se algo quebrar por consulta com `user_id`, ajustar a **policy** (não o frontend) só se a regra do spec permitir; senão anotar para o 1D.
- [ ] **Step 6:** commit — `RLS por organizacao em todas as tabelas`.

---

### Task 5: Segredos no Vault

**Files:** Create `supabase/migrations/20260925000400_org_secrets.sql`

**Interfaces — Produces:**
- `private.get_secret(name text) RETURNS text` — lê `vault.decrypted_secrets` por nome; `EXECUTE` só para `service_role`.
- `public.set_org_secret(org uuid, name text, value text) RETURNS void` — exige `has_permission(org,'org.settings')`; nome `org:<org>:<name>`; `name` em lista permitida (`groq_api_key`, `uazapi_admin_token`, `meta_app_secret`); cria ou atualiza no Vault (`vault.create_secret`/`vault.update_secret`); upsert em `org_secrets`; `private.audit(org,'secret.set',name,'{}')` sem o valor.
- `public.set_instance_secret(instance uuid, value text) RETURNS void` — org da instância; mesma checagem; nome `instance:<id>:token`; grava `whatsapp_instances.secret_name`.
- Nenhuma função que devolva segredo a `authenticated`.

- [ ] **Step 1:** migration com as funções + cópia: para cada `agent_configs.groq_api_key` não nulo e cada `whatsapp_instances.instance_token` não nulo, criar o segredo por nome e **conferir** `private.get_secret(nome) = valor_original` (senão `RAISE EXCEPTION`). Colunas antigas **mantidas** (as Edge Functions atuais ainda as leem; anulação no 1C).
- [ ] **Step 2:** `apply_migration`; conferir por SQL que `org_secrets` tem as linhas e que `SELECT count(*) FROM vault.secrets WHERE name LIKE 'instance:%'` = nº de instâncias com token.
- [ ] **Step 3:** caso novo no `isolation.sql`: `"set_org_secret sem permissão"` — como `agent_a`, chamar `set_org_secret` → erro; como `owner_a` → ok e `audit_log` ganha `secret.set` sem valor. Rodar o arquivo inteiro.
- [ ] **Step 4:** commit — `Segredos no Vault com gravacao por RPC e auditoria`.

---

### Task 6: Modelos prontos, cadastro e `my_permissions`

**Files:** Create `supabase/migrations/20260925000500_org_templates_signup.sql`; Modify `scripts/check-setup.mjs`

**Interfaces — Produces:**
- Seed `org_templates` (upsert por `key`): `generico`, `clinica`, `imobiliaria`, `loja`, `servicos`, `educacao` — cada um com `version: 1`, `pipeline_stages` (3–5 etapas do segmento), `departments` (1–3), `agent.system_prompt` em português de 3–6 linhas do segmento, `agent.model: "auto"`, `settings.agent_visibility: "own_and_queue"`.
- `private.apply_template(org uuid, key text)` — cria etapas, departamentos, `agent_configs` e mescla `settings`; ignora chaves desconhecidas; só chamável por `service_role`/triggers.
- `handle_new_user` (CREATE OR REPLACE, mesmo trigger): sempre cria `profiles`; se não há operador **nem** organização → cria org, `owner`, operador e `apply_template(org,'generico')`; senão, só o perfil. (Não chama mais `seed_pipeline_stages` nem grava `user_roles`.)
- `public.my_permissions(org uuid) RETURNS text[]` — `role_permissions(member_role(org))` com o mesmo corte do suporte; `GRANT EXECUTE` a `authenticated`.

- [ ] **Step 1:** migration; `apply_migration`.
- [ ] **Step 2:** rodar `isolation.sql` inteiro — **todos** os casos verdes, `ISOLATION OK`.
- [ ] **Step 3:** caso novo no `isolation.sql`: `"cadastro não cria org"` — inserir um novo `auth.users` (já existe org) → tem `profiles`, não tem `organization_members`. Rodar de novo.
- [ ] **Step 4:** `scripts/check-setup.mjs`: incluir `organizations, organization_members, departments, department_members, teams, team_members, audit_log, org_templates, org_secrets, inbound_events, platform_operators, support_access` na lista de tabelas esperadas (as que o `anon` não lê devem ser checadas pelo mesmo método já usado para tabelas com RLS). `npm run check`. Expected: tudo OK.
- [ ] **Step 5:** commit — `Modelos prontos por segmento, cadastro e permissoes do usuario`.

---

### Task 7: Verificação final e PR

- [ ] `get_advisors` security **e** performance: sem alerta de segurança; alertas de performance só se forem de índice faltando em FK nova (criar).
- [ ] `isolation.sql` verde; `npm run build`; `npm run lint` (sem erros novos).
- [ ] Teste de ponta a ponta: mandar "oi" de outro celular para o número conectado → IA responde; conversa aparece para o owner com `organization_id` da Clubetec (conferir por SQL).
- [ ] Regenerar `src/integrations/supabase/types.ts` (`generate_typescript_types`) e commitar.
- [ ] Revisão única (inline): `grep` por `auth.uid()` sem `select` nas migrations novas; toda função `private.*` com `search_path = ''`; nenhuma policy com `USING (true)`.
- [ ] Push e PR `feat/multi-tenant-banco → main` pela web (título "Multi-tenant: banco, permissões e isolamento (1B)"), rodapé `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Merge só com pedido do usuário.

## Critério de pronto

- 5 migrations aplicadas e reaplicáveis sem erro.
- `isolation.sql` termina com `ISOLATION OK` (inclui sentinela e todas as tabelas).
- App e WhatsApp continuam funcionando como antes para o owner.
- Segredos existentes também no Vault, conferidos; nenhum caminho de leitura para o navegador.
- `get_advisors` sem alertas de segurança.

## Fica para os próximos planos

- **1C (Edge Functions):** `_shared/tenant.ts` (`forOrg`), `_shared/secrets.ts`, webhook com `inbound_events` + assinatura Meta/segredo Uazapi, `manage-members`, `platform-orgs`, `process-inbound`, `x-cron-secret`, leitura de segredos pelo Vault e **anulação das colunas antigas de segredo**.
- **1D (Frontend):** `OrgContext`, telas Equipe (membros, departamentos, grupos), Plataforma, Convite, suspensa, seletor de organização, aviso de suporte, MFA, segredos "configurada ✓".

## Notas da execução (25/09/2026)

- Executado inline, aplicado no projeto `ulmndwlralgjbwlebxmo`. `isolation.sql` verde (19 grupos de casos); sanidade confirmou que falhas aparecem como erro no `execute_sql`.
- `my_permissions` entrou na Task 2 (org_core), não na 6.
- `handle_new_user` ficou provisoriamente só com o perfil na Task 3 (o antigo semeava etapas sem organização); a versão final com criação da org na instalação vazia está na Task 6.
- Migration extra `20260925000600_revoke_legacy_has_role.sql`: `has_role` exposto via RPC permitia consultar o papel de outro usuário.
- `agent_configs.user_id` mantém UNIQUE porque o ConfigDrawer faz upsert por `user_id` (troca no 1D).
- **Trade-off aberto até 1C/1D:** `whatsapp_instances.instance_token` e `agent_configs.groq_api_key` continuam em texto (cópia conferida no Vault). `agent_configs` já é visível só a owner/admin; o token da instância é legível por membros da própria organização até o 1C anular a coluna.
- `get_advisors`: restam só itens esperados (tabelas de backend sem policy; RPCs `SECURITY DEFINER` com checagem interna). **Pendente do usuário:** ligar *Leaked password protection* em Authentication → Sign In / Providers → Email.
- Regeneração de `src/integrations/supabase/types.ts` fica para o 1D (frontend), onde os tipos novos passam a ser usados.
- **Revisão de segurança (agente revisor, Sonnet):** 7 achados; 5 corrigidos na migration `20260925000700_review_fixes.sql` e no `ConfigDrawer` — operador sem suporte não lê organizações; `webhook_secret` sai de coluna e vai para o Vault; `agent_configs` sem UNIQUE(user_id) (upsert por `organization_id`); `org_core` não reconcede `has_role`; +5 casos no `isolation.sql` (24 grupos, verde). 1 falso positivo (nome da constraint de conversa, conferido no banco).
- **Aberto para o 1C:** `inherit_org` aceita `organization_id` explícito em tabelas-raiz sem conferir; com `service_role` a defesa é o `forOrg(orgId)` + organização derivada do banco.
