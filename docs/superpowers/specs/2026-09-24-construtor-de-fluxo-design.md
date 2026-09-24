# Construtor de fluxo (chatbot visual)

Data: 2026-09-24
Status: aprovado para implementação
Subprojeto: 3 de 4
Depende de: `2026-09-24-multi-tenant-equipes-design.md` e
`2026-09-24-atendimento-humano-design.md` (atendimentos, departamentos,
contatos, etiquetas, envio único via `_shared/send.ts`, Vault)

## 1. Problema

Todo atendimento novo vai hoje direto para a IA (se ligada) com um único prompt
por organização. Não há menu, horário de atendimento, triagem por departamento,
coleta de dados, pesquisa de satisfação, nem controle do que a IA pode fazer.

## 2. Objetivo

Um **editor visual** (canvas) em que cada organização desenha o que acontece
quando um atendimento chega, por número de WhatsApp, com:

- blocos de mensagem, menu, pergunta, condição, horário, IA, transferir,
  finalizar, etiquetar, pesquisa de satisfação, aguardar/follow-up, mover no
  funil/notificar e integração HTTP;
- **IA com permissões explícitas** (transferir, finalizar, enviar arquivo da
  biblioteca, coletar dados, mover no funil) e travas aplicadas pelo motor;
- rascunho/publicação com versões, validação, simulador e estatísticas.

## 3. Não faz parte deste escopo

- Gatilhos que não sejam "atendimento abriu" / "atendimento finalizou" (ex.:
  campanha disparada, palavra-chave no meio de um atendimento humano).
- Disparo em massa.
- Blocos de pagamento, agenda externa (Google Agenda) e CRM externo nativos —
  cobertos, por enquanto, pelo bloco HTTP.
- Edição colaborativa simultânea do mesmo fluxo (último salvamento vence, com
  aviso se outra pessoa salvou depois que você abriu).

## 4. Modelo de dados

```
flows            id, organization_id, name, description, is_post_close bool,
                 timestamps
flow_versions    id, organization_id, flow_id, version int, status
                 ('draft'|'published'|'archived'), graph jsonb, published_at,
                 published_by, timestamps
                 único parcial: um 'draft' e um 'published' por flow
flow_runs        id, organization_id, ticket_id, conversation_id,
                 flow_version_id, current_node_id, state ('running'|
                 'waiting_input'|'waiting_timer'|'ai'|'done'|'cancelled'|
                 'error'), vars jsonb, wait_until, ai_turns int, error,
                 started_at, updated_at, finished_at
                 único parcial: um run ativo por ticket
flow_run_steps   id bigint, organization_id, run_id, flow_version_id, node_id,
                 outcome text, created_at        (retenção 30 dias)
org_holidays     id, organization_id, date, name
ai_library       id, organization_id, name, description, media_path,
                 timestamps
http_secrets     organization_id, name, secret_id (vault), updated_by,
                 updated_at     pk (organization_id, name)
```

Alterações:
- `whatsapp_instances.flow_id` (nulo = fluxo padrão da organização).
- `organizations.settings`: `default_flow_id`, `post_close_flow_id`,
  `timezone` (padrão `America/Sao_Paulo`), `business_hours`.
- `contact_fields`: `ai_readable bool` (padrão falso), `sensitive bool`.
- `contacts.opted_out_at` (ver §9).
- `tickets.rating`, `tickets.rating_comment`.

Todas com `organization_id NOT NULL`, RLS por organização; `flow_*` e
`ai_library` legíveis por membros com `reports.view` ou `org.settings`,
graváveis só com `org.settings`. `http_secrets` sem policy (só backend).
Arquivos da biblioteca em `media/{org}/library/…`.

## 5. Grafo e blocos

`graph = { nodes: [{ id, type, data, position }], edges: [{ source,
sourceHandle, target }] }` — formato nativo do React Flow; `data` validado por
um schema **Zod por tipo de bloco**, compartilhado entre editor e motor.

| Tipo | Saídas | Espera? |
|---|---|---|
| `start` | `first_contact`, `returning` | não |
| `message` (texto/mídia, variáveis) | `next` | não |
| `menu` (opções; botões/lista na Cloud API, numerado na Uazapi) | uma por opção, `invalid`, `timeout` | sim |
| `question` (valida: texto, número, e-mail, CPF/CNPJ, data; grava em campo) | `ok`, `invalid` (após N tentativas), `timeout` | sim |
| `condition` (campo, etiqueta, 1º contato, número de entrada, dia da semana) | `true`, `false` | não |
| `business_hours` (org ou departamento, com feriados e fuso) | `open`, `closed` | não |
| `ai_agent` | `transferred`, `resolved`, `fallback` | sim |
| `transfer` (departamento ou pessoa, mensagem opcional) | — (fim) | — |
| `close` (motivo, mensagem opcional) | — (fim) | — |
| `tag` (adicionar/remover) | `next` | não |
| `survey` (1–5 ou NPS 0–10, comentário opcional) | `answered`, `timeout` | sim |
| `wait` (X min/h; ou "se o cliente não responder em X, então…") | `elapsed`, `replied` | sim |
| `pipeline` (mover etapa) e/ou `notify` (sino para depto/pessoa) | `next` | não |
| `http` | `success`, `error` | não |

Saída desconectada que não é obrigatória = fim do fluxo → atendimento vai para
a **fila geral** (nunca fica "preso" em `bot` sem ninguém).

## 6. Motor

### 6.1 Separação

- `supabase/functions/_shared/flow/engine.ts`: **função pura**
  `step(graph, nodeId, input, ctx) → { actions[], next, wait? }`. Não acessa
  banco, rede nem relógio (hora vem em `ctx`).
- `supabase/functions/_shared/flow/executor.ts`: aplica `actions` (enviar via
  `_shared/send.ts`, gravar campo, etiquetar, transferir/finalizar via RPCs do
  subprojeto 2, chamar HTTP, chamar IA), persiste `flow_runs` e
  `flow_run_steps`, tudo por `forOrg(orgId)`.

### 6.2 Ciclo

1. Atendimento abre em `bot` → escolhe fluxo (`instance.flow_id` →
   `default_flow_id`) → versão **publicada** atual → cria `flow_run`.
   Sem fluxo publicado → comportamento do subprojeto 2 (IA da organização, ou
   fila geral).
2. Executa blocos até um que espera ou um final. **Máximo de 50 blocos por
   estímulo**; excedeu → `error`, atendimento para a fila geral, erro no log.
3. Mensagem do cliente com run em `waiting_input`/`ai` → retoma com a entrada.
4. `wait_until` vencido → `run-flows` (cron a cada minuto, `x-cron-secret`)
   retoma. Processa em lotes, por organização, com o limite de taxa do
   subprojeto 1.
5. Humano assume ou envia mensagem → run `cancelled`.
6. Run fica preso à `flow_version_id` com que começou.
7. Erros de execução (bloco inválido, HTTP que lança exceção, IA indisponível)
   seguem a saída de erro do bloco quando existe; senão → fila geral.

### 6.3 Pós-finalização (pesquisa)

Se `post_close_flow_id` existe, ao finalizar um atendimento humano cria-se um
run desse fluxo ligado ao atendimento **finalizado**. Enquanto ele estiver em
`waiting_input` (até 24 h), a próxima mensagem do cliente vai para ele. Resposta
inválida no `survey` ou tempo esgotado → run encerra e a mensagem (se houver)
abre um atendimento novo normalmente.

## 7. Bloco `ai_agent`

### 7.1 Configuração

Prompt do bloco; modelo; permissões com listas fechadas:
`transfer: department_ids[]`, `close: close_reason_ids[]`,
`send_file: ai_library_ids[]`, `set_field: contact_field_ids[]`,
`move_stage: stage_ids[]`; `max_turns` (padrão 10); palavras de transbordo
(padrão "atendente", "humano", "pessoa").

### 7.2 Execução

- Ferramentas (function calling da Groq) geradas a partir das permissões, com
  parâmetros **enum** restritos às listas. O executor **revalida** cada chamada
  contra a configuração do bloco e contra o banco (existe, é da org, está ativo);
  chamada inválida é descartada e registrada.
- Contexto enviado à IA: mensagens **do atendimento atual** (máx. 30),
  nome do contato, e somente campos com `ai_readable = true`. Campos
  `sensitive` nunca vão, mesmo se marcados legíveis.
- Travas **no motor**, antes de chamar o modelo: palavra de transbordo →
  `transferred` (departamento padrão do bloco); `ai_turns >= max_turns` →
  `fallback`; erro/timeout/chave inválida da Groq (após a cadeia de modelos de
  `get-ai-config`) → `fallback`.
- A primeira mensagem de um bloco de IA num atendimento usa a frase de
  apresentação configurada, que por padrão identifica o atendente como
  **assistente virtual** (transparência; ver §9).

## 8. Bloco `http`

- Configuração: método (GET/POST/PUT/PATCH), URL, cabeçalhos, corpo JSON com
  variáveis, mapeamento de campos da resposta para variáveis
  (caminho simples `a.b[0].c`), **resposta de exemplo** para o simulador.
- Proteções:
  - só `https`; porta 443;
  - resolve DNS e recusa se **qualquer** IP resolvido for privado, loopback,
    link-local (`169.254.0.0/16`), CGNAT (`100.64.0.0/10`), multicast,
    reservado, `0.0.0.0/8`, ou IPv6 equivalente (`::1`, `fc00::/7`,
    `fe80::/10`, IPv4 mapeado);
  - `redirect: "manual"` — 3xx é tratado como `error`;
  - timeout 10 s; corpo de resposta lido até 256 KB (excedeu → `error`);
    só `application/json`;
  - 60 chamadas/min por organização;
  - variáveis inseridas no corpo **como valores JSON** (serialização, nunca
    concatenação de texto); na URL, com `encodeURIComponent`;
  - `{{segredo.nome}}` resolve **somente** de `http_secrets` e **somente** em
    URL, cabeçalhos e corpo do bloco `http`. Não resolve em blocos de
    mensagem, nem dá acesso a chaves da Groq/Meta/Uazapi.
  - log: status e duração; corpo só em "modo depuração" (liga por 1 h,
    desliga sozinho, corpo cortado em 2 KB, retenção 7 dias).
- Risco residual documentado: DNS rebinding entre checagem e conexão.
  Mitigação: edição só por `org.settings`, isolamento de rede das Edge
  Functions, auditoria da criação/alteração de blocos `http` (`audit_log`
  registra URL de destino ao publicar).
- Orientação na tela do bloco: consultar sistemas pelo **telefone do contato**
  (verificado pelo WhatsApp), não por um documento digitado pelo cliente —
  evita que alguém consulte o pedido de outra pessoa digitando o CPF dela.

## 9. LGPD e mensagens automáticas

- **Opt-out:** mensagem do cliente igual a "SAIR", "PARAR" ou "CANCELAR"
  (lista configurável) grava `contacts.opted_out_at` e responde uma
  confirmação. Contato com opt-out não recebe **mensagens proativas**: follow-ups
  automáticos, blocos `wait` que disparam mensagem sem o cliente ter escrito, e
  pesquisa pós-finalização. Respostas a mensagens que o próprio cliente enviar
  continuam normais. O agente vê o selo "não quer receber mensagens
  automáticas" e pode desfazer a pedido do cliente (registrado no `audit_log`).
- **Transparência da IA:** frase de apresentação padrão identifica a IA;
  a palavra de transbordo garante o direito de falar com um humano (revisão de
  decisão automatizada).
- **Minimização:** `flow_runs.vars` é limpo ao final do run (dados que
  interessam já estão nos campos do contato); `flow_run_steps` guarda só ids de
  bloco e resultado, sem conteúdo; retenção de 30 dias.
- **Anonimização do contato** (subprojeto 2) passa a limpar também
  `flow_runs.vars` e `tickets.rating_comment` desse contato.

## 10. Editor (frontend)

- Rota `/fluxos` (lista) e `/fluxos/:id` (canvas). `@xyflow/react`.
- Paleta de blocos, painel de propriedades por tipo (formulários com Zod),
  minimapa, zoom, desfazer/refazer, salvamento automático do rascunho
  (debounce), aviso se o rascunho foi salvo por outra pessoa depois de aberto.
- **Publicar**: roda a validação; mostra diff (blocos adicionados, removidos,
  alterados); grava versão `published` e arquiva a anterior.
- **Validação** (mesma função no editor e na RPC de publicação):
  schema de cada bloco; um único `start`; todo bloco alcançável; saídas
  obrigatórias conectadas; referências existentes e ativas (departamento,
  etiqueta, campo, etapa, arquivo, motivo, segredo); opções de menu únicas;
  todo ciclo contém um bloco que espera.
- **Simulador**: painel de chat → Edge Function `flow-simulate` (JWT,
  `org.settings`) executa o **mesmo motor** com um executor de simulação: não
  envia ao WhatsApp, não grava nada, IA real (conta no limite de taxa),
  ações da IA mostradas como texto, bloco `http` usa a **resposta de exemplo**
  (chamada real só com o botão "chamar de verdade", que avisa sobre efeitos
  colaterais no sistema externo). Bloco atual destacado no canvas.
- **Estatísticas**: contagem por bloco e por saída (7/30 dias) a partir de
  `flow_run_steps`, sobreposta no canvas.
- **Versões**: lista, visualização somente leitura, "restaurar como rascunho".
- Números: na tela do fluxo, escolher quais números usam este fluxo.

## 11. Modelos

- Cada modelo de organização ganha a chave `flow` (grafo inicial) e,
  opcionalmente, `post_close_flow`.
- Galeria de pontos de partida: "Boas-vindas + menu + IA", "Fora do horário",
  "Qualificação de lead", "Pesquisa de satisfação".
- Referências no grafo do modelo usam **nomes** (departamento "Suporte") e são
  resolvidas para ids ao aplicar o modelo na organização.

## 12. Testes

- **Motor** (Deno test / Vitest sobre `engine.ts`, sem banco): cada tipo de
  bloco e cada saída; limite de 50 blocos; pós-finalização; cancelamento;
  retomada por timer; versão presa.
- **Validação**: um caso por regra do §10.
- **IA**: ferramentas geradas só com as permissões marcadas; chamada fora do
  enum descartada; palavra de transbordo não chama o modelo; `max_turns`;
  falha da Groq → `fallback`; campos `sensitive`/não legíveis ausentes do
  contexto.
- **HTTP** (testes da função de guarda): recusa `http://`, IPs privados/
  loopback/link-local/IPv6 locais, hostname que resolve para IP privado,
  redirect, resposta > 256 KB, não-JSON, timeout; `{{segredo}}` não resolve em
  bloco de mensagem; variável maliciosa não quebra o JSON.
- **Opt-out**: follow-up e `wait` proativo não enviam para contato com
  opt-out; resposta a mensagem do cliente envia.
- **Isolamento**: tabelas novas entram no laço de `isolation.sql`; `flow-simulate`
  e publicação recusam fluxo de outra organização.
- **E2E** (novas Waves no `TESTING.md`): menu → departamento; fora do horário;
  IA transfere; IA envia arquivo da biblioteca; pesquisa após finalizar; HTTP
  com sucesso e erro; publicação com atendimento em andamento.

## 13. Riscos

| Risco | Mitigação |
|---|---|
| Fluxo mal desenhado prende o cliente | saída solta → fila geral; limite de blocos; validação |
| IA manipulada pelo cliente (prompt injection) | ferramentas com enum + revalidação no servidor + travas no motor |
| SSRF pelo bloco HTTP | guarda de IP/esquema/redirect/limites; residual documentado |
| Vazamento de segredo por fluxo | `{{segredo}}` só em `http` e só de `http_secrets` |
| Custo de IA no simulador | conta no limite de taxa da organização |
| Botões/listas só na Cloud API | Uazapi recebe o menu numerado automaticamente |
