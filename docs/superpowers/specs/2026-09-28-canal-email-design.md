# Canal de e-mail (IMAP/SMTP) — desenho

Status: aprovado em linhas gerais pelo dono (28/09): Resend para e-mails do sistema; IMAP/SMTP para o canal;
Microsoft 365 (OAuth) depois; Google direto só com demanda (avaliação de segurança paga).
Princípio: o dono conecta a caixa sozinho pela tela (presets + “Testar conexão”).

## Viabilidade (testado no runtime do Supabase)
- Portas 993 (IMAP), 465/587 (SMTP) abertas para Hostinger, Gmail e Office 365.
- `npm:imapflow` (IMAP), `npm:nodemailer` (SMTP) e `npm:postal-mime` (MIME) funcionam.
- Hostinger fecha a conexão com usuário inexistente (“Unexpected close”) — tratar como “usuário ou senha incorretos”.

## Modelo de dados
- `email_accounts` (por org): nome, endereço, imap_host/port, smtp_host/port/segurança, usuário, senha no Vault
  (`email:<id>:password`), departamento padrão, assinatura, status/saúde, `last_uid`, `uidvalidity`, `last_sync_at`.
  RLS: membros veem nome/endereço; `org.settings` gerencia; senha nunca volta ao navegador.
- `conversations`: vira multicanal — `channel` ('whatsapp' | 'email'), `instance_id` passa a ser opcional,
  `email_account_id`, `contact_email`; CHECK: WhatsApp tem número e telefone, e-mail tem conta e endereço.
  **Uma conversa por contato por caixa** (igual ao WhatsApp por número) — reaproveita atendimento, protocolo, fila,
  departamento, assumir, transferir, notas e ficha.
- `contacts`: `phone` passa a ser opcional; contato de e-mail é ligado por `email` (único por org quando existe).
- `messages`: `email_subject`, `email_message_id`, `email_in_reply_to`; conteúdo guardado **só em texto**
  (HTML nunca é renderizado — sem risco de script); anexos no bucket privado, como no WhatsApp.

## Recebimento
- `sync-email` (cron 1 min, x-cron-secret): por caixa ativa, busca UIDs novos (`last_uid+1:*`), limite por rodada,
  grava mensagem, abre/reabre atendimento na fila do departamento padrão. UIDVALIDITY mudou → recomeça do fim.
- Ignora respostas automáticas e listas (`Auto-Submitted`, `Precedence: bulk/list`, `List-Id`), mensagens da própria
  caixa e duplicadas (`email_message_id` único por caixa).
- Falha de login → saúde crítica + alerta (mesmo mecanismo dos números).

## Envio
- `send-message` ganha o ramo de e-mail: mesmas regras (permissão, assumir). Responde com “Re: <assunto>”,
  `In-Reply-To`/`References` da última mensagem recebida, assinatura da caixa; anexos da conversa ou da biblioteca.
  Sem janela de 24 h.

## Tela
- Página **Números → Canais**: adicionar caixa com presets (Hostinger, Gmail, Outlook/365, Locaweb, KingHost, Zoho,
  Outro), botão “Testar conexão” (IMAP e SMTP), orientação de senha de app para Gmail/Outlook.
- Lista de conversas: ícone de e-mail + etiqueta da caixa; filtro por canal/caixa. Chat mostra o assunto.

## Fora desta etapa
- IA e fluxos respondendo e-mail (vem depois, reaproveitando o bloco de IA com permissões).
- Microsoft 365 por OAuth; Google direto.
