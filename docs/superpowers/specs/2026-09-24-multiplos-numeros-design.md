# Vários números: Meta (Embedded Signup) e Uazapi

Data: 2026-09-24
Status: aprovado para implementação
Subprojeto: 4 de 4
Depende de: `2026-09-24-multi-tenant-equipes-design.md` (organizações, Vault,
webhook autenticado, `forOrg`), `2026-09-24-atendimento-humano-design.md`
(conversas, envio único), `2026-09-24-construtor-de-fluxo-design.md`
(`whatsapp_instances.flow_id`)

## 1. Problema

O backend já suporta vários números e os dois provedores, mas a interface
(`ConfigDrawer`) carrega **um** número só. Conectar um número da Meta exige
copiar Phone Number ID, WABA ID e token à mão — difícil para o cliente e
inseguro (tokens trafegando por e-mail/WhatsApp até quem configura). A Uazapi
exige configurar o webhook manualmente. Ninguém é avisado quando um número cai.

## 2. Objetivo

Gestão de vários números por organização, **o mais segura e o mais fácil
possível**:

- Meta pelo **Embedded Signup v4** ("Conectar com Facebook") como caminho
  principal; conexão manual como alternativa avançada;
- Uazapi por QR Code (ou código de pareamento) com webhook automático;
- monitoramento de saúde com alertas;
- número visível e filtrável no atendimento; "nova conversa" escolhendo o
  número.

## 3. Não faz parte deste escopo

- Criação/submissão de modelos de mensagem pelo ClubeCRM (continuam no
  WhatsApp Manager; aqui só listamos os aprovados).
- Migração de um número entre provedores ou entre organizações.
- Restringir a visibilidade de um número a departamentos (o roteamento é feito
  pelo fluxo).
- Cobrança dos custos da Meta (o cliente paga direto à Meta, com o próprio
  cartão).

## 4. Pré-requisito externo

A Clubetec como **Independent Tech Provider** aprovado (verificação da empresa:
concluída; App Review de `whatsapp_business_messaging` e
`whatsapp_business_management` com acesso avançado: em andamento). Até a
aprovação, o Embedded Signup fica desligado (§5.4) e vale o caminho manual.

## 5. Meta — Embedded Signup v4

### 5.1 Configuração da plataforma

Em `app_settings` (plataforma) / Vault:
- `meta_app_id` (público), `meta_es_config_id` (id da configuração do
  Facebook Login for Business, público), `meta_graph_version`;
- `meta_app_secret` (Vault, já previsto no subprojeto 1);
- `meta_embedded_signup_enabled` (liga/desliga).

### 5.2 Fluxo

```
[navegador]                          [meta-onboard (Edge, JWT, org.settings)]        [Meta]
 clica "Conectar com Facebook"
   ── start ──────────────────────►  cria onboarding_session (uso único, 10 min,
                                     org + usuário) → devolve session_id
 FB.login(config_id, v4) ─────────────────────────────────────────────────────────►  pop-up
   ◄── postMessage (WA_EMBEDDED_SIGNUP: waba_id, phone_number_id)  aceito só se
       event.origin é https://www.facebook.com ou https://web.facebook.com
   ◄── authResponse.code
   ── finish(session_id, code, waba_id, phone_number_id) ►
                                     1. valida e consome a sessão (org, usuário,
                                        validade, não usada)
                                     2. troca code → token (server-to-server,
                                        com app secret) ──────────────────────────►
                                     3. debug_token: confere que waba_id e
                                        phone_number_id estão nos target_ids dos
                                        escopos concedidos ──────────────────────►
                                     4. número já existe em outra org? → recusa
                                     5. token → Vault
                                     6. POST /{waba}/subscribed_apps ─────────────►
                                     7. gera PIN de 6 dígitos (Vault) e
                                        POST /{phone_number_id}/register ─────────►
                                     8. lê nome verificado, telefone, qualidade
                                     9. cria whatsapp_instances (provider cloud)
                                    10. audit_log "number.connected"
   ◄── ok + dados do número
```

- **O passo 3 é a principal proteção**: sem ele, um usuário poderia adulterar o
  `waba_id`/`phone_number_id` no navegador e vincular à própria organização um
  número de outra empresa. Divergência → recusa + `audit_log`
  `number.connect_rejected`.
- Falha a partir do passo 6: a função desfaz o que conseguir (remove a
  inscrição, apaga o segredo do Vault), não cria a instância, e devolve a etapa
  que falhou em linguagem simples.
- O `code` e o token **nunca** são gravados em log nem devolvidos ao
  navegador.
- `onboarding_sessions (id, organization_id, user_id, expires_at, used_at)` —
  RLS sem policy (só backend).

### 5.3 Depois de conectar

Checklist no cartão do número:
- "Adicionar forma de pagamento na Meta" (link para o WhatsApp Manager). Sem
  isso a Meta não entrega mensagens iniciadas pela empresa;
- "Nome de exibição aprovado" (status lido da API);
- "Fluxo vinculado".

### 5.4 Liga/desliga

`meta_embedded_signup_enabled = false` → o botão não aparece; o assistente
oferece só o caminho manual, com o texto "conexão com Facebook disponível em
breve".

## 6. Meta — conexão manual (avançado)

Campos: Phone Number ID, WABA ID, token permanente e, opcional, App Secret
próprio (quando o cliente usa o próprio app Meta; ver subprojeto 1 §6.3).

Antes de gravar, `meta-onboard` (ação `manual`) chama `GET /{phone_number_id}`
e `debug_token` com o token informado e confere que ele acessa aquele número e
aquela WABA. Falhou → nada é gravado. Passou → mesmos passos 4–10 do §5.2
(inscrição do webhook, registro opcional se ainda não registrado).

## 7. Uazapi

- Pré-requisito: servidor Uazapi da organização configurado (URL + admin token
  no Vault, subprojeto 1).
- "Adicionar número por QR Code": `manage-instance` (ação `create`) cria a
  instância, grava o token no Vault, gera `webhook_secret` e **configura o
  webhook automaticamente** (`…/whatsapp-webhook?k=<segredo>`, eventos de
  mensagem e conexão).
- Tela mostra o QR Code e atualiza a cada poucos segundos até conectar; QR
  expira → novo QR com um clique.
- Código de pareamento (digitar código no celular), se o servidor Uazapi
  oferecer; senão a opção não aparece.
- Aviso fixo no cartão: "API não oficial — o número pode ser bloqueado pelo
  WhatsApp. Recomendado para números secundários."

## 8. Tela "Números" (`/numeros`, `org.settings`)

- Lista: nome, telefone, tipo (**Oficial Meta** / **QR Code**), status,
  fluxo vinculado, cor da etiqueta, e na Meta: qualidade (verde/amarela/
  vermelha) e faixa de limite de mensagens; último evento recebido.
- Assistente "Adicionar número" (3 passos): escolher tipo (Meta recomendada) →
  conectar → nome, cor e fluxo.
- Editar: nome, cor, fluxo; trocar token (manual); trocar segredo do webhook
  (Uazapi); reconectar (QR).
- **Desconectar** (padrão): `status = 'disabled'`; webhook ignora eventos do
  número (grava `skipped`); histórico preservado.
- **Excluir definitivamente**: só `owner`; exige digitar o telefone; explica que
  apaga as conversas desse número (cascade do subprojeto 1); remove inscrição
  na Meta / instância na Uazapi e os segredos do Vault; `audit_log`.
- **Limite por plano**: `organizations.settings.max_numbers` conferido no
  servidor (`meta-onboard` e `manage-instance`) antes de criar.
- O `ConfigDrawer` deixa de ter a seção de número; aponta para `/numeros`.

## 9. Saúde dos números

`check-numbers` (cron a cada 15 min, `x-cron-secret`), por organização:
- Meta: `GET /{phone_number_id}?fields=quality_rating,messaging_limit_tier,
  status,name_status` — token inválido, número banido/restrito, qualidade
  `RED`;
- Uazapi: status da instância.

Grava em `whatsapp_instances` (`health_status`, `quality_rating`,
`messaging_limit_tier`, `last_health_check_at`, `health_error`). Mudança para
pior → `notifications` para owner/admin, **e-mail** (mesmo SMTP dos convites)
e faixa de aviso no topo da tela para quem tem `org.settings`. Um alerta por
mudança de estado (sem repetir a cada 15 min).

## 10. No atendimento

- Lista de conversas e cabeçalho do chat mostram a etiqueta do número (nome +
  cor); filtro por número.
- **Nova conversa**: escolher número e contato (existente ou novo telefone). Em
  número Meta, a primeira mensagem é um modelo aprovado (lista lida da API
  `GET /{waba}/message_templates?status=APPROVED`, com cache de 10 min), com
  preenchimento das variáveis. Contato com opt-out (subprojeto 3 §9) →
  bloqueado com explicação.

## 11. Dados

Alterações em `whatsapp_instances`: `color`, `status` passa a aceitar
`disabled`, `health_status`, `health_error`, `quality_rating`,
`messaging_limit_tier`, `last_health_check_at`, `connected_via`
(`embedded_signup`|`manual`|`qr`), `pin_secret_id` (Vault).

Nova: `onboarding_sessions` (§5.2).

## 12. Segurança — resumo

1. App Secret e tokens só no servidor/Vault; `code` e token fora de logs.
2. Sessão de conexão de uso único, presa a organização + usuário, 10 min.
3. `postMessage` aceito só de origens do Facebook.
4. **Conferência de posse** (`debug_token` → `target_ids`) antes de vincular.
5. Número já vinculado a outra organização → recusa sem revelar qual.
6. PIN de duas etapas gerado pelo servidor e guardado no Vault.
7. Credenciais manuais testadas antes de gravar.
8. Exclusão definitiva só pelo owner, com confirmação e auditoria.
9. CSP (subprojeto 1 §16.3) libera **somente** `https://connect.facebook.net`
   em `script-src` e `https://www.facebook.com` / `https://web.facebook.com`
   em `frame-src` e `connect-src` necessários ao SDK.

## 13. Testes

- `meta-onboard`: sessão expirada, reutilizada ou de outra org → recusa;
  `waba_id`/`phone_number_id` fora dos `target_ids` → recusa + auditoria;
  número de outra org → recusa com mensagem neutra; falha na inscrição →
  rollback sem instância; limite do plano; não-admin → 403. (Graph API
  simulada por um servidor falso nos testes.)
- Manual: token sem acesso ao número → nada gravado.
- Uazapi: criação configura webhook com segredo; limite do plano.
- `check-numbers`: transição de estado gera um alerta; estado igual não repete.
- Isolamento: `onboarding_sessions` sem acesso para `authenticated`;
  instâncias de outra org invisíveis.
- E2E (Waves no `TESTING.md`): conectar número pelo Embedded Signup em conta de
  teste; conectar manual; conectar Uazapi por QR; desconectar e reconectar;
  alerta de número desconectado; nova conversa com modelo.

## 14. Riscos

| Risco | Mitigação |
|---|---|
| App Review demorar | caminho manual completo; liga/desliga |
| Cliente sem forma de pagamento na Meta | checklist pós-conexão; erro de envio traduzido para "adicione a forma de pagamento" |
| Mudança na API do Embedded Signup (v2 → v4 já anunciada) | versão da Graph e do fluxo configuráveis em `app_settings`; testes E2E a cada troca |
| Número Uazapi banido | aviso na escolha; alerta de saúde; recomendação da Meta |
| Limite de 10 onboardings/7 dias antes do App Review | só afeta o Embedded Signup; manual sem limite |
