# 1C-2 — Fila de mensagens, limite por organização, convites e plataforma — Implementation Plan

> Executar **inline** (superpowers:executing-plans). Plano enxuto; revisão única no fim com `revisor-seguranca-qualidade`.

**Goal:** Nenhuma mensagem recebida se perde (fila `inbound_events` com reprocessamento), um cliente com pico não atrasa os outros (limite de IA por organização), e as funções de convite de membros e de gestão da plataforma existem no servidor para a 1D.

**Architecture:** O webhook autentica, grava o evento (deduplicado por `provider_message_id`), responde 200 na hora e processa em `EdgeRuntime.waitUntil`. O processamento sai para `_shared/inbound.ts` e anda por estágios (`received` → `stored` → `done`), então reprocessar nunca duplica mensagem. `process-inbound` (cron, `x-cron-secret`) reivindica eventos pendentes/falhos com `FOR UPDATE SKIP LOCKED`. `manage-members` e `platform-orgs` seguem o padrão da 1C (`requireUser` + permissão + `forOrg`).

**Spec:** `docs/superpowers/specs/2026-09-24-multi-tenant-equipes-design.md` §8.2, §8.3, §11.2.

## Global Constraints
- Mesmas da 1C (organização derivada do banco, `forOrg`, segredos só no Vault, nada de segredo em log/resposta).
- Payload bruto em `inbound_events` tem dado pessoal: retenção de 30 dias para `processed`/`skipped` (job SQL diário).
- Limite de IA: `organizations.settings.ai_rate_limit_per_minute`, padrão 30 respostas/minuto por organização.
- Convites: 20 por hora por organização; admin não convida nem promove a owner; só owner mexe em owner (o trigger `guard_owner` já garante).

## Tasks
1. **Migration `20260927000100_inbound_queue_invites.sql`:** `inbound_events` + `stage` (`received|stored|done`) e `claimed_at`; status aceita `processing`; RPC `claim_inbound_events(max_rows)` só `service_role` (pendentes/falhos com `attempts < 5` e mais de 30 s, ou `processing` preso há mais de 5 min); RPC `accept_invitation(org)` para o próprio usuário (`invited` → `active`, auditado); job `pg_cron` diário de retenção. Teste em rollback.
2. **`_shared/inbound.ts`:** `parseEvent(provider, body)` (parsers movidos do webhook, sem mudança de comportamento) e `processMessage(admin, inst, ev, eventId)` por estágios, com limite por organização antes da IA (excedeu → evento volta a `pending`).
3. **Webhook:** autentica → grava evento (`status=processing`, conflito = duplicado → 200 sem processar) → 200 → `waitUntil(processMessage)`; eventos de conexão seguem inline.
4. **`process-inbound`:** `x-cron-secret`; reivindica até 20 eventos; processa cada um; marca `processed|skipped|pending|failed` com `error` curto. Cron agendado via `supabase/setup/cron.sql` (placeholder) e aplicado no projeto por SQL.
5. **`manage-members`:** ações `invite` (e-mail, papel, departamentos; conta nova → `auth.admin.inviteUserByEmail` com redirect para `/convite`), `change_role`, `disable`, `enable`, `resend`; exige `members.manage`; limite de 20 convites/hora (via `audit_log`); tudo auditado.
6. **`platform-orgs`:** só operador; ações `list` (organizações com contagem de membros/números/conversas), `create` (nome, modelo, e-mail do owner → cria org, aplica modelo, convida owner), `suspend`, `reactivate`, `open_support` (motivo obrigatório, até 120 min); tudo auditado.
7. **Deploy + testes:** CLI; curl negativos (401/403); mensagem real respondida; evento duplicado gravado uma vez; `isolation.sql` verde; revisão; PR.

## Fora deste plano
Telas (convite, equipe, plataforma, MFA) — 1D.
