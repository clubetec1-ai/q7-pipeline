# ClubeCRM — o que falta implementar

Lista viva. Cada item vira spec/plano em `docs/superpowers/` quando começar.
Regra de sempre: isolamento entre organizações, segredos no Vault, testes em `supabase/tests/isolation.sql`.

**Princípio do produto:** o dono da empresa cliente faz praticamente tudo sozinho pela tela (conectar números e
e-mails, montar fluxos e agentes, instalar automações prontas, seguir guias de integração) — com modelos, presets,
botão “testar” e mensagens claras. Só integrações complexas ficam com o time Clubetec, como serviço pago.
Mais receita, menos suporte.

## Próximos (a combinar)
Sugestão: validar o conector Bling (beta) com conta real e acrescentar Omie, Tiny, Nuvemshop e Google Agenda
na mesma estrutura de receitas → cobrança: Mercado Pago/Efí, IA gerando cobrança (com permissão), cobrança
recorrente e ligação com “Conta a receber”.
Registros: falta criar/atualizar registro a partir do fluxo e da IA (bloco próprio) — entra com o implementador. Pendências técnicas: revisão de grants por coluna nas tabelas antigas (tarefa separada);
login com segundo fator (MFA) para dono/admin/operador.

## Canal de e-mail (pedido em 28/09) — IMAP/SMTP e alertas entregues; falta o que segue
- Pendente: Microsoft 365 por OAuth; Google direto (com demanda); cópia das respostas na pasta “Enviados” da caixa;
  IA/fluxos no e-mail.

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
- **Entrevistador 2.0: consultoria completa e planejamento estratégico (pedido em 28/09)** — evoluir o entrevistador
  de “levantamento” para uma consultoria completa, em etapas, que retoma de onde parou:
  1. **Dados públicos primeiro**: antes de perguntar, busca o que é público (site, redes sociais, Google Meu Negócio,
     CNPJ/atividade) para já chegar entendendo a empresa e perguntar menos; o dono confirma ou corrige.
  2. **Cultura da empresa**: se já tem cultura definida e como ela funciona no dia a dia; pede ao dono **missão,
     visão e valores** (se não tiver, ajuda a escrever).
  3. **Onde a empresa está agora**: situação atual, números, dores, o que já funciona bem.
  4. **Resultados que quer buscar**: metas e objetivos (faturamento, atendimento, tempo, custo, crescimento).
  5. **Mapa de setores**: o dono descreve todos os setores (vendas, financeiro, RH, suporte, operação...), com
     responsáveis.
  6. **Processos de cada setor, um a um**: depois de todos os setores mapeados, entra em cada um e pede para
     descrever cada processo **“como se estivesse ensinando para outra pessoa”** — passo a passo, quem faz, com
     que ferramenta, quanto tempo, onde trava, exceções. O agente explica esse jeito de descrever e dá exemplo.
     Pode convidar o responsável do setor para responder a parte dele.
  7. **Análise**: com todos os setores e processos descritos, separa o que pode ter **melhoria de processo** e o que
     pode ser **automatizado**.
  8. **Planejamento estratégico + plano de ação**: documento final com diagnóstico, missão/visão/valores, objetivos,
     prioridades, plano de ação (o quê, quem, quando) e as sugestões — deixando **os agentes e fluxos configurados em
     rascunho** pelo implementador, para o dono revisar e publicar.
  - **Prioridade de custo**: toda automação que dá para fazer **sem IA** (fluxo, regra, resposta rápida, registro,
    conector) entra **primeiro**; agentes de IA só onde realmente precisam — menos custo e impacto financeiro para a
    empresa cliente, mais valor entregue.
  - **Claude nos agentes**: adicionar Anthropic como provedor; **Haiku** para respostas simples (triagem, FAQ,
    classificação) e **Sonnet** para as complexas (consultoria, planejamento, análise de processos). O entrevistador
    em si usa Sonnet. Escolha automática por tipo de tarefa, com o dono podendo trocar.
  - **Estimativa de custo**: com base nos processos mapeados (volume de mensagens/atendimentos por mês, qual agente
    e modelo cada automação usa), estimar quanto a empresa gastaria por mês com os agentes funcionando (tokens ×
    preço do modelo, em R$), comparando com o que já faz sem IA — por automação e total, para decidir o que ativar.
  - Cuidados: dados de cultura/estratégia são sensíveis (só `org.settings`, fora do contexto da IA de atendimento
    salvo o que o dono liberar); busca pública só de fontes abertas; tudo editável pelo dono; relatório exportável.
- **Agentes e fluxos prontos + guia de integração (pedido em 28/09)** — separar as automações em dois grupos:
  - **Prontas com o que o CRM já tem** → modelos instaláveis com um clique (em rascunho, para revisar e publicar):
    recepção e triagem por departamento; horário de atendimento com mensagem fora do expediente; FAQ com IA e
    transbordo para humano; qualificação de lead (nome, e-mail, interesse → etapa do funil); envio de catálogo/tabela
    da biblioteca; pesquisa de satisfação pós-atendimento; lembrete/follow-up de quem não respondeu; confirmação de
    dados na ficha; opt-out. O entrevistador sugere e o implementador instala e personaliza.
  - **Precisam de integração** → **guia passo a passo** gerado para a empresa: qual sistema, que dado/ação é
    necessário, onde conseguir a chave/token (sem colar no chat — vai para Fluxos → Segredos), como montar o bloco
    “Consultar sistema”, como testar no simulador e o que publicar. Ex.: status de pedido no ERP, segunda via de
    boleto, agenda de horários, estoque, cobrança.
- **Base de dados para as automações (pedido em 28/09; decidido: sem ERP completo — conectores/APIs)** — dar ao entrevistador e ao
  implementador onde guardar os dados das áreas (ex.: financeiro — contas a pagar e a receber, pagamentos).
  Decisão do dono: em vez de um ERP completo fixo, (1) **registros personalizados por empresa** (tipos de
  registro com campos configuráveis — ex.: “Conta a receber”: valor, vencimento, status, cliente — com permissões,
  histórico e uso em fluxos/IA), que o agente implementador cria conforme o levantamento; (2) **conectores** com os
  sistemas que a empresa já usa (ERP/financeiro/banco) pelo bloco “Consultar sistema” e integrações prontas;
  (3) nativo só o que liga direto ao atendimento: **cobrança pelo WhatsApp** (link PIX/boleto por um gateway de
  pagamento, status do pagamento na ficha, lembrete de vencimento). Módulos completos (ERP) só depois, se o
  levantamento das empresas mostrar demanda.
- **“Cérebro” da operação**: agente que coordena agentes por área — administrativo, financeiro, RH, vendas,
  pós-venda, suporte e outras — com as automações de cada área (software completo para a empresa).
- **IA entender imagens, vídeos e PDFs** que o cliente envia (hoje só áudio é transcrito).

## Disparos (campanhas)
- Envio em massa para grupos de clientes, escolhendo o número (ex.: um número QR para disparos e o da Meta para
  receber clientes, como pedido). Respeita opt-out, horário e limite por minuto; modelos aprovados no número da Meta.
- Aviso: disparo por número não oficial tem risco de bloqueio — o monitor de saúde já avisa se cair.

## SaaS (venda para clientes)
- **Planos e cobrança** por organização (`org.billing`), com limites por plano (números, pessoas, IA/min).
- Opção de hospedagem própria (VPS, ex.: Hostinger), além de Supabase + Vercel.

## Números e Meta
- Cadastro de número da Meta em poucos cliques (Embedded Signup) — depois da aprovação da Meta.
- Nova conversa iniciada pelo atendente com modelo aprovado (spec números §10).

## Contatos e atendimento
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
com arquivo, arquivo no bloco Mensagem e IA enviando arquivo permitido), canal de e-mail IMAP/SMTP (caixas conectadas
pelo dono com presets e teste, e-mail vira atendimento, resposta pela mesma caixa), alertas por e-mail (Resend ou SMTP), fila de mensagens recebidas com reprocessamento (nenhuma mensagem se perde),
limite de IA por empresa, painel da plataforma (empresas, criar com modelo e convite do dono, suspender, acesso de
suporte com motivo e prazo), registros personalizados (tipos com campos configuráveis, modelos Conta a receber /
Pedido / Contrato, acesso por tipo, validação no banco, histórico) e campos personalizados do contato (ficha, fluxo
e IA com “IA pode ler” / “sensível”), agente entrevistador (tela Diagnóstico: entrevista, retrato da empresa por
seção, processos repetidos, sugestões prontas × integração com passo a passo; seções públicas alimentam a IA de
atendimento, internas nunca), provedor de IA padrão da empresa para todos os agentes (Fluxos → Chaves de IA),
agente implementador (instala as sugestões prontas e os “Modelos prontos” de Fluxos como RASCUNHO, com textos
escritos pela IA a partir do Diagnóstico; nunca publica sozinho), cobrança pelo WhatsApp com Asaas (conectar pela
tela com webhook automático, botão Cobrar na conversa com link + PIX copia e cola, status automático, aviso de
pagamento, lembretes antes/depois do vencimento, tela Cobranças), guia de integração (tela Integrações: a IA
monta o passo a passo, chave no cofre, teste real obrigatório, escolha dos campos, fluxo em rascunho; detecta
integração complexa e oferece “Pedir ajuda ao time Clubetec”, que aparece no painel da Plataforma), bloco Registro nos fluxos (criar / atualizar o último / consultar o último
registro do cliente, com saídas Deu certo × Não deu) e IA vendo os registros liberados do cliente (só “IA pode ler”),
conectores prontos com login OAuth e receitas de várias chamadas (Bling beta: último pedido pelo telefone), bloco
Conector nos fluxos, aplicativo do conector cadastrado pelo operador no painel da Plataforma.

## Visual
- Trocar logo e ícone da aba (nome “Clube” junto do logo, em cima).
