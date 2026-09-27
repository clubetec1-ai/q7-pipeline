# ClubeCRM — o que falta implementar

Lista viva. Cada item vira spec/plano em `docs/superpowers/` quando começar.
Regra de sempre: isolamento entre organizações, segredos no Vault, testes em `supabase/tests/isolation.sql`.

## Próximos (ordem combinada)
1. **Canal de e-mail** (abaixo) — anexos usam a biblioteca/bucket privado.
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

## Voz: ramal SIP na tela do atendimento (pedido original)
Objetivo: a ligação cai na mesma tela do WhatsApp.
- **Ramal SIP de PBX em nuvem dentro do navegador** (WebRTC/SIP.js), por atendente; integração com a central
  (ou via API de voz, como alternativa) — credenciais SIP no Vault, por organização.
- **Identifica o número** que ligou e abre/associa o contato e a conversa (mesmo atendimento, protocolo).
- **Transcrição da ligação** em tempo real ou ao final, gravada no histórico do atendimento.
- **Confirmação do número**: o atendente pede para o cliente repetir/confirmar o número de WhatsApp e, ainda durante
  a ligação, o CRM envia um “olá” pelo WhatsApp para continuar o atendimento por lá.
- Cuidados: aviso de gravação/transcrição (LGPD), retenção do áudio, permissão por papel, custo por minuto.

## IA
- **Agente entrevistador (levantamento da empresa)** — primeiro passo do “cérebro”. Conversa com o dono (e, se ele
  quiser, com responsáveis de cada área) como um consultor, e monta o retrato de como a empresa funciona:
  - processos repetidos do dia a dia (o que se faz, quem faz, com que frequência, quanto tempo leva, onde trava);
  - políticas (troca, cancelamento, prazos, pagamento, garantia, descontos), horários de atendimento e feriados;
  - produtos/serviços, preços ou regra de orçamento, perguntas frequentes dos clientes;
  - áreas, departamentos, pessoas e responsáveis; sistemas usados (ERP, planilhas, agenda) e o que dá para integrar;
  - volumes (mensagens, ligações, pedidos), metas e maiores dores.
  Resultado: uma **base de conhecimento da empresa** (por organização, editável pelo dono) e um **relatório de
  sugestões** — quais agentes/automações implementar, por área, priorizados por impacto e esforço, com o que cada
  um precisa (dados, integrações, permissões). Retoma a entrevista de onde parou e pergunta só o que falta.
  Aproveita o que já está cadastrado (horários, departamentos, motivos, fluxos). Acesso só `org.settings`; dados
  sensíveis marcados e fora do contexto da IA de atendimento (LGPD).
- **Agente implementador (depois)** — a partir do levantamento aprovado, monta automaticamente os rascunhos:
  fluxos, agentes de IA com prompt e permissões fechadas, respostas rápidas, blocos “Consultar sistema”, horários e
  departamentos. Tudo fica **em rascunho para o dono revisar e publicar** (nada entra no ar sozinho), com registro na
  auditoria e simulador para testar antes.
- **“Cérebro” da operação**: agente que coordena agentes por área — administrativo, financeiro, RH, vendas,
  pós-venda, suporte e outras — com as automações de cada área (software completo para a empresa).
- **IA entender imagens, vídeos e PDFs** que o cliente envia (hoje só áudio é transcrito).

## Disparos (campanhas)
- Envio em massa para grupos de clientes, escolhendo o número (ex.: um número QR para disparos e o da Meta para
  receber clientes, como pedido). Respeita opt-out, horário e limite por minuto; modelos aprovados no número da Meta.
- Aviso: disparo por número não oficial tem risco de bloqueio — o monitor de saúde já avisa se cair.

## SaaS (venda para clientes)
- Painel da plataforma (está em Infraestrutura) + **planos e cobrança** por organização (`org.billing`).
- Opção de hospedagem própria (VPS, ex.: Hostinger), além de Supabase + Vercel.

## Números e Meta
- Cadastro de número da Meta em poucos cliques (Embedded Signup) — depois da aprovação da Meta.
- Nova conversa iniciada pelo atendente com modelo aprovado (spec números §10).

## Contatos e atendimento
- Campos personalizados do contato (com `ai_readable` / `sensitive`).
- Botão de anonimizar contato (LGPD) — limpa também `flow_runs.vars` e `tickets.rating_comment`.
- Gravação de áudio pelo navegador.
- Modo depuração do bloco HTTP (corpo no log por 1 h, cortado e com retenção curta).

## Outros canais e continuidade
- Messenger e Instagram.
- **Backup automático** dos dados de cada cliente para um servidor de backup, com restauração em caso de queda ou
  ataque (destinos plugáveis; precisa das contas/servidor).

## Já entregue (referência)
Vários números (Meta e QR), fluxos com IA/humano/transferir/finalizar, departamentos, grupos de clientes e de
pessoas, papéis e modelos prontos, multiempresa com isolamento, protocolo e assumir com permissão, pesquisa,
opt-out, bloco HTTP, IA com permissões e vários provedores, monitor de saúde, nome na equipe, termos e exclusão
de dados, legenda em anexos, transcrição de áudio, biblioteca de arquivos (envio pelo atendente, respostas rápidas
com arquivo, arquivo no bloco Mensagem e IA enviando arquivo permitido).

## Visual
- Trocar logo e ícone da aba (nome “Clube” junto do logo, em cima).
