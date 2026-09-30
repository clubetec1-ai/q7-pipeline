# ClubeCRM — o que falta implementar

Lista viva. Cada item vira spec/plano em `docs/superpowers/` quando começar.
Regra de sempre: isolamento entre organizações, segredos no Vault, testes em `supabase/tests/isolation.sql`.
**LGPD e segurança em tudo (reforçado em 28/09):** nenhuma informação de uma empresa pode vazar para outra nem
para fora — dados mínimos no contexto da IA, dados sensíveis marcados, gravações/transcrições/análises com acesso por
papel, retenção definida, aviso ao cliente final quando houver gravação ou análise, e direito de exclusão/anonimização.
**Interface simples e funcional:** cada tela nova com o mínimo de cliques, visual claro (cores, etiquetas) e
sem opções escondidas que exijam suporte.

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
*MFA entregue (29/09): tela Segurança (ativar com QR code no app autenticador, desativar), código pedido depois da
senha; no banco, quem tem MFA e entrou só com senha fica sem permissões; empresa pode exigir de donos/admins (só
liga quem já tem MFA; auditado); operador da plataforma só com código. Códigos de recuperação (29/09): 10 de uso
único, só o hash guardado, gerados em Segurança (só com código digitado); “Perdi o celular” na tela do código remove
o autenticador antigo (5 erros/15 min); e-mail para a pessoa ao usar código ou desativar o MFA; auditoria.*
**Ramal SIP (29/09): central principal = Handphone (XHAND).** Perguntas enviadas ao fornecedor: SIP sobre WSS para
webphone, credenciais por ramal, webhook de eventos de chamada, API de gravações, clique-para-ligar, áudio em tempo
real para agente de voz e documentação. Nvoip fica como alternativa (API de chamadas).

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
- **Multiplataforma (29/09)**: qualquer central com SIP (Handphone primeiro, Nvoip, 3CX, Asterisk…), com um
  adaptador por central para avisos de chamada, gravações e clique-para-ligar; funciona em qualquer navegador (PC e celular).
- **Softphone embutido no cadastro do atendente, estilo MicroSIP (29/09)**: hoje o dono configura os ramais no
  MicroSIP. No ClubeCRM, cada atendente tem o seu ramal (servidor/domínio, usuário, senha no Vault, número) e escolhe o modo:
  **WebRTC** (telefone dentro do navegador, precisa da central com WSS) ou **só SIP** (continua no MicroSIP ou
  aparelho; o CRM liga pelo link `sip:`/`tel:` ou pela API da central e identifica as chamadas pelos avisos da central).
  Senha do ramal só no cofre; volta apenas para o navegador do próprio atendente, e só em WebRTC; nunca vai para outra empresa.
  *Entregue (29/09), fase 1: Plataforma → Ramais (Clubetec cadastra número, usuário, servidor, wss e senha no cofre);
  Equipe → Ramais (dono escolhe atendente e modo); telefone flutuante em todas as telas (WebRTC: ligar, atender,
  mudo, espera, teclado; MicroSIP: disca pelo link sip:, "Quem está ligando?" e registrar); identifica o cliente pelo
  número; "Enviar olá no WhatsApp" abre/continua a conversa; histórico de ligações imutável. Falta: avisos de
  chamada da central (identificação automática no MicroSIP), gravações e transcrição — dependem da Handphone.*
- **Ramal: status, explicação e instalação em lote (pedido em 29/09)** — ícone em Plataforma mostrando se o ramal
  está online/funcionando; explicar melhor como funciona; ramais já associados aos usuários na instalação; planilha
  com os ramais e os usuários, ou associação automática.
  *Entregue (29/09): status 🟢 online / 🔴 erro / ⚪ desconectado / 🔵 MicroSIP em Plataforma e em Configurar → Ramais
  (o telefone do navegador manda sinal a cada 2 min); passo a passo "Como funciona"; botão Testar (registra na central
  com a senha digitada, sem salvar); atendente escolhido já no cadastro; modelo de planilha com os e-mails da equipe +
  importação (colar do Excel ou .csv); "Associar automaticamente" (ramais livres → pessoas sem ramal); sem wss o modo
  vira MicroSIP; menu: "Ramais (telefone)" em Configurar e o chat interno renomeado para "Chat equipe".*
- **Telefonia Nvoip, fase 2 (pedido em 29/09)** — usar a API v3 da Nvoip (Postman "nvoip-api"): clique-para-ligar
  (toca o MicroSIP do atendente e depois o cliente), histórico de ligações com perdidas e "retornar", gravações.
  *Entregue (29/09): Configurar → Ramais → Integração Nvoip (Client ID e segredo OAuth no cofre, testar conexão,
  ligar/desligar); botão Ligar usa o clique-para-ligar da Nvoip (sem ela, abre o MicroSIP pelo link sip:); histórico
  puxado a cada 5 min (hoje, e ontem na 1ª hora) ligado ao cliente e ao ramal; perdida avisa o atendente no sino
  ("clique para retornar"); ligações na ficha do cliente (aba Protocolos). Pendências com a Nvoip: endereço WSS
  (WebRTC), aviso em tempo real (webhook) para identificar na hora que toca, e formato/URL das gravações para
  transcrever. Os nomes dos campos do histórico são confirmados no "Testar conexão" com a credencial real.*
- **Identifica o número** que ligou e abre/associa o contato e a conversa (mesmo atendimento, protocolo).
- **Transcrição da ligação** em tempo real ou ao final, gravada no histórico do atendimento.
- **Confirmação do número**: o atendente pede para o cliente repetir/confirmar o número de WhatsApp e, ainda durante
  a ligação, o CRM envia um “olá” pelo WhatsApp para continuar o atendimento por lá.
- **Agentes de voz (pedido em 28/09)**: agente de IA que atende a ligação e faz a triagem (entende o motivo,
  encaminha ao setor certo, resolve o simples), ou só uma automação sem IA (menu/URA), para custar menos.
- **Fluxos dentro da ligação**: o mesmo editor de fluxos vale para voz — menu por tecla ou fala, horário, fila,
  transferir para setor/pessoa, recado, consultar sistema, mandar WhatsApp durante a ligação.
- **Gravações e transcrições** com melhoria de texto (pontuação, quem falou), no histórico do atendimento.
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
  *Entregue (29/09): etapas clicáveis na tela Diagnóstico (empresa → cultura → hoje → objetivos → setores →
  processos por setor com passo a passo → planejamento); busca de dados públicos por site e CNPJ (sem sócios);
  planejamento com diagnóstico, missão/visão/valores (proposta quando faltar), objetivos, melhorias, automações sem
  IA primeiro, plano de ação e custo mensal estimado (Groq × Claude Haiku/Sonnet); automações do plano instaláveis
  em rascunho. Falta: escolha automática Haiku/Sonnet por tarefa (o provedor Anthropic já existe em Chaves de IA),
  Google Meu Negócio/redes sociais, convidar responsável de setor para responder, exportar o planejamento (PDF).*
- **Identidade da marca / manual da marca no Diagnóstico (pedido em 30/09)** — depois da empresa, uma etapa com os
  dados da marca: cores, tom de voz, logos e tudo ligado à marca, para o marketing e os agentes usarem depois.
  *Entregue (30/09): etapa "Marca" (depois de Empresa) com kit da marca — cores (nome + código, copiar), fontes,
  logos e manual em PDF (pasta privada, só dono/admin e quem cuida de campanhas) — e o tom de voz/identidade visual
  em texto (escrever/falar + IA organiza + aprovar). Os agentes de IA (atendimento, fluxos, implementador) seguem o
  tom de voz aprovado; Campanhas mostra o kit e tem "Escrever com a voz da marca" (duas opções, usar e revisar).*
- **Setores: priorizar, lembrar e sugerir (pedido em 30/09)** — depois de mapear os processos, o dono marca quais
  quer implementar agora e quais ficam para depois, com **lembretes** para ir fazendo; segmentar a implementação por
  etapas/setores; a IA sugere **qual setor implementar primeiro** (o que traz mais resultado, pelas respostas do
  diagnóstico); **setores padrão sugeridos** (Vendas, Financeiro, Administrativo, Atendimento, Marketing, RH,
  Operação…) já prontos como exemplo, que o dono edita — como as etiquetas padrão.
  *Entregue (30/09): no passo Setores, "Setores que quase toda empresa tem" (Vendas, Atendimento, Financeiro,
  Administrativo, Marketing, Operação, Logística, Compras, RH) preenche a caixa como exemplo para editar; depois de
  aprovado, "Plano de implementação por setor" com Agora / Depois (data de lembrete) / Não em cada processo;
  lembrete diário às 9h no sino do dono/admin (uma vez por data); "Por onde começar? (IA)" ordena os setores pelo
  resultado esperado, com motivo, ganho e por quais processos começar. A escolha se mantém ao refazer um setor.*
- **Diagnóstico 3.0 — revisão da entrevista como especialista (pedido em 30/09)** — conferir o que falta e a melhor
  sequência para ficar fácil para o cliente e para implantar os agentes. Proposta:
  - **Faltam:** (1) **Clientes e jornada** — quem compra, como chega, o que pergunta antes de comprar, objeções,
    etapas até fechar (vira qualificação do lead e as etapas do Kanban); (2) **Regras do atendimento e limites da
    IA** — o que a IA pode e não pode dizer/fazer, quando passar para uma pessoa, horários, prazos, dados sensíveis
    (vira as regras do agente, com segurança); (3) **Números de partida** — tempo de resposta, volume e conversão
    de hoje (base para medir a melhoria contínua); (4) **Sistemas e dados** em etapa própria — onde fica estoque,
    pedido, agenda, se tem API (vira guia de integração); (5) **Pós-venda** — follow-up, pesquisa, cobrança,
    recompra; (6) **Testar o agente** antes de publicar (conversa simulada) e **publicar e medir** (30 dias).
  - **Sequência sugerida em 4 blocos:** Conhecer (Empresa → Clientes e jornada → Produtos, preços e políticas;
    ao final já dá para testar um agente de atendimento — valor rápido) · Identidade (Marca; Cultura opcional) ·
    Como funciona hoje (Números de partida → Objetivos → Setores e equipe → Processos do setor prioritário →
    Sistemas e dados) · Agentes (Regras e limites → Plano → Implantação por setor → Testar → Publicar e medir).
  - **Mais fácil para o cliente:** cada etapa em até ~5 minutos com 3 a 5 perguntas e exemplo, botão "não sei /
    pular", tempo estimado por etapa, modelos por nicho que já vêm preenchidos, perguntas de complemento só do que
    faltou, e convite para o responsável de cada setor responder a parte dele.

- *Pendência técnica (30/09):* o caso 55 dos testes de isolamento (etiquetas por setor) falhou uma vez e passou na
  execução seguinte sem mudança — investigar a intermitência (provável condição dependente de hora/dados).
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
- **Base de conhecimento da empresa (pedido em 29/09)** — o dono (ou o responsável do setor) anexa os modelos e
  documentos que a empresa já usa: contratos, orçamentos, planilhas, tabelas de preço, manuais, scripts de venda,
  políticas, checklists — organizados por **área/setor**. Esses documentos passam a formar a base de conhecimento:
  - o sistema lê o conteúdo (PDF, Word, Excel/CSV, texto; imagem pela IA com visão) e guarda o texto por trechos;
  - os **agentes** (IA de atendimento, agentes dos fluxos, entrevistador, implementador e “Ajustar com IA” das
    melhorias) consultam só os trechos relevantes de cada pergunta, para responder com mais precisão e seguindo o
    jeito da empresa; cada agente/bloco escolhe quais setores da base pode usar;
  - o diagnóstico usa a base para entender como a empresa funciona (e sugerir melhorias com base nos documentos);
  - documentos modelo (ex.: contrato, orçamento) podem ser preenchidos pela IA com os dados do cliente e enviados
    pelo atendente, sempre revisados antes de sair.
  Cuidados (LGPD/segurança): por organização e por setor, com permissão de quem vê e de quem anexa; marcar
  documento como **interno** (nunca vai para cliente, só orienta o agente) ou **pode ser enviado**; dados pessoais
  e segredos (senhas, dados bancários) não entram no contexto da IA; versão e data de cada documento (o agente usa a
  versão atual); apagar o documento remove o texto da base. Relação com o que já existe: Biblioteca (arquivos para
  enviar ao cliente) e leitura de PDF/imagem da IA.
  *Entregue (29/09): tela Base de conhecimento (Configurar): anexar PDF, Word, Excel, CSV ou texto por setor, com
  tipo e uso (interno | atendimento | pode ser enviado); texto lido e dividido em trechos; linhas com senha/token e
  números de cartão removidos; busca em português sem custo de IA; IA de atendimento e agentes dos fluxos usam só
  atendimento/enviável do setor do atendimento + empresa toda; planejamento e “Ajustar com IA” usam tudo; testar
  pergunta na tela. Falta: preencher modelos (contrato/orçamento) com dados do cliente, enviar documento “enviável”
  pelo atendimento, PDF digitalizado (OCR) e escolher setores da base por bloco de IA.*
- **IA entender imagens, vídeos e PDFs** que o cliente envia (hoje só áudio é transcrito).
  *Entregue (29/09): imagens descritas por modelo com visão do provedor padrão (Groq Llama 4, OpenAI, Gemini, Claude;
  comprovante → valor, data, pagador, recebedor, banco) e PDFs com texto extraído (sem IA); resultado em
  messages.media_text, entra no histórico da IA de atendimento e do agente dos fluxos, aparece como “Lido pela IA”;
  liga/desliga em Fluxos → Chaves de IA; anonimização LGPD apaga. Falta: vídeo, PDF digitalizado (OCR), anexos de
  e-mail.*

## Equipe e organização (pedidos em 29/09)
- **Gerenciar etiquetas e grupos de clientes** — tela para o dono/admin (e quem tem permissão de grupos) **renomear,
  excluir, trocar cor e escolher ícone** de cada etiqueta e grupo, ver quantos clientes há em cada um e juntar
  duplicados. Excluir pede confirmação e só tira a marcação (o cliente continua); grupo sensível continua escondido
  de quem não pode ver. Ícone aparece junto da cor na lista, na ficha, na fila e nas campanhas.
  *Entregue (29/09): tela Clientes → Etiquetas e grupos (renomear, cor, 18 ícones, contagem, juntar duplicados sem
  misturar sensível com comum, excluir auditado); ícone aparece na fila, na ficha, em Clientes e em Campanhas.*
- **Etiquetas e grupos visíveis em Conversas (pedido em 29/09)** — as etiquetas e os grupos definidos no cliente
  aparecem na conversa (lista e topo do atendimento), com cor e ícone, para o atendente ver ao retomar o atendimento
  o que é preciso para aquele cliente. Dá para pôr **mais de uma etiqueta** e escolher **a quais grupos** o cliente
  pertence ali mesmo, sem sair da conversa.
  *Entregue (29/09): barra no topo do atendimento com grupos e etiquetas (cor e ícone) e botão para marcar várias
  etiquetas e escolher os grupos; a lista de conversas mostra setor, grupos e etiquetas. Grupos só por supervisor,
  admin ou dono (grupo sensível continua escondido de quem não pode ver).*
- **Etiquetas padrão e etiquetas por setor (pedido em 29/09)** — o sistema já vem com etiquetas padrão (ponto de
  partida que mostra como etiqueta funciona); o dono/admin edita, cria outras e associa cada etiqueta a **um ou mais
  setores**. Atendente só vê e usa as gerais e as dos setores a que pertence. As etiquetas aparecem na tela do
  atendimento, na cor configurada, sinalizando o cliente que está sendo atendido.
  *Entregue (29/09): 9 etiquetas padrão (VIP, Novo cliente, Retornar contato, Urgente, Reclamação, Orçamento enviado,
  Aguardando pagamento, Pedido em andamento, Suporte — trocada de "Não incomodar" a pedido) em toda empresa nova e nas atuais, botão "Padrão" recria
  as que faltarem; setores por etiqueta em Etiquetas e grupos (nenhum = todos); regra no banco (RLS): atendente não vê
  nem marca etiqueta de outro setor; barra do atendimento com as etiquetas em destaque na cor configurada.*
- **Chat interno da equipe** — conversa entre as pessoas da empresa dentro do ClubeCRM, separada das conversas com
  clientes: canais por setor e mensagens diretas, menção com @, anexos, aviso no sino, e “compartilhar
  atendimento” (link para a conversa do cliente sem expor dados a quem não pode ver). Isolado por empresa (RLS),
  histórico guardado como o resto (não se apaga pela tela; LGPD: anonimização do funcionário quando sair).
  *Entregue (29/09): menu Equipe (chat) com canal Geral (universal), um canal por setor e conversas diretas;
  @menção com aviso no sino, anexos em armazenamento privado, compartilhar atendimento, não lidas e tempo real;
  mensagens não se editam nem se apagam; direta é privada até para o dono. Falta: busca no chat, reações e
  canais extras criados pelo dono.*

## Relatórios (pedido em 29/09)
Aba **Relatórios** com vários tipos, para dar clareza a quem decide e alimentar o ciclo de melhoria. Cada pessoa
vê só o que o papel permite (atendente: os próprios; supervisor: o setor; dono/admin: tudo). Filtros por
período, setor, atendente, canal e número; comparação com o período anterior; exportar (CSV/PDF, com auditoria).
- **Atendente:** atendimentos, tempo de 1ª resposta e de atendimento, finalizados por motivo, nota e satisfação
  das avaliações, feedbacks recebidos, evolução no tempo.
- **Supervisor/operação:** filas e espera por setor, transbordo entre setores, horários de pico, SLA estourado,
  presença e pausas da equipe, transferências.
- **Qualidade do atendimento:** satisfação, notas, motivos de insatisfação, falhas de processo mais frequentes,
  comparação entre setores e atendentes.
- **Feedback e melhorias:** melhorias sugeridas/aprovadas/no ar, resultado de cada uma (antes × depois),
  correções geradas, tempo até aprovar.
- **Comercial:** funil (Kanban) e conversão por etapa, origem dos contatos, campanhas (enviadas, respostas,
  opt-out), cobranças (emitidas, pagas, atraso, recebido no mês).
- **IA e automação:** conversas resolvidas pela IA × passadas para humano, uso e custo estimado da IA, fluxos
  (execuções, onde param), leitura de mídia, base de conhecimento mais consultada.

*Entregue (29/09): aba Relatórios (Gestão) com Atendentes, Qualidade, Operação, Melhorias, Comercial e IA;
escopo pelo papel no banco; período 7/30/90 dias e setor; comparação com o período anterior; gráficos por hora e dia;
exportar CSV com auditoria. Falta: PDF, período personalizado, envio automático por e-mail (semanal/mensal).*

## Repaginação do layout e cliente guiado (pedido em 30/09 — antes dos módulos)
- **Reorganizar o menu:** tudo que é configuração/instalação num lugar só (hoje WhatsApp, ramais, equipe, etiquetas
  e outros itens de instalação estão espalhados em menus diferentes). Dia a dia separado de configuração.
- **Definir onde ficam setores e processos:** depois do mapeamento no Diagnóstico, os setores viram setores de
  verdade no sistema e ganham uma página própria com seus processos (e o plano agora/depois).
- **Mais visual e mais bonito:** cores (etiquetas, clientes, setores) consistentes, painel com estética melhor.
- **Cliente guiado passo a passo** nos primeiros usos (primeiros passos com progresso), para depois trabalhar de
  forma intuitiva.
- Proposta (30/09): Fase 1 — estrutura: moldura única das telas, menu novo (Dia a dia · Clientes · Gestão · Minha
  empresa · Configurações), central de Configurações em cartões com situação (configurado/pendente), página
  "Setores e processos" alimentada pelo Diagnóstico, tela Início com "Primeiros passos". Fase 2 — visual: painel
  Início com indicadores e gráficos, cartões e cores consistentes, cor da marca da empresa no tema.
  *Fase 1 entregue (30/09): cabeçalho único nas telas (com o sino em todas); menu novo — topo Início · Conversas ·
  Kanban · Chat equipe; grupos Clientes · Gestão · Minha empresa (Diagnóstico, Marca, Setores e processos, Equipe e
  permissões) · Configurações · Conta; central de Configurações em cartões (Canais, Atendimento, IA e automação,
  Integrações e conta) com situação configurado/pendente/opcional e barra de progresso; tela Início com "Primeiros
  passos" (8 passos em ordem, o próximo em destaque, cada um abre a tela certa); página Setores e processos (cartão por
  setor com cor, pessoas e processos; "Criar no sistema" para os setores mapeados no Diagnóstico; plano de
  implementação). Endereços antigos continuam funcionando.*
  *Fase 2 entregue (30/09): painel "Resultados" no Início (7 ou 30 dias, comparando com o período anterior) —
  atendimentos, finalizados, resolvidos pela IA (%), 1ª resposta e espera na fila com setas verde/vermelha,
  atendimentos por hora, IA × pessoas e barras por setor na cor de cada setor; o escopo segue a regra do banco
  (empresa, setor ou só os seus). Cor da marca no tema: no kit da marca, "usar a primeira cor como cor principal"
  muda botões e destaques de todas as telas da empresa (só a cor é lida por quem é da empresa). Menu: "Chat equipe"
  virou "Chat".*
  *Ajuste (30/09): a configuração da API de Cobranças (chave do Asaas, ambiente e regras) saiu da tela Cobranças e
  foi para Configurações → Cobranças (Asaas), com cartão na central; em Cobranças fica só o dia a dia (gerar cobrança
  e lista) e um atalho para configurar.*
  *Ajuste (30/09): "Uazapi global" saiu do menu Conta e virou cartão na central de Configurações, visível só para a
  equipe Clubetec (operador; a tela e o banco continuam bloqueando os demais), com o cabeçalho padrão.*
- **Software autogerenciável (princípio, 30/09):** quanto menos depender de pessoas para **vender, implantar,
  acompanhar e dar suporte**, melhor. Agentes de IA, chatbot, passos guiados, checagens e alertas automáticos resolvem
  de forma simples, com menos ocorrências. Próximos passos nessa linha: assistente dentro do app ("como faço…?") que
  responde e leva à tela certa; autodiagnóstico de problemas com botão de correção (número desconectado, chave de IA
  inválida, fluxo parado); lembretes e dicas automáticas no Início; venda e implantação autoatendidas (cadastro →
  diagnóstico → plano → configuração guiada), deixando a equipe só para o que for complexo.

## Comercialização: módulos, planos e visão de CEO (pedido em 30/09)
- **Habilitação por módulos** — cada empresa contrata o que precisa; exemplo do pedido: Diagnóstico, WhatsApp,
  Agentes de automação… Sugestão registrada: **base "Atendimento"** (Conversas, Kanban, contatos/etiquetas, equipe,
  chat interno, 1 número WhatsApp, relatórios básicos) + módulos: **Diagnóstico e Plano**, **Agentes de IA e
  Automação** (fluxos, IA, base de conhecimento, follow-up), **Canais extras** (mais números, Meta oficial, e-mail),
  **Telefonia** (ramal, clique-para-ligar, histórico), **Campanhas e Marca**, **Cobranças**, **Qualidade e Gestão**
  (avaliações, supervisor, relatórios avançados, melhoria contínua). Três pacotes prontos (Essencial, Profissional,
  Completo) + módulos avulsos; uso variável (IA, disparos, minutos) cobrado por pacote com margem e alerta de limite;
  taxa de implantação com a Clubetec (diagnóstico + configuração).
- **Base técnica para vender:** módulos ligados por empresa (tabela por organização, liga/desliga em Plataforma),
  menu e telas escondem o que não foi contratado e o **servidor recusa** módulo desligado (não só a tela); depois,
  assinatura recorrente (Asaas), período de teste e limites por plano.
- **Visão de CEO (prioridades sugeridas):** 1) módulos + assinatura (sem isso não dá para vender); 2) entrada
  autoatendida: cadastro → diagnóstico → implantação guiada, valor no primeiro dia; 3) painel "o que o ClubeCRM fez
  por você" (tempo de resposta, conversas resolvidas pela IA, vendas/cobranças recuperadas) para reter e vender mais;
  4) varredura de segurança + termos de uso/LGPD (contrato de tratamento de dados) antes do 1º cliente pagante;
  5) começar por 1 ou 2 nichos com modelos prontos (diagnóstico, fluxos, etiquetas e setores por nicho) e canal de
  **revenda/white label** para agências. Segurar novos canais (Instagram) e WebRTC até clientes pedirem ou a
  central liberar.

## Segurança antes da produção (pedido em 30/09)
Objetivo: o sistema sempre **blindado** — nenhum dado vaza (entre empresas ou para fora) e resiste a ataques,
invasão, abuso e tentativas de burlar ou derrubar.
- **Durante o desenvolvimento:** manter a rotina de cada entrega (testes de isolamento entre empresas, RLS, segredos
  só no cofre, checagem de permissão no servidor, validação de entrada), sem plugins que rodam IA a cada edição.
- **Antes de aprovar o projeto para produção:** varredura completa de segurança do código inteiro com a skill
  `security-review` ou o plugin **claude-security** (Anthropic, sob demanda), corrigindo tudo antes de abrir para
  clientes. Incluir na revisão: autenticação/MFA, RLS de todas as tabelas e buckets, Edge Functions (quem chama,
  segredo de cron, webhooks), SSRF/injeção/XSS, limites de uso (rate limit) contra abuso e força bruta, cabeçalhos
  de segurança do site (CSP), dependências vulneráveis, alertas do Supabase (advisors), backups e plano de resposta a
  incidente (LGPD).

## Disparos (campanhas)
- Envio em massa para grupos de clientes, escolhendo o número (ex.: um número QR para disparos e o da Meta para
  receber clientes, como pedido). Respeita opt-out, horário e limite por minuto; modelos aprovados no número da Meta.
- Aviso: disparo por número não oficial tem risco de bloqueio — o monitor de saúde já avisa se cair.
- *Entregue (29/09): tela Campanhas (dono/admin, permissão `campaigns.manage`): rascunho com número, grupos de
  clientes, mensagem com {nome} (QR) ou modelo aprovado + idioma (Meta), velocidade (1–60/min), horário e
  agendamento; prévia de quantos recebem; lista congelada no banco ao iniciar (opt-out e anonimizados ficam de
  fora, conferido de novo na hora do envio); envio pelo cron com pausa entre mensagens; pausar/retomar/cancelar;
  mensagem registrada na conversa (resposta cai no atendimento); auditoria. Falta: mídia/arquivo da biblioteca na
  campanha, lista de modelos da Meta puxada da conta, relatório de respostas por campanha, teste A/B.*

## SaaS (venda para clientes)
- **Planos e cobrança** por organização (`org.billing`), com limites por plano (números, pessoas, IA/min).
- Opção de hospedagem própria (VPS, ex.: Hostinger), além de Supabase + Vercel.

## Números e Meta
- Cadastro de número da Meta em poucos cliques (Embedded Signup) — depois da aprovação da Meta.
- Nova conversa iniciada pelo atendente com modelo aprovado (spec números §10).

## Contatos e atendimento
- **Avaliação automática do atendimento em todos os canais (pedido em 28/09)** — no lugar da pesquisa de
  satisfação (que continua opcional), ao finalizar o atendimento a IA lê o histórico (conversa, e-mail, transcrição
  da ligação, tempos de espera e resposta, transferências) e:
  - conclui se o cliente saiu **satisfeito ou não** e gera uma **nota para o atendente** (com o motivo);
  - gera **feedback de melhoria para o atendente** (o que fez bem, o que melhorar);
  - aponta **falhas de processo** (ex.: demora por falta de informação, transferência errada, política confusa) e
    sugere a melhoria;
  - o **supervisor** gera um relatório com as melhorias acumuladas e **como implementá-las** (ligado ao
    planejamento do entrevistador 2.0 e ao implementador) — a empresa evoluindo sempre.
  - Cuidados: nota visível só ao próprio atendente e à supervisão; o atendente pode ver o motivo; modelo barato
    (Haiku) e só em atendimentos finalizados; nada de dado sensível no relatório.
  *Entregue (29/09): tela Avaliações (menu), liga/desliga por empresa (padrão desligado; avisar a equipe),
  avaliação ao finalizar atendimento com pessoa (satisfeito/nota/motivo/feedback/falhas de processo) pela IA da
  empresa (Groq 70b por enquanto; Claude Haiku quando entrar o provedor), e-mail/telefone/documento mascarados
  antes da IA, só a análise é guardada. Supervisão: resumo por atendente e “Relatório de melhorias (30 dias)”
  com como implementar. Falta: avaliação de ligações (com a voz), exportar o relatório e ligar ao plano de ação
  do entrevistador 2.0.*
- **Outros setores ajudando no atendimento (pedido em 28/09)** — quando o setor não tem ninguém disponível ou
  todos estão ocupados, o atendimento pode ser visto e assumido por outro setor (regra de transbordo por setor:
  quais setores ajudam, depois de quanto tempo de espera), e setores podem interagir na conversa (nota interna,
  pedir ajuda, convidar) — o atendimento ao cliente sempre em primeiro lugar. Respeita permissões e visibilidade.
  *Entregue (29/09): em Equipe → Departamentos, “Se a fila esperar mais de N min, pedir ajuda de: [setores]”.
  Fila parada → setores ajudantes veem e assumem só atendimentos sem responsável (fica no setor de origem);
  distribuição automática passa para ajudante livre; aviso “🤝 pedindo ajuda” na lista; evento na auditoria.
  Falta: convidar outro setor para uma conversa já atribuída (ajuda sem transferir) e aviso no sino para ajudantes.*
- **Protocolo em todo atendimento, em todos os canais (pedido em 28/09)** — WhatsApp, e-mail e voz geram o
  protocolo logo no início (hoje já existe no atendimento; estender a e-mail e voz de forma uniforme). Na voz, o
  atendente informa o protocolo ou a própria IA/URA fala o número; nos outros canais vai na mensagem. O protocolo
  fica **anexado ao cliente** (ficha → histórico de protocolos de todos os canais) para buscas futuras.
  *Entregue para WhatsApp e e-mail (protocolo + histórico na ficha); voz entra junto com o ramal.*
- **Busca de conversas** — por protocolo, cliente, telefone/e-mail, texto da mensagem/transcrição, canal, setor,
  atendente e período, respeitando o que cada papel pode ver.
  *Entregue: nome, telefone, e-mail, protocolo e texto das mensagens. Falta: filtros de canal, setor, atendente e
  período; transcrição entra com a voz.*
- **Conversas não podem ser apagadas (segurança)** — nenhum usuário apaga mensagem ou atendimento; se o cliente
  apagar do lado dele (WhatsApp “mensagem apagada”, e-mail excluído), o registro continua guardado e marcado
  “apagada pelo cliente”. Remoção só pelo fluxo formal de LGPD (anonimização pedida pelo titular, feita por
  dono/admin, com auditoria e prazo legal de guarda respeitado).
  *Entregue (29/09): ninguém apaga/edita pelo navegador (permissão + gatilho no banco); remover número, caixa de
  e-mail ou usuário mantém as conversas; WhatsApp QR marca “apagada pelo cliente/no celular” (formato a confirmar
  com teste real). Falta: e-mail excluído na caixa, WhatsApp oficial (Meta) e o fluxo formal de anonimização.*
- **Exportação bloqueada e com alerta (segurança/LGPD)** — só papéis com permissão própria (ex.: `contacts.export`)
  exportam dados de clientes, carteira ou dados sensíveis; atendente sem essa permissão não exporta nem em massa
  (lista, CSV, cópia em lote, API). **Toda tentativa sem permissão gera alerta** para dono/admin (sino + e-mail) e
  registro na auditoria; exportações permitidas também ficam registradas (quem, quando, quantos). Limite de volume
  e marca d’água/identificação de quem exportou.
  *Entregue (29/09): permissão `contacts.export` (dono/admin), botão “Exportar contatos” no Painel do supervisor
  (CSV sem campos personalizados), auditoria de cada exportação, tentativa negada → auditoria + alerta no sino e
  por e-mail (1 por pessoa a cada 10 min). Falta: limite de volume, marca d’água, exportar outras telas. Limite
  conhecido: leitura em massa pela API com a própria senha não gera alerta (só o que a pessoa já vê).*
- **Lista de clientes com acesso à ficha (pedido em 29/09)** — no menu Clientes, o atendente vê os clientes que
  pode atender, busca por nome/telefone/e-mail e abre a ficha (dados, grupos, registros, notas) ou a conversa.
  *Entregue (29/09): tela Clientes e fichas.*
- **Cores por setor e por categoria de cliente (pedido em 28/09)** — cada departamento com uma cor (na fila, na
  conversa, no Kanban, nos filtros) e cada categoria/grupo de cliente com cor/etiqueta na lista e na ficha, para
  identificar de relance.
  *Entregue (29/09): cor por departamento (Equipe → Departamentos, escolha na paleta; novo já nasce com cor),
  etiquetas e grupos de clientes com cor automática (clique na bolinha troca). Setor e grupos aparecem na lista de
  conversas, no topo da conversa e no card do Kanban. Falta: filtro por setor/grupo e cor nos relatórios.*
- Botão de anonimizar contato (LGPD) — limpa também `flow_runs.vars` e `tickets.rating_comment`.
  *Entregue (29/09): ficha do cliente → “Excluir dados pessoais deste cliente (LGPD)”, só dono/admin, com motivo e
  confirmação digitada. Remove nome, telefone, e-mail, documento, anotações, campos personalizados, texto e arquivos
  das conversas (apagados do armazenamento), notas internas, comentário da pesquisa, variáveis de fluxo, fila bruta
  de entrada, listas de campanha, etiquetas e grupos; mantém protocolos e números dos relatórios; cobranças e
  registros ficam (obrigação legal). Auditado. Falta: pedido do titular pelo próprio WhatsApp (fluxo) e prazo de
  retenção automático por empresa.*
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
- **Menu mais enxuto (pedido em 28/09)** — hoje o menu de cima tem botões demais. Atendente/operador vê só o
  essencial; para quem gerencia, agrupar em submenus (ou duas linhas), escolhendo o que fica mais limpo.
- **Diagnóstico em páginas, passo a passo (pedido em 28/09)** — no lugar do chat: uma etapa por página (empresa,
  cultura, hoje, objetivos, setores, processos de cada setor, planejamento), com área grande para o dono escrever;
  a IA entende e organiza o texto; o dono revisa e aprova cada etapa antes de seguir (nada é gerado de uma vez) e
  pode voltar a qualquer página. Nos processos, “como funciona hoje” e “como deveria funcionar”. Depois de aprovar,
  gera as melhorias e o plano de ação. Botão “Recomeçar diagnóstico” (com desfazer) para quando a empresa mudar o
  jeito de trabalhar ou os dados estiverem incompletos.
  **Falar e anexar no diagnóstico (pedido em 29/09):** em cada etapa e em cada setor, o dono pode clicar no
  microfone e falar (vira texto para revisar) e anexar documentos (contratos, planilhas, manuais, processos), que
  entram na base de conhecimento do setor como internos e são lidos ao organizar a etapa.
  **Editar só uma etapa (pedido em 28/09):** além de recomeçar tudo, reabrir e reaprovar só a etapa/setor que mudou
  (ex.: financeiro adotou outra prática) ou refazer só ela; ao reaprovar, o retrato muda na hora, a IA de atendimento
  e os agentes passam a usar a nova forma e o planejamento fica marcado como desatualizado.
  **Depois:** ligar o relatório de melhorias das Avaliações ao diagnóstico — “levar esta melhoria para o diagnóstico”
  atualiza a etapa/setor com “como vai ser a partir de agora”, e os agentes se adequam à nova metodologia.
- **Ciclo de melhoria contínua (visão do produto, pedido em 28/09 — grande diferencial)** — o sistema funciona como um
  ciclo sempre ligado: **diagnóstico → implementação → teste → feedback → ajuste do diagnóstico → nova implementação**.
  1. Depois do levantamento, cada melhoria identificada (pelas avaliações dos atendimentos, pelos números do
     supervisor, pelas falhas de processo) já vem **com a implementação pronta** — fluxo, agente de IA, automação,
     resposta rápida, registro ou ajuste de etapa do diagnóstico — em rascunho.
  2. O dono **aceita e aprova** (nada entra no ar sozinho) e coloca para rodar.
  3. O sistema **monitora se funcionou**: compara indicadores antes × depois (satisfação, nota, tempo de fila e de
     resposta, conversões, retrabalho) e mostra o resultado de cada melhoria.
  4. Se não funcionou ou a empresa mudou, o feedback volta para o diagnóstico da etapa/setor, que é atualizado, e o
     ciclo recomeça; os agentes passam a seguir a nova forma de trabalhar.
  5. **Monitorar e avaliar as próprias implementações (pedido em 28/09):** cada fluxo, agente ou automação que o
     sistema sugeriu e o dono colocou no ar também é avaliado (usado? resolveu? caiu em humano? gerou reclamação?
     custou quanto?). Se não está funcionando bem, o sistema, junto com o **implementador**, prepara a **correção**
     (nova versão em rascunho) e explica o porquê; o dono **ou o responsável do setor** aprova antes de ir ao ar.
     Assim o sistema busca melhorias, implementa, corrige quando precisa e implementa de novo — sempre esperando
     aprovação. Aprovação delegável: o dono define quem aprova por setor.
  Peças que já existem: diagnóstico em etapas, planejamento, implementador (rascunhos), avaliação automática e
  relatório de melhorias, painel do supervisor.
  *Entregue (29/09): tela Melhorias (Gestão) com colunas Para aprovar → Aprovadas → No ar (medindo) → Resultados;
  origens: planejamento do diagnóstico (automático ao gerar), avaliações (“Buscar melhorias nas avaliações”, IA
  agrupa as falhas), correção do monitor e manual; aprova o dono/admin ou o supervisor do setor; “Aprovar e
  instalar” usa o implementador (rascunho ligado à melhoria); fluxo precisa estar publicado para ir ao ar; métricas
  antes × depois (atendimentos, fila, 1ª resposta, satisfação, nota, execuções do fluxo); monitor diário dá o
  resultado e, se não funcionou, cria a correção v2 e avisa no sino; “Ajustar com IA” reescreve o passo a passo com
  os números e as avaliações. Falta: levar o resultado de volta à etapa do diagnóstico com um clique, escolher
  aprovador por setor além do supervisor, e métricas próprias por tipo (ex.: taxa de pagamento de cobranças).* Falta: “melhoria” como item com estado (sugerida → aprovada → no ar →
  medindo → resultado), métricas antes/depois por melhoria e o retorno automático para o diagnóstico.
