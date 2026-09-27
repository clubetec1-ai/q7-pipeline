# 3A — Motor de fluxo e editor visual — Plano enxuto

Spec: `docs/superpowers/specs/2026-09-24-construtor-de-fluxo-design.md` (§4, §5, §6, §10). Execução inline.

## Escopo
Blocos: `start`, `message`, `menu` (numerado), `question` (text/number/email/cpf_cnpj/date → campo do contato ou variável), `condition` (first_contact, tag, contact_group, weekday), `business_hours` (organização), `ai_agent` (prompt, transbordo por palavra, `max_turns`, fallback), `tag`, `transfer`, `close`.
Fora (3B): `wait`, `survey`/pós-finalização, opt-out, `http`, simulador, estatísticas, ferramentas da IA, provedores de IA.

## Tarefas
1. Migration `20260927000900_flows.sql`: `flows`, `flow_versions` (um draft e um published por fluxo), `flow_runs` (um ativo por atendimento), `flow_run_steps` (só id do bloco e resultado; retenção 30 d por cron); `whatsapp_instances.flow_id`; `settings.default_flow_id`/`timezone`/`business_hours`; RPC `publish_flow` (org.settings, valida grafo mínimo, audita); `service_ticket_route` (fila/transferir/finalizar pelo motor, com evento e espelho); gatilho que cancela o run quando o atendimento sai de `bot`. RLS: leitura `org.settings` ou `reports.view`, escrita `org.settings`; runs/steps só backend.
2. `_shared/flow/engine.ts` (puro: sem banco, rede, relógio) e `_shared/flow/executor.ts` (aplica ações por `forOrg`, envia pelo provedor, IA pela cadeia da Groq). Máx. 50 blocos por estímulo; saída sem ligação = fila geral.
3. Webhook: atendimento em `bot` com fluxo publicado → executor; sem fluxo → IA da organização como hoje.
4. Frontend: `/fluxos` (lista, criar, fluxo padrão, números) e `/fluxos/:id` (canvas `@xyflow/react`, paleta, painel de propriedades, salvar rascunho, publicar com validação).
5. Testes: engine por SQL/curl não se aplica → testes Deno do engine (`engine_test.ts`); SQL em rollback para RPCs e RLS; build/lint; teste real com o usuário.
