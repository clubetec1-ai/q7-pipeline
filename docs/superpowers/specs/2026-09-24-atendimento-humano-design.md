# Atendimento humano: atendimentos, fila, distribuição e mídia

Data: 2026-09-24
Status: aprovado para implementação
Subprojeto: 2 de 4
Depende de: `2026-09-24-multi-tenant-equipes-design.md` (organizações,
departamentos, papéis, `can_see_conversation`, `forOrg`, Vault, testes de
isolamento)

## 1. Problema

Hoje a conversa só tem um interruptor (`ai_enabled`). Não existe fila,
responsável, transferência, finalização, histórico de quem atendeu, envio de
arquivos, nem visão de supervisão. Mídia recebida aparece só como "[imagem]".

## 2. Objetivo

Um fluxo de atendimento de equipe completo, que sirva de clínica pequena a
central de atendimento:

- **atendimentos com protocolo** dentro da conversa, com ciclo de vida medido;
- fila por departamento com distribuição **manual ou automática** (por
  departamento), presença dos atendentes e limite de simultâneos;
- transferir, finalizar com motivo, devolver para a IA;
- receber e enviar **mídia** (inclusive áudio gravado no navegador) com status
  de entrega;
- respostas rápidas, notas internas com menção, etiquetas, ficha do contato com
  campos personalizados e LGPD, painel do supervisor ao vivo.

Segurança: toda tabela nova entra na RLS por organização e nos testes de
isolamento; arquivos em Storage privado com a mesma regra de visibilidade.

## 3. Não faz parte deste escopo

- Chatbot/menu, horário de atendimento aplicado, regras da IA para transferir,
  finalizar ou enviar arquivo, pesquisa de satisfação → subprojeto 3. Aqui só
  fica a coluna `rating` no atendimento.
- Relatórios históricos com filtros de período e exportação (o painel mostra
  "hoje"; relatórios completos ficam para depois).
- Notificação push fora do navegador / app mobile.
- Limite de armazenamento por plano (só medimos o uso).

## 4. Ciclo de vida do atendimento

### 4.1 Estados

`bot` → `queued` → `open` → `closed`, com transições:

| De | Para | Quando |
|---|---|---|
| — | `bot` | cliente escreve sem atendimento aberto e a IA da org está ligada |
| — | `queued` | idem, IA desligada (fila geral, sem departamento) |
| `bot` | `queued` | IA transfere (subprojeto 3) ou humano manda para a fila |
| `bot` | `open` | humano responde pela interface (assume) ou responde pelo celular |
| `queued` | `open` | atendente assume (manual) ou distribuição atribui (automático) |
| `open` | `queued` | transferência para departamento |
| `open` | `open` | transferência para pessoa (troca `assigned_to`) |
| `open`/`queued` | `bot` | "devolver para a IA" (responsável, supervisor ou acima) |
| qualquer aberto | `closed` | finalizar (humano; IA no subprojeto 3) |

- A IA responde **somente** quando o atendimento aberto está em `bot`. Isso
  substitui `conversations.ai_enabled` como fonte de verdade (a coluna fica,
  espelhada, até ser removida numa migration futura).
- Resposta pelo celular (`fromMe` / eco da Cloud API): `open`, sem
  `assigned_to`, evento `external_reply`. A distribuição automática **não** age
  sobre ele (só age em `queued`), porque alguém já está respondendo pelo
  celular. Aparece na aba **Fila** com o selo "respondido pelo celular" para
  alguém assumir no sistema.
- **Aba Fila** = atendimentos não finalizados, fora de `bot`, com
  `assigned_to` nulo (ou seja, `queued`, e `open` sem responsável).
- Cliente escreve com o último atendimento `closed` → novo atendimento.

### 4.2 Protocolo

`AAAA-NNNNNN`, sequencial **por organização e por ano**, gerado atomicamente
(`organizations.ticket_seq` + ano corrente, atualizado com `UPDATE … RETURNING`).

### 4.3 Transferir

- Para **departamento**: `queued`, `assigned_to` nulo; distribuição age se o
  departamento for automático.
- Para **pessoa**: destino tem que ser membro ativo; o atendimento fica num
  departamento do qual o destino é membro — mantém o atual se o destino
  pertencer a ele, senão a interface exige escolher um dos departamentos do
  destino. A RPC valida.
- Nota interna opcional acompanha a transferência (vira `internal_notes` +
  evento).
- Quem pode: o responsável atual; supervisor ou acima (`conversations.reassign`)
  a qualquer momento.

### 4.4 Finalizar

- Motivo obrigatório (de `close_reasons`), observação opcional.
- Mensagem de encerramento opcional, texto configurável por organização com
  variáveis; a interface envia via `send-message` e **depois** finaliza.
- Finalizar zera o espelho na conversa (`assigned_to`, `department_id`).

### 4.5 Concorrência

`claim_ticket(ticket_id)`: `UPDATE tickets SET assigned_to = auth.uid(), status
= 'open' … WHERE id = $1 AND assigned_to IS NULL AND status IN ('queued',
'open') RETURNING …`. Zero linhas → erro "já assumido por <nome>". Também valida limite
de simultâneos e pertencimento ao departamento.

## 5. Distribuição e presença

### 5.1 Presença

`agent_presence (organization_id, user_id)`: `status` (`online`|`paused`|
`offline`), `pause_reason_id`, `status_since`, `last_seen_at`,
`last_assigned_at`, `max_concurrent` (nulo = padrão do departamento/org).

- RPC `heartbeat()` a cada 60 s enquanto a aba está aberta; `set_presence(status,
  reason)` no seletor do cabeçalho.
- **Disponível** = `status = 'online'` e `last_seen_at > now() - 3 min`.
- Ao sair (logout) → `offline`.

### 5.2 Configuração do departamento

Colunas novas em `departments`: `distribution_mode` (`manual`|`auto`),
`max_concurrent` (padrão 5), `queue_alert_minutes` (padrão 5),
`reply_alert_minutes` (padrão 10).

### 5.3 Algoritmo automático

`private.try_assign(ticket_id)` e `private.drain_department(department_id)`,
ambos sob `pg_advisory_xact_lock` por departamento:

1. candidatos: membros do departamento, disponíveis, com atendimentos `open`
   atribuídos < limite;
2. menor número de atendimentos abertos; empate → `last_assigned_at` mais
   antigo;
3. sem candidato → permanece `queued`.

Disparos:
- gatilho quando um atendimento entra em `queued` num departamento `auto`;
- `drain_department` quando um atendente fica disponível (presença → online),
  finaliza ou transfere um atendimento;
- `pg_cron` a cada minuto chama `private.drain_all()` (rede de segurança;
  SQL direto, sem HTTP).

Fila geral (sem departamento) é sempre manual.

### 5.4 Alertas

Calculados no frontend a partir de `queued_at`, `last_inbound_at` e da última
mensagem humana; cores amarelo (≥ limite) e vermelho (≥ 2× limite). Sem job.

## 6. Mensagens e mídia

### 6.1 `messages` — colunas novas

`ticket_id`, `type` (`text`|`image`|`audio`|`voice`|`video`|`document`|
`sticker`|`location`|`contact`|`template`), `media_path`, `media_mime`,
`media_size`, `media_name`, `sent_by` (uuid; nulo em `human` = pelo celular),
`status` (`pending`|`sent`|`delivered`|`read`|`failed`), `provider_message_id`,
`error`. Índice único `(organization_id, provider_message_id)` para casar
atualizações de status.

`content` continua sendo o texto ou a legenda; para áudio recebido, a
transcrição existente.

### 6.2 Receber

No processamento do `inbound_events`: identificar tipo → baixar a mídia
(Cloud: `GET /{media-id}` + download com o token da instância; Uazapi: endpoint
de download) → gravar em `media/{org}/{conversation}/{uuid}.{ext}` → mensagem
com `media_path`. Falha no download: mensagem gravada com `media_path` nulo e
evento marcado para nova tentativa só da mídia; a interface mostra "arquivo
indisponível".

### 6.3 Enviar — `send-message` (nova Edge Function, JWT)

Entrada: `conversation_id`, `type`, `text?`, `media_path?`, `template?`.

1. Confere pelo JWT: membro ativo, `can_see_conversation`, e atendimento aberto
   da conversa em que o usuário pode agir (responsável; ou `reassign`; ou
   atendimento em `bot`/`queued` → assume antes de enviar).
2. Mídia: confere que `media_path` começa com `{org}/{conversation}/`; baixa do
   Storage; **valida o tipo pelos bytes iniciais** contra a lista permitida;
   confere o limite do WhatsApp (imagem 5 MB, áudio/vídeo 16 MB, documento
   100 MB).
3. Janela de 24 h (Cloud API): fora dela, só `template`.
4. Envia pelo provedor da instância (`providers/*`), grava `messages` com
   `status = 'sent'` e `provider_message_id`; falha → `failed` + `error`.

A IA e os follow-ups passam a usar a mesma rotina interna de envio
(`_shared/send.ts`). **Um único caminho de saída** no sistema.
`manage-instance` perde a ação `send_text`.

### 6.4 Status de entrega

Webhooks de status (Cloud: `statuses[]`; Uazapi: eventos de atualização de
mensagem/ack) atualizam `messages.status` por `provider_message_id`, só para
frente (`sent` → `delivered` → `read`; `failed` a qualquer momento).

### 6.5 Áudio gravado no navegador

WhatsApp exige OGG/Opus para mensagem de voz; o Chrome grava WebM/Opus.
**Spike antes da implementação** para escolher entre (a) remux WebM→OGG no
navegador, (b) conversão na Edge Function, (c) enviar como `audio` (arquivo) em
formato aceito. Critério: reproduz como mensagem de voz no WhatsApp do celular
nos dois provedores. Resultado vira decisão registrada no plano.

### 6.6 Storage

- Bucket privado `media`.
- Policies de `storage.objects` (select/insert) chamam
  `private.can_access_media(name)`: extrai `{org}/{conversation}` do caminho
  (retorna falso em qualquer formato inválido, sem erro), exige membro ativo da
  org e `can_see_conversation`.
- Sem policy de update/delete para `authenticated`.
- O bucket é criado com `file_size_limit` (100 MB) e `allowed_mime_types`
  (lista fechada; **sem** `text/html`, `image/svg+xml`, JavaScript ou
  executáveis) — a checagem vale no upload direto do navegador, antes mesmo da
  `send-message`.
- **Arquivos recebidos perigosos** (extensões executáveis ou de script:
  `.exe`, `.bat`, `.cmd`, `.scr`, `.js`, `.vbs`, `.msi`, `.apk`, `.jar`, `.html`,
  `.svg`...): gravados com `application/octet-stream`, e baixar exige
  confirmar o aviso "este arquivo pode ser perigoso". Nunca são exibidos
  inline.
- Frontend usa URLs assinadas de 10 minutos.
- Uso por organização (soma de `media_size`) no painel da Plataforma.

## 7. Recursos extras

### 7.1 Contatos e ficha

```
contacts        id, organization_id, phone, name, email, document, notes,
                custom jsonb, anonymized_at, timestamps
                unique (organization_id, phone)
contact_fields  id, organization_id, key, label, type (text|number|date|select),
                options jsonb, position
```

- `conversations.contact_id` (backfill a partir de `contact_phone` /
  `contact_name`; depois `NOT NULL`). O mesmo telefone em dois números da
  empresa = um contato, duas conversas.
- Visibilidade: um contato é visível se o usuário vê ao menos uma conversa dele,
  ou tem `view_all`.
- **LGPD** (só `org.settings`): exportar dados do contato (JSON + mídia) e
  anonimizar. Ambos no `audit_log`; anonimizar pede confirmação digitando o
  telefone. A anonimização cobre **todos** os lugares onde o dado aparece:
  - `contacts` (nome, e-mail, documento, `custom`, notas; telefone substituído
    por um hash);
  - `messages.content` e mídia no Storage das conversas do contato;
  - `internal_notes` dessas conversas;
  - `inbound_events.payload` do telefone;
  - `ticket_events.meta`, `tickets.close_note`;
  - `conversations.contact_name` / `contact_phone`;
  - (subprojeto 3) `flow_runs.vars`, `tickets.rating_comment`.
  Mantém protocolos, horários e motivos (métricas). Backups expiram em até
  12 meses, conforme contrato.
- **Campos sensíveis**: `contact_fields.sensitive` (ex.: CPF, convênio) são
  mascarados na interface (`***.***.***-12`) até um clique em "mostrar".
- **Retenção configurável** por organização (`settings.retention_months`,
  padrão desligado): um job mensal anonimiza contatos sem atendimento há mais
  de N meses. Recomendado ligar; o cliente decide (é o controlador).

### 7.2 Etiquetas

`tags (id, organization_id, name, color, scope 'contact'|'ticket')`,
`contact_tags`, `ticket_tags` (ambas com `organization_id`). Criação:
`library.manage`. Aplicar/remover: quem pode atender a conversa. Filtros em
Conversas e Kanban.

### 7.3 Respostas rápidas

`quick_replies (id, organization_id, department_id null, shortcut, content,
media_path null, created_by)`; único `(organization_id, department_id,
shortcut)`. Variáveis `{nome}`, `{protocolo}`, `{atendente}`, `{empresa}`
substituídas no frontend antes de enviar. Anexo guardado em
`media/{org}/quick-replies/…` com policy própria (membros da org leem;
`library.manage` grava).

### 7.4 Notas internas e notificações

- `internal_notes (id, organization_id, conversation_id, ticket_id, author_id,
  content, mentions uuid[], created_at)` — **tabela separada de `messages` de
  propósito**: nada em `internal_notes` é lido pelo caminho de envio.
- Menção cria linha em `notifications (id, organization_id, user_id, kind,
  ref jsonb, read_at, created_at)`; também notifica: atendimento atribuído a
  você, transferido para você. RLS: cada um só vê as suas.
- Sino no cabeçalho (Realtime) + som e notificação do navegador quando um
  atendimento é atribuído (com permissão do usuário).

### 7.5 Motivos

`close_reasons` e `pause_reasons` (`id, organization_id, name, position,
active`). Desativar em vez de apagar, para não quebrar histórico.

### 7.6 Linha do tempo

`ticket_events (id, organization_id, ticket_id, type, actor_id, from_user,
to_user, from_department, to_department, meta jsonb, created_at)`. Tipos:
`created`, `queued`, `assigned`, `claimed`, `transferred`, `returned_to_ai`,
`external_reply`, `closed`. Somente inserção. Exibida intercalada com as
mensagens.

### 7.7 Painel do supervisor (`/supervisor`)

RPC `supervisor_dashboard(org_id)`, exige `reports.view`, restringe aos
departamentos do supervisor (admin/owner: todos). Retorna:
- equipe: presença, tempo no status, atendimentos abertos por pessoa;
- filas: quantidade e maior espera por departamento, alertas;
- hoje: abertos, finalizados, tempo médio na fila (`assigned_at - queued_at`),
  primeira resposta (`first_response_at - opened_at`), duração
  (`closed_at - opened_at`), nota média (`rating`, preenchida no subprojeto 3).

Atualização: Realtime em `tickets` e `agent_presence` + recarga a cada 30 s.
Clique no atendente → lista de atendimentos dele com "reatribuir".

## 8. Modelo de dados — resumo

Novas: `tickets`, `ticket_events`, `internal_notes`, `notifications`,
`close_reasons`, `pause_reasons`, `agent_presence`, `contacts`,
`contact_fields`, `tags`, `contact_tags`, `ticket_tags`, `quick_replies`.

Alteradas: `messages` (§6.1), `conversations` (`contact_id`,
`current_ticket_id`; `assigned_to`/`department_id` espelham o atendimento
aberto via gatilho), `departments` (§5.2), `organizations` (`ticket_seq`,
`settings.closing_message`, `settings.max_concurrent_default`).

`tickets`: `id, organization_id, conversation_id, protocol, status,
department_id, assigned_to, opened_at, queued_at, assigned_at,
first_response_at, closed_at, closed_by, close_reason_id, close_note, rating,
timestamps`. Índices: `(organization_id, status, department_id)`,
`(organization_id, assigned_to) WHERE status = 'open'`; único parcial
`(conversation_id) WHERE status <> 'closed'` (no máximo um aberto por conversa).

Todas com `organization_id NOT NULL`, RLS por organização e visibilidade
herdada de `can_see_conversation` quando pendurada em conversa.

Migration: `supabase/migrations/2026MMDDhhmmss_atendimento.sql`, idempotente.
Atendimentos para as conversas existentes, para que nada "suma" e nada inunde
a fila na virada:
- conversa com mensagem nos **últimos 7 dias**: atendimento aberto — `bot` se
  `ai_enabled`, senão `open` sem responsável (vai para a aba Fila);
- conversas mais antigas: um atendimento `closed` com o motivo de sistema
  "Anterior à migração", só para registrar o protocolo no histórico. Se o
  cliente voltar a escrever, nasce um atendimento novo normalmente.

## 9. Modelos prontos

`org_templates.payload` ganha: `close_reasons`, `pause_reasons`, `tags`,
`quick_replies`, `contact_fields`, e `departments[].distribution_mode`. Os seis
modelos do subprojeto 1 recebem conteúdo para cada chave.

## 10. Frontend

- **Conversas** reorganizada (e dividida em componentes em
  `src/components/atendimento/`):
  - lista com abas **Minhas · Fila · Todas** (Todas só com permissão) e filtros
    por departamento, etiqueta e status; cards com alerta de espera;
  - chat com mídia, status ✓✓, eventos da linha do tempo, notas (fundo
    amarelo), compositor com alternância Mensagem/Nota, `/` para respostas
    rápidas, clipe, arrastar e soltar, colar imagem, gravar áudio, `@` em notas;
  - painel lateral: ficha do contato, etiquetas, histórico de atendimentos e
    ações (Assumir, Transferir, Finalizar, Devolver para IA).
- Seletor de presença no cabeçalho.
- **Supervisor** (`/supervisor`).
- Configurações da organização: motivos de finalização e de pausa, etiquetas,
  respostas rápidas, campos do contato, mensagem de encerramento; distribuição
  e alertas no cadastro de departamento (tela Equipe).
- Kanban: card mostra status do atendimento e responsável.

## 11. Testes

- **Isolamento** (`supabase/tests/isolation.sql`): todas as tabelas novas entram
  no laço "A não lê/insere/altera/apaga B"; casos de Storage (usuário de A lendo
  e gravando em `media/{orgB}/…`; caminho malformado; conversa de A não visível
  ao atendente).
- **Regras** (`supabase/tests/atendimento.sql`, `BEGIN … ROLLBACK`):
  - segundo `claim_ticket` no mesmo atendimento falha;
  - `claim` acima do limite de simultâneos falha;
  - transferência para não-membro do departamento falha;
  - distribuição escolhe o menos carregado; ignora offline, pausado e heartbeat
    vencido; respeita limite; drena em ordem de chegada;
  - no máximo um atendimento aberto por conversa;
  - atendente não finaliza atendimento de outro; supervisor finaliza;
  - `internal_notes` nunca aparece para quem não vê a conversa.
- **Funções puras** (Vitest, adicionado ao projeto): detecção de tipo por bytes,
  substituição de variáveis, cálculo de alertas.
- **Edge Functions**: `send-message` recusa caminho de outra org, tipo
  proibido, tamanho acima do limite, texto livre fora da janela de 24 h.
- **E2E**: novas Waves no `TESTING.md` — fila manual, distribuição automática
  com dois atendentes, transferência, finalização com motivo, mídia nos dois
  sentidos nos dois provedores, áudio de voz, ✓✓, nota com menção, painel do
  supervisor.

## 12. Riscos

| Risco | Mitigação |
|---|---|
| Áudio de voz não aceito pelo WhatsApp | spike §6.5 antes; fallback como arquivo de áudio |
| Distribuição com condição de corrida | advisory lock por departamento + testes |
| Conversas "somem" na virada | migration cria atendimento para cada conversa existente |
| Custo de Storage com mídia | medição por organização; limite por plano no futuro |
| Nota interna vazar para o cliente | tabela separada; envio só lê `messages` |
| RLS lenta em listas grandes | índices do §8; paginação na lista de conversas |
