# 2E — Protocolo e assumir com permissão — Plano enxuto

Pedido do usuário (27/09). Executar após o merge da 3A e antes da 3B. Execução inline.

## 1. Assumir com permissão (segurança — prioridade)
- `send-message`: atendimento com outra pessoa → 409 para todos, inclusive admin. Resposta só depois de assumir.
- Botão **Assumir** na barra do atendimento só para quem tem `conversations.reassign`. Usa `transfer_ticket` para si mesmo, que registra o evento (quem assumiu e de quem), notifica o atendente anterior e envia a saudação ao cliente.
- Sem a permissão: o campo de mensagem fica bloqueado com o aviso "Atendimento com Fulano".
- Teste SQL: agente não assume o atendimento de outro; admin assume e o evento fica registrado.

## 2. Protocolo
- **No início:** configuração da empresa "Enviar protocolo ao abrir atendimento" (liga/desliga + texto editável, padrão "Seu protocolo é {protocolo}"). Enviado quando o webhook abre um atendimento novo.
- **Na transferência:** a notificação e o evento do atendente que recebe mostram o protocolo e o motivo. Opcional (configuração): avisar o cliente "Você foi transferido para {departamento}. Protocolo {protocolo}".
- **Quando o cliente pede:**
  - botão "Enviar protocolo" na barra do atendimento (um clique);
  - `{protocolo}` nos blocos do fluxo (engine `fill`);
  - a IA recebe o protocolo no contexto e responde se o cliente perguntar.
- **Ficha do contato:** aba com o histórico de protocolos do cliente (data, status, atendente, departamento), com busca pelo número do protocolo na lista de conversas.
