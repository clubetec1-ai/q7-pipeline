# Integração com a WhatsApp Cloud API

Data: 2026-09-23
Status: aprovado para implementação

## 1. Problema

O ClubeCRM está acoplado à Uazapi, uma API não oficial do WhatsApp. O acoplamento
está em quatro lugares: o parse do que chega no `whatsapp-webhook`, o envio em
`whatsapp-webhook` e `run-followups`, a função `manage-instance` inteira, e o
schema de `whatsapp_instances` (`server_url` + `instance_token`, conceitos que não
existem na Cloud API).

Dois motivos para mudar:

1. **Risco de banimento.** A Uazapi automatiza um WhatsApp comum. O número pode ser
   derrubado a qualquer momento e o canal de atendimento morre junto.
2. **Custo.** No perfil de uso da Clubetec — tudo inbound, lead chega pelo anúncio —
   a Cloud API é gratuita dentro da janela de 24h. A Uazapi custa R$ 38/mês.

A Uazapi continua útil para um cenário específico: disparo em número descartável,
onde o risco de perder o número é aceito de propósito.

## 2. Objetivo

Introduzir a noção de **provedor** no sistema, com Uazapi e Cloud API convivendo,
escolhidos por número. Nenhuma regressão no atendimento que já funciona.

## 3. Não faz parte deste escopo

- Cadastro e submissão de templates pela interface do ClubeCRM. Os templates são
  criados no WhatsApp Manager; aqui só referenciamos pelo nome.
- Envio de mídia pela Clara (imagem, documento, áudio de saída).
- Migração de histórico entre provedores.
- Botões, listas e carrosséis.

## 4. Arquitetura

### 4.1 O contrato

```
supabase/functions/_shared/providers/
  types.ts     interface WhatsAppProvider + tipos normalizados
  uazapi.ts    implementação atual, extraída do webhook
  cloud.ts     implementação Meta
  index.ts     detectPayloadProvider() e providerFor(instRow)
```

```ts
interface NormalizedInbound {
  kind: "message" | "status" | "connection" | "ignore";
  providerRef: { token?: string; phoneNumberId?: string; wabaId?: string; name?: string };
  phone: string;          // só dígitos, com DDI
  text: string | null;    // texto ou rótulo de mídia ("[áudio]")
  mediaId: string | null; // identificador para baixar o áudio
  mediaKind: "audio" | "image" | "video" | "document" | null;
  contactName: string | null;
  fromMe: boolean;
  isGroup: boolean;
  status?: string;        // para kind === "connection"
}

interface WhatsAppProvider {
  readonly id: "uazapi" | "cloud";
  parseInbound(body: unknown): NormalizedInbound;
  sendText(inst: InstanceRow, to: string, text: string): Promise<SendResult>;
  sendTemplate(inst: InstanceRow, to: string, t: TemplateRef): Promise<SendResult>;
  getAudioBytes(inst: InstanceRow, mediaId: string): Promise<Uint8Array | null>;
}

interface SendResult {
  ok: boolean;
  error?: string;
  code?: string;        // código do provedor, ex.: "131047"
  outsideWindow?: boolean;
}
```

O resto do sistema — achar a conversa, chamar a Groq, gravar mensagem, agendar
follow-up — não sabe qual provedor está em uso.

### 4.2 Um webhook só

`whatsapp-webhook` continua sendo o único ponto de entrada. Ele:

1. Responde **GET** com a verificação da Meta (`hub.challenge`) — já implementado.
2. No **POST**, identifica o provedor pelo formato do corpo:
   - `{"object":"whatsapp_business_account"}` → Cloud
   - `{"EventType":...}` ou `{"event":...}` → Uazapi
3. Normaliza com `parseInbound` do provedor detectado.
4. Segue o fluxo existente, que passa a ser comum aos dois.

Duplicar o webhook por provedor foi descartado: a lógica central — Groq, upsert de
conversa, follow-up, takeover — é a parte cara de manter, e ela ficaria em dobro.

### 4.3 Identificação da instância

Cascata por provedor, resolvida em `index.ts`:

| Provedor | Ordem de busca |
|---|---|
| Uazapi | `instance_token` → `name` → telefone do dono |
| Cloud | `phone_number_id` → `waba_id` |

O `phone_number_id` vem em `entry[].changes[].value.metadata.phone_number_id` e é
estável por número, o que torna a identificação determinística — melhor do que a
cascata da Uazapi, que existe porque o payload dela varia.

## 5. Modelo de dados

Migration nova: `supabase/migrations/20260924000000_whatsapp_providers.sql`.
A migration original não se altera.

```sql
alter table public.whatsapp_instances
  add column if not exists provider text not null default 'uazapi',
  add column if not exists phone_number_id text,
  add column if not exists waba_id text;

alter table public.whatsapp_instances
  add constraint whatsapp_instances_provider_check
  check (provider in ('uazapi','cloud'));

create unique index if not exists whatsapp_instances_phone_number_id_key
  on public.whatsapp_instances (phone_number_id)
  where phone_number_id is not null;

alter table public.conversations
  add column if not exists last_inbound_at timestamptz;
```

Decisões:

- **`provider` com default `'uazapi'`** — as instâncias existentes continuam
  funcionando sem intervenção.
- **`instance_token` é reaproveitado** como o segredo de ambos: token da instância
  na Uazapi, access token permanente na Cloud API. Evita uma segunda coluna de
  segredo, que é coisa que se esquece de proteger. `server_url` fica só para Uazapi.
- **`last_inbound_at` é coluna nova** e não reaproveita `last_message_at`, porque
  este último também sobe quando a Clara responde. Para a janela de 24h só conta
  quando o cliente falou.
- **Índice único parcial em `phone_number_id`** — dois números Cloud não podem
  colidir, mas linhas Uazapi (com nulo) não são afetadas.

### 5.1 Conversa por número

```sql
alter table public.conversations
  alter column instance_id set not null;

alter table public.conversations
  drop constraint conversations_user_id_contact_phone_key,
  add constraint conversations_user_instance_phone_key
    unique (user_id, instance_id, contact_phone);

alter table public.conversations
  drop constraint conversations_instance_id_fkey,
  add constraint conversations_instance_id_fkey
    foreign key (instance_id) references public.whatsapp_instances(id)
    on delete cascade;
```

O mesmo contato falando em dois números vira duas conversas, com históricos e
prompts separados. Sem isso, o número de disparo e o de atendimento
compartilhariam contexto e a Clara se confundiria.

`instance_id` passa a ser obrigatório, então `on delete set null` deixaria de ser
válido e vira `cascade`. Consequência aceita: apagar um número apaga as conversas
dele. Para preservar histórico, o caminho é desativar a instância, não apagá-la.

Verificado antes de escrever: hoje existe 1 conversa, com `instance_id` preenchido.
A migration não precisa de backfill.

## 6. Fluxo de entrada — Cloud API

Formato relevante:

```json
{"object":"whatsapp_business_account",
 "entry":[{"id":"<waba_id>","changes":[{"field":"messages","value":{
   "metadata":{"phone_number_id":"1303429602856665"},
   "contacts":[{"profile":{"name":"Thiago"},"wa_id":"5519999771000"}],
   "messages":[{"from":"5519999771000","id":"wamid...","type":"text",
                "text":{"body":"oi"}}]}}]}]}
```

Regras:

- `value.statuses` em vez de `value.messages` → `kind: "status"`, ignorado. São
  confirmações de entrega e leitura.
- A Cloud API **não devolve as mensagens que nós mesmos enviamos** como entrada,
  diferente da Uazapi. O `excludeMessages: wasSentByApi` não tem equivalente nem é
  necessário — `fromMe` é sempre `false`.
- Tipos de mídia viram rótulo (`[áudio]`, `[imagem]`) e guardam `mediaId` para a
  transcrição.
- Mensagem de grupo não existe na Cloud API. `isGroup` é sempre `false`.

## 7. Fluxo de saída — Cloud API

```
POST https://graph.facebook.com/{GRAPH_VERSION}/{phone_number_id}/messages
Authorization: Bearer {instance_token}

{"messaging_product":"whatsapp","to":"5519999771000",
 "type":"text","text":{"body":"..."}}
```

`GRAPH_VERSION` fica numa constante em `cloud.ts`, validada contra a API real na
implementação.

Template:

```json
{"messaging_product":"whatsapp","to":"...","type":"template",
 "template":{"name":"retomada_orcamento","language":{"code":"pt_BR"},
             "components":[{"type":"body","parameters":[
               {"type":"text","text":"Thiago"},
               {"type":"text","text":"PABX em nuvem"}]}]}}
```

Erros tratados por código, não por texto:

| Código | Significado | Ação |
|---|---|---|
| 131047 | fora da janela de 24h | `outsideWindow: true` |
| 132000 | parâmetros do template não batem | falha com mensagem clara |
| 132001 | template inexistente | falha com mensagem clara |
| 190 | token inválido ou expirado | falha e registra para o admin |
| 131026 | destinatário não tem WhatsApp | cancela |

## 8. Janela de atendimento de 24 horas

Regra da Meta: mensagem livre só sai dentro de 24h desde a última mensagem **do
cliente**. Fora disso, só template aprovado.

- `conversations.last_inbound_at` é atualizado a cada entrada com
  `kind === "message"`.
- `isWindowOpen(conv)` = `last_inbound_at > now() - 24h`.
- Antes de qualquer envio numa instância Cloud, o sistema consulta a janela.
  - **Janela aberta:** `sendText`, como hoje.
  - **Janela fechada:** não envia. O follow-up é marcado `status: 'failed'`,
    `error: 'janela de 24h fechada — exige template aprovado'`.
- Em instância Uazapi a janela é ignorada: não existe esse conceito lá.

O envio de template está implementado no provedor e é chamável, mas nenhum fluxo
automático o dispara nesta etapa. Isso é deliberado: disparar template sem os
textos da Clubetec aprovados geraria mensagem errada para cliente real.

Resposta à pergunta que motivou a decisão: o motor fica pronto e comprovado até
onde a realidade permite hoje. Quando os templates da Clubetec estiverem aprovados,
o que falta é referenciá-los — não reescrever lógica.

## 9. Transcrição de áudio

Hoje áudio vira o rótulo `[áudio]` e a Clara pede para a pessoa resumir por texto.
Em WhatsApp brasileiro isso perde lead.

Duas metades:

1. **Baixar os bytes** — específico do provedor.
   - Uazapi: `POST {server}/message/download` com `return_base64: true`.
   - Cloud: `GET /{media_id}` devolve uma URL temporária; baixa essa URL com o
     mesmo Bearer.
2. **Transcrever** — comum: Groq `whisper-large-v3-turbo`, via
   `POST /openai/v1/audio/transcriptions`.

A transcrição da Uazapi (`transcribe: true`) foi descartada: exige uma chave da
OpenAI que a Clubetec não tem, e o resultado seria jogado fora na migração. O
Whisper da Groq usa a chave que a Clara já usa, está no plano gratuito, e sobrevive
à troca de provedor.

Comportamento:

- Sucesso: o conteúdo da mensagem vira `🎤 <transcrição>`. O prefixo distingue
  falado de digitado no histórico sem precisar de coluna nova.
- Falha de qualquer natureza — áudio grande, Groq fora do ar, formato estranho —
  cai no comportamento atual, `[áudio]`. A transcrição nunca pode derrubar o
  atendimento.
- Áudio acima de 20 MB é ignorado sem tentar.

## 10. Tela de configuração

Em `ConfigDrawer.tsx`, a seção "Conexão Uazapi" vira "Conexão WhatsApp", com um
seletor de provedor:

- **Uazapi:** Server URL + Instance Token + QR Code, como hoje.
- **Cloud API:** Phone Number ID, WABA ID, Access Token, e a URL do webhook em
  campo somente leitura com botão de copiar — é o valor que o usuário cola no
  painel da Meta.

`manage-instance` ganha guarda: as ações de QR Code, criação e status de instância
são específicas da Uazapi e passam a recusar instância Cloud com erro explicativo,
em vez de falhar de forma obscura.

## 11. Convivência e migração

- Instâncias existentes ficam `provider = 'uazapi'` e não mudam de comportamento.
- O número 99100-6831 é recadastrado como instância Cloud
  (`phone_number_id = 1303429602856665`, `waba_id = 1772172033902500`).
- Um futuro número de disparo entra como instância Uazapi, sem conflito.
- O webhook da Meta e o da Uazapi apontam para a mesma URL.

## 12. Testes

| O que | Como |
|---|---|
| Verificação GET | token certo devolve challenge, errado devolve 403 |
| Detecção de provedor | payload Cloud e payload Uazapi, cada um para o seu parser |
| Parse Cloud | mensagem de texto, mídia e `statuses` |
| Identificação da instância | por `phone_number_id` |
| Janela de 24h | `last_inbound_at` recente, antigo e nulo |
| Envio Cloud | mensagem real do 99977-1000 para o 99100-6831, resposta da Clara |
| Regressão Uazapi | POST de ping continua 200; instância Uazapi segue enviando |
| Transcrição | áudio real enviado ao número, conteúdo gravado com 🎤 |

## 13. Riscos

- **`GRAPH_VERSION` desatualiza.** Mitigado por constante única e teste real.
- **App em modo de desenvolvimento não recebe webhook de produção.** Exige o toggle
  "Ao vivo" e "Assinar webhooks" ligado na WABA. É configuração no painel, não
  código, e está documentado no checklist de implantação.
- **Token permanente vaza.** Fica em `instance_token`, tabela com RLS e visível só
  ao dono. Nunca vai para o frontend.
