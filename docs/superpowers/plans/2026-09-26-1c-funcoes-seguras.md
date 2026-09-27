# 1C — Edge Functions multi-tenant e segredos só no Vault — Implementation Plan

> **For agentic workers:** executar **inline** (superpowers:executing-plans). Plano enxuto: arquivos, interfaces, regras e testes; o código é escrito uma vez, na execução. Revisão única no fim com o agente `revisor-seguranca-qualidade`.

**Goal:** Toda Edge Function passa a saber de qual organização é cada operação (derivado do banco), conferir permissão do usuário, ler segredos só do Vault e aceitar webhook só de origem autenticada — e o token do número deixa de passar pelo navegador.

**Architecture:** Três módulos compartilhados (`auth.ts`, `tenant.ts`, `secrets.ts`) usados por todas as funções. Webhook Uazapi autenticado por `?i=<instance_id>&k=<segredo>`; Cloud API pela assinatura `X-Hub-Signature-256`. Busca legada (por token/nome/telefone) só vale para número que ainda não tem segredo de webhook, e o token é comparado por hash. Frontend troca "token" por `instance_id` e grava segredos pelas RPCs da 1B. Por fim, as colunas de segredo em texto são anuladas.

**Tech Stack:** Deno Edge Functions, supabase-js 2.49, Postgres (Vault, pgcrypto), React (ajustes pontuais em `ConfigDrawer.tsx` e `Conversas.tsx`).

**Spec:** `docs/superpowers/specs/2026-09-24-multi-tenant-equipes-design.md` §6.3, §8.1–8.4, §10, §11.2.

## Global Constraints

- Projeto `ulmndwlralgjbwlebxmo` (teste; aplicar direto). Deploy pelo MCP `deploy_edge_function` incluindo os arquivos de `_shared/` usados; `whatsapp-webhook` e `run-followups` com `verify_jwt: false`, as demais `true`.
- `organization_id` nunca vem do cliente como credencial: é derivado do registro (instância, conversa) ou conferido com `my_permissions`.
- Com `service_role`, tabela de organização só é acessada via `forOrg(admin, orgId)` ou por `id` de registro cuja organização já foi conferida. Revisão final: `grep -n "\.from(" supabase/functions` fora de `_shared/tenant.ts` justificado linha a linha.
- Nenhum segredo em log, resposta HTTP ou `audit_log`. Comparação de segredo em tempo constante.
- Número que já funciona hoje não pode parar: a busca legada continua até o número ganhar segredo de webhook (botão "Configurar webhook" gera e grava).
- Commits em português com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Branch `feat/multi-tenant-funcoes` (já contém `main` e a 1B).

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/20260926000100_instance_secrets.sql` | `whatsapp_instances.token_hash` + backfill; `set_instance_secret` passa a gravar o hash; RPCs só-`service_role`: `service_put_secret`, `service_has_secret`; segredo `platform:cron_secret` gerado; cron do follow-up passa a enviar `x-cron-secret` lido do Vault |
| `supabase/functions/_shared/auth.ts` | `requireUser(req)`, `resolveOrg(ctx, bodyOrgId?)`, `requirePermission(ctx, orgId, perm)`, `HttpError` |
| `supabase/functions/_shared/tenant.ts` | `forOrg(admin, orgId)` com `select/insert/update/delete` que injetam `organization_id` |
| `supabase/functions/_shared/secrets.ts` | `getSecret`, `putSecret`, `hasSecret` (cache 60 s), `withInstanceToken(admin, inst)`, `sha256Hex`, `safeEqual` |
| `supabase/functions/_shared/get-ai-config.ts` | `getAgentConfig(orgId)` por organização, chave do Vault |
| `supabase/functions/_shared/followups.ts` | agenda por organização |
| `supabase/functions/whatsapp-webhook/index.ts` | autenticação de origem, resolução da instância, escopo por organização, org suspensa ignorada, `dry_run` removido |
| `supabase/functions/manage-instance/index.ts` | exige usuário + permissão; ações por `instance_id`; `set_webhook` gera segredo e monta a URL com `?i=&k=` |
| `supabase/functions/test-ai-connection/index.ts`, `test-uazapi/index.ts` | exige usuário + `org.settings`; chaves do Vault |
| `supabase/functions/run-followups/index.ts` | exige `x-cron-secret`; tudo por organização; token do Vault |
| `src/components/ConfigDrawer.tsx`, `src/pages/Conversas.tsx` | enviam `instance_id`; gravam segredos por `set_instance_secret`/`set_org_secret`; nunca leem token |
| `supabase/migrations/20260926000200_null_plaintext_secrets.sql` | anula `instance_token` e `groq_api_key` depois da troca verificada |

---

### Task 1: Migration de apoio

- [ ] `token_hash text` em `whatsapp_instances` (índice), backfill `encode(digest(instance_token,'sha256'),'hex')` onde houver token.
- [ ] `set_instance_secret` também grava `token_hash`.
- [ ] `public.service_put_secret(name text, value text)` e `public.service_has_secret(name text) RETURNS boolean` — `EXECUTE` só `service_role`; `put` aceita só nomes `instance:<uuid>:(token|webhook|app_secret)` e `org:<uuid>:<chave permitida>`.
- [ ] `platform:cron_secret` criado com `encode(gen_random_bytes(32),'hex')` se não existir.
- [ ] Reagendar o job do cron dos follow-ups (`cron.alter_job` ou `unschedule`+`schedule` com o mesmo nome) para mandar o cabeçalho `x-cron-secret` com `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='platform:cron_secret')`. Atualizar `supabase/setup/cron.sql` igual.
- [ ] Teste (rollback): `service_put_secret` como `authenticated` → erro; `set_instance_secret` como owner → `token_hash` = sha256 do valor.

### Task 2: Módulos compartilhados

- [ ] `auth.ts`: `requireUser` usa `SUPABASE_ANON_KEY` + cabeçalho `Authorization` para um client do usuário e `auth.getUser()`; sem usuário → `HttpError(401)`. `resolveOrg`: se `bodyOrgId`, confere `my_permissions(bodyOrgId)` não vazio; senão usa a única organização ativa do usuário (`organization_members` via client do usuário); 0 ou 2+ → `HttpError(400, 'informe organization_id')`. `requirePermission` → `HttpError(403)`.
- [ ] `tenant.ts`: `forOrg(admin, orgId)` → `{ select(table, cols), insert(table, row|rows), update(table, patch), delete(table) }`, todos com `organization_id = orgId` (insert sobrescreve o campo).
- [ ] `secrets.ts`: `getSecret(admin, name)` via RPC `service_get_secret` com cache de 60 s; `putSecret` via `service_put_secret` (limpa o cache); `withInstanceToken(admin, inst)` devolve cópia da linha com `instance_token` vindo de `instance:<id>:token` (se a linha ainda tiver token em texto, usa-o só como reserva enquanto a Task 7 não roda); `sha256Hex`, `safeEqual` (tempo constante, `crypto.subtle` + comparação byte a byte).
- [ ] `get-ai-config.ts`: `getAgentConfig(orgId)` lê `agent_configs` por `organization_id`; chave = `getSecret('org:<org>:groq_api_key')` (reserva: coluna até a Task 7; depois só Vault) → sem chave = `null`.
- [ ] `followups.ts`: `scheduleInactivityFollowup({ admin, orgId, conversationId, currentAutoCount })` lê `agent_configs` por organização.

### Task 3: Webhook

- [ ] Ler o corpo como texto uma vez (`req.text()`), depois `JSON.parse`.
- [ ] **Cloud:** resolver a instância pelo `phone_number_id`; segredo = `instance:<id>:app_secret` ou `platform:meta_app_secret`; se houver segredo, validar `X-Hub-Signature-256` (HMAC-SHA256 do corpo bruto) → inválida/ausente = **401** sem gravar nada; se não houver segredo configurado, `console.error` alto e seguir (transição, registrado nas notas).
- [ ] **Uazapi:** com `?i=&k=` → instância por id; `k` confere com `instance:<id>:webhook` por `safeEqual` → senão **401**. Sem `?i=` → cascata legada (token por `token_hash`, nome, telefone) **somente** se a instância encontrada **não** tiver segredo de webhook (`service_has_secret`); se tiver → **401**.
- [ ] Com a instância: `orgId = inst.organization_id`; organização `suspended` → `ok()` sem processar. Todas as leituras/escritas por `forOrg(admin, orgId)` (conversa por `instance_id + contact_phone`, etapa inicial por organização, mensagens, follow-ups). Remover a criação de etapas padrão (a organização já nasce com funil pelo modelo).
- [ ] `getAgentConfig(orgId)`; envio com `withInstanceToken`.
- [ ] `handleConnection`: mesma autenticação/resolução; atualiza status por `id`.
- [ ] Remover `dry_run` do webhook (expunha diagnóstico sem autenticação).
- [ ] Deploy e testes com `curl`: Cloud com assinatura errada → 401 (após o usuário configurar o App Secret); Uazapi com `?i=<id>&k=errado` → 401; ping legado sem token → 200 sem efeito; mensagem real de outro celular → IA responde (teste do usuário).

### Task 4: manage-instance

- [ ] `requireUser`; corpo traz `instance_id` (exceto `create`); carrega a instância com `admin` por `id`, `orgId` = da instância; `send_text` exige `conversations.attend`, demais ações `org.settings`. `create` exige `org.settings` na organização de `resolveOrg`.
- [ ] Token sempre de `withInstanceToken`; nunca aceito do corpo nem devolvido na resposta (`status` deixa de devolver `raw_response`).
- [ ] `set_webhook`: gera `k` aleatório (32 bytes hex), grava `instance:<id>:webhook` por `putSecret`, monta `.../whatsapp-webhook?i=<id>&k=<k>` e configura na Uazapi. A URL com `k` não volta para o navegador.
- [ ] Resposta de erro sem `details` crus da Uazapi (podem ecoar token).

### Task 5: test-ai-connection, test-uazapi, run-followups

- [ ] `test-ai-connection`: `requireUser` + `resolveOrg` + `org.settings`; chave do corpo ou do Vault; config por organização.
- [ ] `test-uazapi`: `requireUser` + operador da plataforma (`platform_operators`) — é a config global.
- [ ] `run-followups`: exige `x-cron-secret` = `platform:cron_secret` (`safeEqual`) → senão 401. Instância por `id` + `withInstanceToken`; `getAgentConfig(conv.organization_id)`; próximo follow-up por organização.

### Task 6: Frontend mínimo

- [ ] `Conversas.tsx` `send`: `manage-instance` com `{ action: 'send_text', instance_id: active.instance_id, number, text }` (corrige também o envio pelo número errado quando há mais de um).
- [ ] `ConfigDrawer.tsx`: não selecionar `instance_token`; token digitado → salvar a linha e chamar `rpc('set_instance_secret', { instance, secret_value })`; `status`/`set_webhook`/`connect` com `instance_id`; chave da Groq por `rpc('set_org_secret', { org, secret_key: 'groq_api_key', secret_value })` (org = `agent_configs.organization_id` carregado) em vez de gravar a coluna; campo mostra "configurada ✓".
- [ ] `npm run build` e `npm run lint` sem erros novos.

### Task 7: Anular segredos em texto

- [ ] Migration `20260926000200_null_plaintext_secrets.sql`: confere que todo `instance_token`/`groq_api_key` não nulo existe no Vault com o mesmo valor (senão `RAISE`); então anula as colunas. Remover das funções a reserva por coluna.
- [ ] Deploy final de todas as funções; `npm run check`; `isolation.sql` verde; `get_advisors` sem alerta novo.

### Task 8: Revisão e PR

- [ ] Agente `revisor-seguranca-qualidade` no diff `feat/multi-tenant-banco...HEAD`; corrigir achados procedentes.
- [ ] Push; link do PR para o usuário.

## Passos do usuário (fora do código, sem colar segredos no chat)

1. **App Secret da Meta** (developers.facebook.com → app ClubeCRM → Configurações do app → Básico → Chave secreta do app): no Supabase → SQL Editor, rodar `select private.put_secret('platform:meta_app_secret', 'COLE_AQUI');`.
2. Depois do deploy: no CRM, Configurações → número Uazapi → **Configurar webhook** (gera o segredo novo).
3. Mandar "oi" de outro celular para cada número e confirmar a resposta.

## Fica para 1C-2

`inbound_events` (gravar → 200 → processar em `waitUntil`), `process-inbound` com reprocessamento, limite de IA por organização, retenção de 30 dias, `manage-members` (convites), `platform-orgs` (criar/suspender organização, acesso de suporte auditado).
