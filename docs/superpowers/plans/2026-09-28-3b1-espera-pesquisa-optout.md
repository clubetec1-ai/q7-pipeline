# 3B-1 — Espera, pesquisa pós-atendimento, opt-out, estatísticas e simulador

Spec: `docs/superpowers/specs/2026-09-24-construtor-de-fluxo-design.md` §5, §6.2–6.3, §9, §10.
Fica para 3B-2: bloco `http` (+ `http_secrets`, guarda SSRF), ferramentas/permissões da IA, provedor por agente.

## Tarefas

1. **Motor** (`_shared/flow/engine.ts`, puro)
   - `wait` (minutos, máx. 1380 = dentro da janela de 24 h): saídas `elapsed`, `replied`.
   - `menu`/`question`: `timeout_minutes` opcional → saída `timeout`.
   - `survey` (1–5 ou 0–10, comentário opcional): saídas `answered`, `timeout`;
     resposta inválida encerra com `passthrough` (a mensagem segue o caminho normal).
   - `ctx.timerFired`, `result.waitMinutes`, ações `rating`/`rating_comment`.
   - Testes em `engine_test.ts`.
2. **Executor**: `wait_until`, modo timer, envio proativo bloqueado por opt-out,
   rotas ignoradas em atendimento finalizado, `runPostClose`, `handleOptOut`, `instForSend`.
3. **Migration** `20260928000200_flow_timers_survey_optout.sql`
   - `contacts.opted_out_at`, `tickets.rating`/`rating_comment`;
   - cron `run-flows` (só chama a função se houver run vencido);
   - gatilho pós-finalização (humano finalizou → run do `post_close_flow_id`, mesma org, sem opt-out; nunca bloqueia o fechamento);
   - atendimento novo cancela run pós-finalização da conversa;
   - `clear_opt_out(contact)` (conversations.attend + audit_log), `flow_stats(flow, period)` (org.settings/reports.view).
4. **Edge Function** `run-flows` (x-cron-secret, lote, claim atômico de `wait_until`).
5. **Webhook**: opt-out; pós-finalização antes de abrir atendimento novo. **run-followups**: pula opt-out.
6. **Frontend**: blocos `wait`/`survey`, timeout em menu/pergunta, estatísticas e simulador
   (motor importado no navegador; IA simulada) no editor; em Fluxos, fluxo pós-atendimento e
   palavras/resposta de opt-out; selo + desfazer na ficha do contato.
7. **Testes**: `isolation.sql` caso 27; deno test; tsc/lint/build.

## Aceite
- Isolamento: outra org não lê estatísticas nem desfaz opt-out; fluxo de outra org nunca roda no pós-atendimento.
- Contato com opt-out não recebe espera proativa, pesquisa nem follow-up automático.
