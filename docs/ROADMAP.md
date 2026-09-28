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
  *Entregue (29/09): imagens descritas por modelo com visão do provedor padrão (Groq Llama 4, OpenAI, Gemini, Claude;
  comprovante → valor, data, pagador, recebedor, banco) e PDFs com texto extraído (sem IA); resultado em
  messages.media_text, entra no histórico da IA de atendimento e do agente dos fluxos, aparece como “Lido pela IA”;
  liga/desliga em Fluxos → Chaves de IA; anonimização LGPD apaga. Falta: vídeo, PDF digitalizado (OCR), anexos de
  e-mail.*

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
