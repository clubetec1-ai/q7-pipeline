# ClubeCRM — o que falta implementar

Lista viva. Cada item vira spec/plano em `docs/superpowers/` quando começar.
Regra de sempre: isolamento entre organizações, segredos no Vault, testes em `supabase/tests/isolation.sql`.

## Próximos (ordem combinada)
1. **Biblioteca de arquivos** — arquivos da empresa (bucket privado por org); destrava a IA enviar arquivo
   (`send_file` no bloco de IA) e anexos nas respostas rápidas.
2. **Infraestrutura (1C-2)** — fila de mensagens recebidas com reprocessamento (`inbound_events` /
   `process-inbound`), limite de requisições por organização, painel da plataforma para gerenciar as empresas clientes.

## Canal de e-mail (pedido em 28/09)
Objetivo: enviar e receber e-mail pelo ClubeCRM, no mesmo lugar do WhatsApp.
- **Serviço de envio com provedores plugáveis** (por organização, credenciais no Vault):
  SMTP genérico; Google Workspace/Gmail e Microsoft 365/Outlook (OAuth); APIs como Resend, SendGrid, Amazon SES.
- **Alertas por e-mail** usando esse serviço: saúde dos números (hoje só sino + faixa), e depois outros avisos.
- **Recebimento na tela do operador**: e-mail vira conversa/atendimento (protocolo, fila, departamento, assumir,
  transferir), com respostas saindo pelo mesmo endereço. Entrada por webhook de recebimento do provedor
  (Resend/SendGrid/Mailgun) ou leitura da caixa (Gmail API / Microsoft Graph / IMAP).
  Cuidados: SPF/DKIM do domínio, anexos no bucket privado, filtro de spam/loops (resposta automática), LGPD.
- **Depois: IA no e-mail** — triagem (assunto, urgência, departamento) e rascunho/resposta automática, reaproveitando
  o bloco de IA com permissões fechadas e o fluxo.

## Números e Meta
- Cadastro de número da Meta em poucos cliques (Embedded Signup) — depois da aprovação da Meta.
- Nova conversa iniciada pelo atendente com modelo aprovado (spec números §10).

## Contatos e atendimento
- Campos personalizados do contato (com `ai_readable` / `sensitive`).
- Botão de anonimizar contato (LGPD) — limpa também `flow_runs.vars` e `tickets.rating_comment`.
- Gravação de áudio pelo navegador.
- Modo depuração do bloco HTTP (corpo no log por 1 h, cortado e com retenção curta).

## Grandes módulos
- Voz: ramal SIP com transcrição e continuação no WhatsApp.
- Messenger e Instagram.
- “Cérebro” de IA coordenando agentes por área (administrativo, financeiro, RH, vendas, pós-venda, suporte).
- Backup para destinos plugáveis (precisa das contas do cliente).

## Visual
- Trocar logo e ícone da aba.
