# Multi-tenant, equipes e departamentos

Data: 2026-09-24
Status: aprovado para implementação
Subprojeto: 1 de 4 (ver §14)

## 1. Problema

O ClubeCRM hoje é "um CRM por usuário": toda linha tem `user_id` e a RLS só
deixa cada pessoa ver o que é dela. Isso impede três coisas que o negócio precisa:

1. **Trabalho em equipe.** Dois atendentes não enxergam a mesma fila, não há
   responsável por conversa, não há departamento, não há transferência.
2. **Vender como SaaS.** Não existe a noção de "empresa cliente". Chaves de IA e
   da Uazapi são globais (`app_settings`), então todos os clientes de uma mesma
   instalação dividiriam a mesma cota e a mesma conta.
3. **Segurança de nível comercial.** Segredos em texto puro, webhook da Meta sem
   verificação de assinatura, função de cron chamável por qualquer um com a anon
   key, e nenhum teste automatizado de isolamento.

## 2. Objetivo

Tornar o sistema **multi-tenant** (organizações isoladas entre si), com papéis
fixos por organização, departamentos, convites, painel de operação da plataforma
e modelos prontos por segmento — **sem vazamento de dados entre organizações**
como requisito inegociável.

A Clubetec é a primeira organização ("cliente zero") e continua operando durante
e depois da migração.

## 3. Não faz parte deste escopo

- Cadastro self-service e cobrança automática (a ativação é feita pela plataforma).
- Papéis personalizáveis (a matriz de permissões fica pronta para isso, sem tela).
- Telas de fila, transferência, finalização, envio de arquivos, respostas rápidas
  e etiquetas → subprojeto 2. Aqui entram só as colunas que a RLS já precisa.
- Construtor de fluxo/chatbot → subprojeto 3.
- Gestão de vários números na interface → subprojeto 4.
- Embedded Signup da Meta (cliente conectar o número sozinho pelo Facebook).

## 4. Modelo de implantação (abordagem híbrida)

O mesmo código roda de dois jeitos:

| Modo | Para quem | Como |
|------|-----------|------|
| **Compartilhado** | planos menores | um Supabase com várias organizações |
| **Dedicado** | clientes grandes / exigência de isolamento físico | uma instalação com uma organização só |

Não há código condicional por modo. Uma instalação dedicada é simplesmente uma
instalação onde existe uma organização.

## 5. Papéis e permissões

### 5.1 Nível plataforma

- **Operador da plataforma** (`platform_operators`): cria, suspende e reativa
  organizações; aplica modelos; abre acesso de suporte. MFA obrigatório.
- Operador **não** enxerga dados de organizações por ser operador. Para ver, abre
  um **acesso de suporte** (§5.4).

### 5.2 Nível organização

Enum `org_role`: `owner`, `admin`, `supervisor`, `agent`.

| Permissão | owner | admin | supervisor | agent |
|---|:-:|:-:|:-:|:-:|
| `org.billing` — plano, excluir organização | ✅ | | | |
| `org.settings` — números, chaves, IA, fluxos, config. da org | ✅ | ✅ | | |
| `members.manage` — convidar, mudar papel, desativar | ✅ | ✅ | | |
| `departments.manage` | ✅ | ✅ | | |
| `pipeline.manage` — etapas do funil | ✅ | ✅ | | |
| `conversations.view_all` | ✅ | ✅ | | |
| `conversations.view_department` | ✅ | ✅ | ✅ | ⚙️ |
| `conversations.reassign` — reatribuir, puxar de outro | ✅ | ✅ | ✅ | |
| `reports.view` | ✅ | ✅ | ✅ | |
| `library.manage` — respostas rápidas, etiquetas | ✅ | ✅ | ✅ | |
| `conversations.attend` — atender, transferir, finalizar, enviar | ✅ | ✅ | ✅ | ✅ |

⚙️ Depende de `organizations.settings.agent_visibility`:
- `own_and_queue` (padrão): atendente vê as conversas atribuídas a ele e as
  **não atribuídas** dos departamentos dele (a fila).
- `department`: atendente vê todas as conversas dos departamentos dele.

Regras adicionais:
- Admin não pode alterar, rebaixar nem remover um `owner`.
- Toda organização tem no mínimo um `owner` ativo (garantido por trigger).
- A matriz é implementada numa única função SQL (`private.role_permissions(role)`),
  não em `if` espalhados. O frontend lê a mesma matriz via RPC
  `my_permissions(org_id)` — só para esconder botões; quem garante é a RLS.

### 5.3 Visibilidade de conversas

`private.can_see_conversation(conv)` retorna verdadeiro se o usuário é membro
ativo da organização da conversa (e a organização está ativa) **e**:

- tem `conversations.view_all`; ou
- a conversa está atribuída a ele (`assigned_to = auth.uid()`); ou
- tem `view_department` e a conversa está num departamento dele; ou
- é `agent` em modo `own_and_queue`, a conversa está num departamento dele e
  `assigned_to IS NULL`; ou
- a conversa não tem departamento e não tem responsável (**fila geral** da
  organização) — visível a todo membro ativo com `conversations.attend`, ou
  seja, a todos os papéis. Até o subprojeto 3 existir, toda conversa nova nasce
  na fila geral; sem esta regra, atendentes não veriam nada.

`messages`, `followups` e demais filhos de conversa herdam essa regra.

### 5.4 Acesso de suporte

- O operador abre um registro em `support_access` com **motivo obrigatório** e
  duração máxima de 2 horas.
- Enquanto válido, o operador tem na organização as permissões de `admin`
  **menos** `members.manage` e `org.billing`.
- Abertura e uso ficam no `audit_log`. A organização vê, no topo da tela, um
  aviso "Suporte ClubeCRM com acesso até HH:MM" enquanto o acesso estiver ativo.
- Expirado, o acesso some sozinho (a verificação compara com `now()`, não
  depende de job).

## 6. Modelo de dados

Migration nova: `supabase/migrations/20260925000000_multi_tenant.sql`,
idempotente. A `20260101000000_q7_init.sql` não é alterada.

### 6.1 Tabelas novas

```
organizations
  id uuid pk, name text, slug text unique, status text ('active'|'suspended'),
  plan text, template_key text, settings jsonb, created_by uuid, timestamps

organization_members
  organization_id fk, user_id fk auth.users, role org_role,
  status text ('invited'|'active'|'disabled'), invited_by uuid, timestamps
  pk (organization_id, user_id)

departments
  id, organization_id fk, name, color, business_hours jsonb null, timestamps
  unique (organization_id, name)

department_members
  department_id fk, user_id fk, organization_id fk
  pk (department_id, user_id)

platform_operators
  user_id pk fk auth.users, created_at

support_access
  id, organization_id fk, operator_id fk, reason text not null,
  expires_at timestamptz, created_at

audit_log
  id bigint identity, organization_id null, actor_id uuid, action text,
  target text, meta jsonb, created_at
  -- somente INSERT (sem policy de UPDATE/DELETE para ninguém)

org_templates
  key text pk, name, description, payload jsonb, active bool, timestamps

org_secrets
  organization_id fk, name text, secret_id uuid (vault), updated_by, updated_at
  pk (organization_id, name)

inbound_events
  id, organization_id fk, instance_id fk, provider text,
  provider_message_id text, payload jsonb,
  status text ('pending'|'processed'|'failed'|'skipped'),
  attempts int, error text, created_at, processed_at
  unique (instance_id, provider_message_id)
```

`settings` da organização (jsonb, com defaults na leitura):
`agent_visibility`, `require_mfa_admins`, `ai_rate_limit_per_minute`.

### 6.2 Tabelas existentes

| Tabela | Mudança |
|---|---|
| `whatsapp_instances` | + `organization_id not null`; + `webhook_secret` (Uazapi); `instance_token` migra para Vault |
| `pipeline_stages` | + `organization_id not null` (funil compartilhado pela org) |
| `conversations` | + `organization_id not null`, + `assigned_to uuid null`, + `department_id uuid null`; unique vira `(organization_id, instance_id, contact_phone)` |
| `messages` | + `organization_id not null` |
| `followups` | + `organization_id not null`, + `created_by uuid null` |
| `agent_configs` | chave passa a ser `organization_id`; `groq_api_key` migra para Vault |
| `app_settings` | passa a ser **só da plataforma** (operadores); segredos migram para Vault |

As colunas `user_id` antigas ficam (nullable) nesta migration para não haver
perda de dados; deixam de ser usadas em RLS e em código. Serão removidas numa
migration futura, após verificação, com confirmação explícita.

`user_roles` / `app_role` / `has_role` deixam de ser usados (substituídos por
`organization_members` e `platform_operators`). Não são apagados aqui.

Índices: `organization_id` em todas as tabelas; `(organization_id, assigned_to)`
e `(organization_id, department_id)` em `conversations`.

### 6.3 Segredos no Vault

| Segredo | Escopo |
|---|---|
| Chave da Groq | organização (`org_secrets`) |
| Admin token da Uazapi (+ server URL em coluna comum) | organização |
| Token de cada instância (Uazapi ou Cloud) | instância (`secret_id` em `whatsapp_instances`) |
| Meta App Secret e Verify Token | plataforma; instância pode sobrescrever o App Secret (cliente com app Meta próprio) |
| Segredo do cron | plataforma |

- Gravação: RPC `set_org_secret(org_id, name, value)` e
  `set_instance_secret(instance_id, value)`, `SECURITY DEFINER`, conferem
  `org.settings` antes de gravar.
- Leitura: só `service_role` (Edge Functions), via `private.get_secret(...)`.
  **Não existe caminho para o navegador ler um segredo.** A interface mostra
  apenas "configurada ✓" e a data da última troca.
- Troca de segredo gera linha no `audit_log` (sem o valor).
- **Referências ao Vault são sempre pelo nome do segredo, nunca pelo `id`**,
  com nomes determinísticos: `org:<organization_id>:<nome>`,
  `instance:<instance_id>:token`, `platform:<nome>`. Motivo: numa restauração
  em outro projeto (§15), os segredos são recriados com ids novos; referência
  por nome continua válida sem remapeamento. As colunas `secret_id` citadas
  neste spec são, portanto, `secret_name text`.

### 6.4 RLS

- RLS habilitada em **todas** as tabelas de `public`; tabelas só do backend
  (`inbound_events`, `org_secrets`) ficam com RLS ligada e nenhuma policy
  (negação total para `authenticated`).
- Funções auxiliares em `private`, `SECURITY DEFINER STABLE`, com
  `search_path` fixo: `is_member`, `has_permission`, `can_see_conversation`,
  `is_platform_operator`, `has_support_access`.
- Nas policies, `auth.uid()` sempre como `(select auth.uid())` para ser
  avaliado uma vez por consulta.
- Escrita: `WITH CHECK` sempre confere `organization_id` contra a associação do
  usuário — não é possível inserir linha em organização alheia.
- Organização `suspended`: `is_member` retorna falso para membros comuns.

### 6.5 Migração dos dados existentes

Dentro da migration, na ordem, idempotente:

1. Cria a organização "Clubetec" (se não houver nenhuma organização).
2. O usuário com `user_roles.role = 'admin'` vira `owner` dela e operador da
   plataforma; demais usuários existentes viram `agent` ativos.
3. Preenche `organization_id` em todas as linhas existentes e só então aplica
   `NOT NULL`.
4. Copia segredos em texto puro para o Vault; confere que a leitura via
   `private.get_secret` devolve o mesmo valor; só então anula a coluna antiga.
5. Nada em `conversations` ou `messages` é apagado.

### 6.6 Gatilho de cadastro

`handle_new_user` passa a:
- sempre criar `profiles`;
- se não existe nenhum operador **e** nenhuma organização (instalação vazia):
  tornar o usuário operador e `owner` de uma organização nova, aplicando o
  modelo `generico`;
- caso contrário, não criar nada além do perfil. A associação a organizações
  vem exclusivamente de convite (§8.2).

A regra 1 do CLAUDE.md (migration antes do primeiro cadastro) continua valendo.

## 7. Modelos prontos

`org_templates.payload` (versionado com `"version": 1`):

```json
{
  "version": 1,
  "pipeline_stages": [{ "name": "Novo Lead", "color": "#3FB8BE" }],
  "departments": [{ "name": "Comercial", "color": "#..." }],
  "agent": { "system_prompt": "...", "model": "llama-3.3-70b-versatile" },
  "settings": { "agent_visibility": "own_and_queue" }
}
```

Modelos iniciais: `generico`, `clinica`, `imobiliaria`, `loja`, `servicos`,
`educacao`. Os subprojetos 2 e 3 acrescentam chaves (`tags`, `quick_replies`,
`flow`) — aplicar um modelo ignora chaves desconhecidas e tolera ausentes.

`private.apply_template(org_id, template_key)` aplica o modelo numa organização
recém-criada. Só é chamada por `platform-orgs` e pelo gatilho de cadastro.
Depois de aplicado, tudo é editável pela organização; o modelo não fica
"vinculado".

## 8. Backend (Edge Functions)

### 8.1 Regras gerais

- Funções chamadas por usuário: identificar o usuário pelo JWT, conferir
  associação e permissão **no banco** (`has_permission`). Um `organization_id`
  vindo do corpo da requisição é só uma pergunta, nunca uma credencial.
- Funções com `service_role` usam `_shared/tenant.ts`:
  `forOrg(orgId)` devolve um acessor que injeta `organization_id` em todo
  select/insert/update/delete. É o único jeito aceito de acessar tabelas de
  organização com `service_role`; um `grep` por `.from(` fora de `tenant.ts`
  nas funções faz parte da revisão. É a principal defesa contra vazamento via
  `service_role`.
- `_shared/secrets.ts`: leitura de segredos do Vault com cache curto (60s),
  chaveado por organização.

### 8.2 Funções novas

| Função | JWT | Quem pode | Faz |
|---|---|---|---|
| `platform-orgs` | sim | operador | criar org (nome, modelo, e-mail do owner), suspender, reativar, abrir acesso de suporte, listar orgs com uso |
| `manage-members` | sim | `members.manage` | convidar (e-mail, papel, departamentos), mudar papel, desativar, reenviar convite |
| `process-inbound` | não (segredo de cron) | cron | reprocessa `inbound_events` `failed` ou `pending` há mais de 2 min, até 5 tentativas |

Convite: se o e-mail não tem conta, `auth.admin.inviteUserByEmail` (o convidado
define a senha); se já tem conta, cria a associação `invited` e o usuário aceita
ao entrar. Limite de 20 convites por hora por organização. Requer SMTP próprio
configurado no Supabase Auth (o SMTP padrão do Supabase tem limite baixo).

### 8.3 Webhook (`whatsapp-webhook`)

```
recebe → autentica origem → resolve instância → organização (do banco)
       → grava inbound_events (dedup por provider_message_id) → 200 imediato
       → processa em EdgeRuntime.waitUntil: conversa, mensagem, IA, envio
       → marca processed | failed | skipped
```

- **Cloud API:** valida `X-Hub-Signature-256` (HMAC-SHA256 do corpo bruto) com
  o App Secret efetivo da instância. Assinatura ausente ou inválida → 401 e nada
  é gravado. A instância é resolvida pelo `phone_number_id` antes da validação,
  apenas para escolher qual segredo usar.
- **Uazapi:** a URL configurada na Uazapi passa a ser
  `.../whatsapp-webhook?k=<webhook_secret>`. Segredo ausente ou diferente do da
  instância → 401. Comparação em tempo constante.
- Organização suspensa → evento gravado como `skipped`, sem resposta.
- Limite de respostas da IA por organização por minuto
  (`ai_rate_limit_per_minute`); excedente fica `pending` e o
  `process-inbound` pega depois. Um cliente com pico não atrasa os outros.
- Retenção: eventos `processed`/`skipped` com mais de 30 dias são apagados pelo
  cron.

### 8.4 Funções existentes

- `run-followups`: passa a exigir o cabeçalho `x-cron-secret` (hoje qualquer um
  com a anon key, que é pública, consegue dispará-la). Processa por organização.
- `manage-instance`, `test-ai-connection`, `test-uazapi`: recebem
  `organization_id`, conferem `org.settings`, leem segredos do Vault.
- `supabase/setup/cron.sql`: passa a enviar `x-cron-secret` e agenda também o
  `process-inbound`.

## 9. Frontend

- `src/contexts/OrgContext.tsx`: organização ativa, papel, permissões
  (`my_permissions`), `can(perm)`. Organização ativa lembrada em `localStorage`
  (só o id) e sempre revalidada contra as associações do usuário.
- Todas as consultas deixam de filtrar por `user_id` e passam a usar a
  organização ativa. Filtragem de visibilidade fica a cargo da RLS.
- Telas novas:
  - **Equipe** (`/equipe`): membros, convites pendentes, papéis, departamentos
    e seus membros. Visível com `members.manage` ou `departments.manage`.
  - **Plataforma** (`/plataforma`): organizações, criar a partir de modelo,
    suspender/reativar, acesso de suporte, `audit_log`. Só operadores.
  - **Aceitar convite / definir senha** (`/convite`).
  - **Conta suspensa**.
  - **Seletor de organização** no cabeçalho (só com 2+ organizações).
  - **Aviso de acesso de suporte** ativo.
- Configurações (ConfigDrawer): campos de segredo viram "configurada ✓ /
  trocar", nunca exibem o valor.
- `useAdminRole` é substituído por `can(...)`.
- MFA: fluxo de cadastro de TOTP no primeiro login de operador (obrigatório) e
  de owner/admin quando `require_mfa_admins` estiver ligado. Operações de
  plataforma e troca de segredos exigem sessão `aal2` quando o MFA é exigido.

## 10. Segurança — resumo das garantias

1. Isolamento por organização em RLS, em todas as tabelas, com teste-sentinela.
2. `service_role` só por meio de `forOrg(orgId)`.
3. Organização sempre derivada do banco (instância, associação), nunca do cliente.
4. Segredos no Vault, só de escrita para o navegador.
5. Webhook autenticado (assinatura Meta / segredo Uazapi) e deduplicado.
6. Cron autenticado por segredo.
7. `audit_log` imutável.
8. MFA obrigatório para operadores.
9. Cadastro público desligado; proteção contra senhas vazadas ligada.
10. `get_advisors` (segurança) sem alertas antes de cada deploy.

## 11. Testes

### 11.1 Isolamento (`supabase/tests/isolation.sql`)

Roda inteiro dentro de `BEGIN … ROLLBACK` (não deixa dados), simulando usuários
com `set local role authenticated` + `request.jwt.claims`. Asserções em
PL/pgSQL puro (`RAISE EXCEPTION` na primeira falha, com o nome do caso), sem
depender de pgTAP.

Cenário: organizações A e B; em A um usuário de cada papel, dois departamentos,
conversas atribuídas, não atribuídas e sem departamento; B com dados espelhados.

Verifica:
- Para **cada tabela** de `public`: usuário de A não lê, não insere, não altera
  e não apaga linha de B.
- Visibilidade de atendente nos dois modos de `agent_visibility`; supervisor
  restrito aos departamentos dele; admin vê tudo da própria org.
- Admin não mexe em owner; não é possível ficar sem owner.
- Organização suspensa: membro não lê nada.
- Suporte: operador sem acesso não lê; com acesso lê; após `expires_at` não lê.
- `authenticated` não lê `org_secrets`, `inbound_events` nem o Vault; não
  altera nem apaga `audit_log`.
- **Sentinela:** falha se qualquer tabela de `public` estiver sem RLS.

Execução: `execute_sql` via MCP ou colando no SQL Editor. Sem Docker local, roda
contra o projeto de homologação (§12) e, depois, em produção (o `ROLLBACK`
garante que nada fica gravado).

### 11.2 Edge Functions

- Webhook: assinatura Meta inválida → 401; segredo Uazapi errado → 401; evento
  repetido → um só registro; org suspensa → `skipped`.
- `manage-members`: agent/supervisor recebe 403; admin não altera owner.
- `platform-orgs`: não-operador recebe 403.
- `run-followups` / `process-inbound` sem `x-cron-secret` → 401.

### 11.3 Verificação final

`npm run check` atualizado (tabelas novas, funções novas), `npm run build`,
`npm run lint`, `get_advisors` sem alertas de segurança, e teste de ponta a ponta
na Clubetec: mensagem chega, IA responde, atendente convidado vê a fila.

## 12. Implantação

0. **Backup externo (§15) funcionando e com uma restauração testada** — é a
   primeira entrega deste subprojeto e precisa existir antes da migration.
1. **Homologação:** projeto Supabase separado (o plano Free permite 2). Aplica
   todas as migrations, popula dados fictícios, roda §11.
2. **Backup de produção:** `supabase db dump` antes de aplicar.
3. Aplica a migration em produção, deploy das funções, atualiza `cron.sql`,
   reconfigura a URL do webhook da Uazapi (com `?k=`) e o App Secret da Meta.
4. Roda §11.1 em produção (rollback garante que não suja dados) e §11.3.
5. Liga MFA e SMTP próprio no Auth.

## 13. Riscos

| Risco | Mitigação |
|---|---|
| Migração deixar a Clubetec sem acesso | homologação primeiro; backup; migration idempotente |
| Falha de RLS vazar dados entre clientes | funções centrais únicas + teste por tabela + sentinela |
| Esquecer filtro em código com `service_role` | `forOrg(orgId)` obrigatório; revisão de código focada nisso |
| Custo do Realtime com RLS mais complexa | funções `STABLE` e índices; monitorar; limitar canais por tela |
| Instalação compartilhada cair derruba todos | oferta de instalação dedicada; mensagens não se perdem (inbound_events + reprocessamento) |
| SMTP padrão bloquear convites | SMTP próprio como pré-requisito de produção |

## 14. Roteiro dos subprojetos

1. **Este:** multi-tenant, equipes, departamentos, papéis, plataforma, modelos.
2. Atendimento humano: fila, atribuir, transferir, finalizar, envio de mídia
   (Storage com caminho por organização), respostas rápidas, etiquetas.
3. Construtor de fluxo: menu, IA ou humano, horário, permissões da IA
   (enviar arquivo, transferir, finalizar), pesquisa de satisfação.
4. Gestão de vários números (Meta e Uazapi) na interface, cada um ligado a um
   fluxo.

## 15. Backup externo e recuperação de desastre

### 15.1 Objetivo

Sobreviver ao pior caso — conta do Supabase comprometida, projeto apagado,
ransomware, erro humano em migration — com os dados guardados **fora do
Supabase**, cifrados e **imutáveis**.

Metas: **RTO 4 h** (sistema de volta) e **RPO 24 h** (perda máxima). Com o PITR
do Supabase Pro (add-on pago, opcional), o RPO do dia a dia cai para minutos; o
backup externo continua sendo a defesa contra comprometimento da conta.

### 15.2 Destino: plugável, com Backblaze B2 como padrão

O destino não é fixo no código. Uma camada fina (`scripts/backup/destinations.sh`)
traduz a escolha feita em variáveis do GitHub (`BACKUP_PROVIDER`) para a
configuração do `rclone`. Estes são os provedores suportados:

| `BACKUP_PROVIDER` | Serviço | Imutabilidade no bucket |
|---|---|---|
| `b2` | Backblaze B2 (padrão da Clubetec) | Object Lock |
| `aws` | Amazon S3 (inclusive `sa-east-1`, São Paulo) | Object Lock |
| `wasabi` | Wasabi | Object Lock |
| `r2` | Cloudflare R2 | Bucket Locks |
| `magalu` | Magalu Cloud (dados no Brasil) | conferir no painel; se não houver, usar só como destino secundário |
| `gcs` | Google Cloud Storage | Bucket Lock (retention policy) |
| `azure` | Azure Blob Storage | Immutability policy |
| `s3` | outro serviço compatível com S3 (MinIO, DigitalOcean Spaces, Oracle, Contabo…) | Object Lock, se o serviço oferecer |
| `rclone` | qualquer serviço do rclone (Google Drive, OneDrive, Dropbox, SFTP…) | **nenhuma** |

- Existe um **destino secundário** opcional (`BACKUP2_*`) para a regra 3-2-1,
  por exemplo B2 nos EUA mais AWS `sa-east-1` ou Magalu no Brasil.
- Serviços sem imutabilidade (`rclone`) só são aceitos como destino principal com
  `BACKUP_ALLOW_MUTABLE=true`. Isso é um **trade-off explícito**: quem invadir o
  GitHub consegue apagar esses backups. O recomendado é usá-los apenas como
  destino secundário.
- A cada execução, o job faz uma **prova de não-apagamento**: grava um arquivo
  de sonda e tenta apagá-lo com a própria chave do backup. Se conseguir, o job
  falha, porque a chave ou a trava do bucket estão mal configuradas.
- O passo a passo de cada provedor está em `docs/backup-destinos.md`:
  buckets, trava, chave mínima e região.

Buckets padrão, com os mesmos nomes em qualquer provedor (há variáveis para
renomear onde o nome precisa ser único no mundo):

| Bucket | Conteúdo | Object lock (modo compliance) | Ciclo de vida |
|---|---|---|---|
| `clubecrm-backup-daily` | dump diário + segredos | 35 dias | oculta após 36 dias, apaga 1 dia depois |
| `clubecrm-backup-monthly` | dump do dia 1 + segredos | 365 dias | oculta após 366 dias, apaga 1 dia depois |
| `clubecrm-backup-media` | espelho cifrado do Storage | 35 dias | versões ocultas (arquivo apagado ou substituído na origem) apagadas após 365 dias |

A mídia tem bucket próprio porque é copiada de forma incremental: um arquivo
enviado uma vez não é reenviado, então uma regra "apaga após 36 dias" o
removeria do backup enquanto ele ainda existe no Storage. No bucket de mídia,
o `rclone sync` oculta (não apaga) o que sumiu da origem, e o ciclo de vida
remove essas versões ocultas após 365 dias — coerente com "backups expiram em
até 12 meses".

- Modo **compliance**: nem a conta dona do bucket consegue apagar ou encurtar a
  retenção antes do prazo.
- A chave de aplicação usada pelo job tem só `listFiles` e `writeFiles` nos dois
  buckets — sem `deleteFiles`, sem acesso a outros buckets. Nos demais
  provedores vale o equivalente: gravar e listar em `daily`/`monthly`, sem
  permissão de apagar. Em `media` a permissão de apagar é aceita, porque ali
  apagar só cria um marcador e a versão travada continua guardada.

### 15.3 O que é copiado

1. **Banco inteiro**, pelo procedimento oficial da Supabase para backup via CLI
   (arquivos de roles, schema e dados), incluindo `auth.users` — sem isso
   ninguém consegue logar após a restauração.
2. **Segredos do Vault**, em arquivo separado. Motivo: o Vault é cifrado com
   chave do próprio projeto; restaurado em outro projeto, não abre. O job lê
   `vault.decrypted_secrets` e envia **direto por pipe** para a cifragem — o
   conteúdo em claro nunca toca o disco do runner.
3. **Arquivos do Storage** (todos os buckets), espelhados de forma incremental
   (`rclone sync`, que no B2 oculta em vez de apagar) para
   `clubecrm-backup-media`, com `rclone crypt`.

O dump de dados exclui `vault.secrets` (cifrado com a chave do projeto, inútil
em outro projeto); os segredos vão pelo item 2.

### 15.4 Cifragem

- Dump e segredos: cifrados com **age** usando uma **chave pública** versionada
  no repositório. A **chave privada fica offline** (cofre de senhas + mídia
  física), fora de qualquer servidor ou do GitHub. Quem obtiver só o backup não
  consegue ler o banco. (Exceção documentada em §15.6: a chave do teste
  automático de restauração.)
- Mídia: `rclone crypt` com senha em segredo do GitHub (também guardada
  offline). Trade-off aceito: quem comprometer os segredos do GitHub consegue
  ler a mídia copiada, mas não apagá-la (object lock).

### 15.5 Execução

- `.github/workflows/backup.yml`: agendado diariamente às 03:00 (Brasília);
  no dia 1 grava também no bucket mensal.
- Scripts em `scripts/backup/`.
- Segredos do GitHub: string de conexão do banco (pooler de sessão), chave B2,
  senha do `rclone crypt`, URL de pulso do monitor.
- **Alertas:** falha do workflow → e-mail do GitHub; e um monitor "dead man's
  switch" (healthchecks.io, gratuito) que avisa se o backup **não rodar** em 26 h.

### 15.6 Teste de restauração mensal

`.github/workflows/restore-test.yml`, dia 2 de cada mês:
1. sobe um container `supabase/postgres` da mesma versão do projeto;
2. baixa e decifra o backup mais recente (a chave privada **não** vai para o
   GitHub: o teste usa um par de chaves próprio, e o job diário cifra para
   **dois destinatários** — a chave offline e a chave de teste);
3. restaura, compara contagem de linhas das tabelas principais com a registrada
   no dia do backup e roda `supabase/tests/isolation.sql`;
4. falhou → alerta.

O teste usa uma chave B2 própria, **só de leitura** (`listFiles`, `readFiles`),
diferente da chave do job diário.

**Trade-off explícito:** a chave privada de teste e a chave B2 de leitura ficam
nos segredos do GitHub. Quem comprometer a conta do GitHub consegue **ler** o
backup do banco (não consegue apagá-lo). Isso contradiz a garantia de §15.4 para
o caso "GitHub comprometido" e foi aceito porque um backup nunca restaurado é um
risco maior. Mitigações obrigatórias: 2FA em todas as contas com acesso ao
repositório; repositório privado; a chave de teste pode ser trocada a qualquer
momento sem invalidar backups antigos (a chave offline continua valendo).
Alternativa mais restrita, se preferida no futuro: teste manual mensal na
máquina de um operador, com a chave offline.

### 15.7 Exportação por organização

`scripts/export-org.mjs <organization_id>`: extrai todas as linhas da
organização (tabela por tabela, filtrando por `organization_id`) e seus
arquivos, em JSON + pasta de mídia, cifrado com age. Usos:
- restaurar **um** cliente na instalação compartilhada sem afetar os outros;
- entregar os dados a um cliente que cancela (portabilidade, LGPD).

Registra a exportação no `audit_log`.

### 15.8 Runbook de desastre

`docs/runbook-desastre.md`, passo a passo para:
- **Supabase fora do ar** (aguardar vs. subir em outro projeto);
- **conta comprometida** (trocar credenciais, novo projeto, restaurar, trocar
  segredos da Meta/Uazapi/Groq, apontar webhooks, redeploy na Vercel);
- **erro de dados** (restaurar uma organização com `export-org` / import).

O runbook é executado de verdade uma vez, em homologação, antes de ser
considerado pronto.

## 16. Revisão de segurança e LGPD (transversal aos subprojetos 1–3)

Achados da revisão feita após o desenho dos três subprojetos. Cada item é
requisito de implementação do subprojeto indicado.

### 16.1 Banco e API (subprojeto 1)

1. **Privilégios do `anon`.** As permissões padrão do Supabase concedem acesso
   ao papel `anon` em tabelas novas de `public`. A migration faz
   `REVOKE ALL ON ALL TABLES/SEQUENCES/FUNCTIONS IN SCHEMA public FROM anon` e
   ajusta `ALTER DEFAULT PRIVILEGES` para que tabelas futuras nasçam sem
   acesso do `anon`. Todas as policies novas usam `TO authenticated`.
2. **Funções expostas como RPC.** Toda função em `public` é chamável pela API.
   Regras: funções internas ficam em `private` (não exposto); funções RPC em
   `public` começam validando `auth.uid()` e permissão; `REVOKE EXECUTE … FROM
   PUBLIC, anon` em todas.
3. **Sentinelas adicionais** em `isolation.sql`: falha se `anon` tiver qualquer
   privilégio em tabela de `public`; falha se houver função `SECURITY DEFINER`
   em `public` executável por `anon`; falha se alguma função `SECURITY
   DEFINER` não tiver `search_path` fixo.
4. **Realtime**: usar só `postgres_changes` (respeita RLS). Não usar canais
   `broadcast`/`presence` públicos; se forem necessários no futuro, só com
   canais privados e Realtime Authorization.
5. **Enumeração de e-mails**: `manage-members` responde de forma idêntica se o
   e-mail convidado já tem conta ou não.
6. **Membro desativado**: além de perder acesso pela RLS (imediato), tem as
   sessões encerradas (`auth.admin.signOut` no escopo global).

### 16.2 Logs (subprojeto 1)

7. **Dado pessoal em log.** Hoje o webhook registra telefone completo
   (`console.log` com `phone`). Regra: logs nunca contêm conteúdo de mensagem,
   nome ou telefone completo; telefone aparece mascarado (`5511*****4321`);
   ids internos são permitidos. Helper `_shared/log.ts` com a máscara;
   revisão de código confere.
8. O segredo da Uazapi vai na query string (`?k=`) e pode aparecer em logs de
   requisição da plataforma. Aceito (acesso aos logs é restrito aos
   operadores); o segredo pode ser trocado a qualquer momento pela tela do
   número.

### 16.3 Frontend e hospedagem (subprojeto 1)

9. **Cabeçalhos de segurança** no `vercel.json`: `Content-Security-Policy`
   (scripts só do próprio domínio; `connect-src` só o Supabase do projeto;
   `frame-ancestors 'none'`), `Strict-Transport-Security`,
   `X-Content-Type-Options: nosniff`, `Referrer-Policy:
   strict-origin-when-cross-origin`, `Permissions-Policy` (microfone só
   `self`, para o áudio; câmera e geolocalização desligadas).
   Exceção única (subprojeto 4, Embedded Signup): `script-src` libera
   `https://connect.facebook.net`; `frame-src`/`connect-src` liberam
   `https://www.facebook.com` e `https://web.facebook.com`.
10. **XSS**: o token de sessão do Supabase fica no `localStorage`, então XSS =
    sequestro de conta. Regras: proibido `dangerouslySetInnerHTML` com dado de
    usuário/cliente (lint); links em mensagens com `rel="noopener noreferrer"`
    e só `http(s)`; a CSP acima é a segunda barreira.
11. **Senhas e login**: mínimo de 10 caracteres, proteção contra senhas
    vazadas, limites de tentativa do Supabase Auth. **MFA:** obrigatório para
    operadores; `require_mfa_admins` passa a vir **ligado por padrão** para
    owner e admin (podem desligar, fica no `audit_log`).
12. **Dependências**: Dependabot e `npm audit --audit-level=high` no CI; a
    dependência `xlsx` via CDN fica fixada por versão.

### 16.4 Operação (subprojeto 1)

13. **Acesso de suporte** notifica o owner da organização por e-mail no momento
    da abertura (além do aviso na tela e do `audit_log`).
14. **Retenção do `audit_log`**: 5 anos; apagamento só por job da plataforma.
15. **Encerramento de organização** (cliente cancela): exportação entregue
    (`export-org`), organização suspensa, **exclusão definitiva após 30 dias**
    (com confirmação de um operador, registrada), incluindo Storage e segredos
    do Vault. Os backups expiram naturalmente em até 12 meses — informado no
    contrato.
16. Job de backup: `set +x` e mascaramento de segredos nos logs do GitHub
    Actions; nenhum arquivo em claro gravado no runner.

### 16.5 LGPD — papéis e documentos (fora do código, pré-requisito de venda)

17. **Papéis**: o cliente (organização) é o **controlador** dos dados dos
    contatos dele; a Clubetec é **operadora**. Necessário: Termos de Uso +
    **Contrato de Tratamento de Dados (DPA)** com a lista de suboperadores:
    Supabase, Vercel, Groq (IA e transcrição), Meta, Uazapi, Backblaze.
18. **Transferência internacional**: Groq, Vercel e Backblaze processam fora do
    Brasil. Deve constar no DPA. O projeto Supabase de produção compartilhada
    deve ficar na região **São Paulo (`sa-east-1`)**; a região do projeto atual
    será conferida e, se for outra, isso entra na decisão de onde criar a
    instalação compartilhada.
19. **Encarregado (DPO)** da Clubetec identificado na política de privacidade
    publicada.
20. **Incidente**: o runbook (§15.8) ganha a seção "vazamento de dados":
    conter, avaliar, comunicar clientes afetados e ANPD no prazo legal.
21. **Monitoramento de funcionários**: presença e tempo de pausa dos
    atendentes (subprojeto 2) são dados pessoais dos funcionários do cliente —
    mencionado nos Termos, para o cliente informar a própria equipe.
