# 05 — API aberta e webhooks (Fase 2, item 12)

> 05/10/2026 · decisão do dono: integrações genéricas (API + webhooks) em vez de conectores um a um; Bling fora de
> foco. Serve para n8n, Make, Zapier e sistemas próprios do cliente.

## Chaves de API (Configurações → API e webhooks, dono/admin)
- Formato `dca_` + 40 caracteres aleatórios; aparece **uma vez**; o banco guarda só o SHA-256 e o prefixo.
- Permissões por chave: `contacts:read`, `contacts:write`, `messages:send`, `conversations:read`, `funnel:write`.
- Revogar na hora; registra último uso; limite de 60 chamadas/minuto por empresa; tudo auditado.

## API (`/functions/v1/api`, cabeçalho `Authorization: Bearer dca_...`)
| Método e caminho | Permissão | O que faz |
|---|---|---|
| `GET /contacts?phone=&email=` | contacts:read | busca contato (nome, telefone, e-mail, campos) |
| `POST /contacts` | contacts:write | cria/atualiza contato pelo telefone |
| `GET /conversations?since=` | conversations:read | conversas recentes (etapa, setor, situação) |
| `POST /conversations/{id}/stage` | funnel:write | move no funil (etapa da mesma empresa) |
| `POST /messages` | messages:send | envia texto no WhatsApp (respeita "pediu para sair" e a janela de 24h da Meta) |

## Webhooks (saída)
- Eventos: `contact.created`, `conversation.created`, `conversation.stage_changed`, `ticket.closed`, `message.received`.
- Endereço só `https` público (sem IP interno); segredo por endpoint (mostrado uma vez, guardado no Vault).
- Assinatura: `X-DCA-Signature: sha256=<HMAC(segredo, timestamp + "." + corpo)>` e `X-DCA-Timestamp`.
- Fila no banco (`webhook_deliveries`), envio a cada minuto, até 6 tentativas com espera crescente; endpoint com
  20 falhas seguidas é pausado e o dono é avisado.

## Segurança
- Isolamento: a chave identifica a empresa; toda consulta é filtrada pela empresa da chave; etapa, número e contato
  conferidos como da mesma empresa.
- Nada de chave em texto no banco nem nos logs; comparação por hash.
- LGPD: o cliente escolhe os eventos; o corpo leva só o necessário do evento (id, nome, telefone/e-mail do contato e
  o texto da mensagem no `message.received`).
