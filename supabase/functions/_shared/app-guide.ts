/**
 * Mapa do sistema para o assistente "Como faço…?": telas, onde ficam e como se faz.
 * Atualize quando uma tela mudar de lugar (é o que o assistente ensina ao cliente).
 */
export const APP_GUIDE = `
MENU DE CIMA: Início · Conversas · Funil · Clientes (Clientes, Registros, Cobranças, Campanhas) · Resultados (Cérebro, Agora, Relatórios, Funil de vendas, Avaliações, Melhorias) · Configurações. No canto direito: Equipe (chat interno), ajuda "?", sino de avisos e o ícone da pessoa (Segurança, tema, Sair). No celular, tudo fica no botão ☰.

TELAS (nome | caminho | para que serve):
- Início | /inicio | Primeiros passos em ordem (WhatsApp → empresa → horário → IA → equipe; o resto em "Para depois"), saúde do sistema, cartão do cérebro e resultados da empresa.
- Conversas | / | Atender clientes de WhatsApp e e-mail. Botões Assumir e Finalizar; no "Mais": Transferir, Devolver à IA, Enviar protocolo e "Gerar proposta (rascunho)". Etiquetas, grupos, cobrar, ligar.
- Funil | /kanban | Quadro com as etapas da venda: arrastar o card ou usar "⋯ → Mover para…" (dá para desfazer). "Editar etapas" (dono): renomear, apagar, nova etapa e o relógio de "Retorno automático" (dias sem resposta, orientação e modelo da Meta).
- Equipe (chat) | /chat | Conversa interna da equipe (canal geral, por setor e direto).
- Clientes | /clientes | Tabela de clientes: clique na linha para abrir a ficha (dados, grupos, registros, protocolos, excluir dados LGPD).
- Registros | /registros | Cadastros próprios da empresa (pedidos, contas a receber, contratos) com modelos prontos.
- Cobranças | /cobrancas | Gerar cobrança PIX/boleto e acompanhar pagamentos (configurar o Asaas em Configurações → Cobranças).
- Campanhas | /campanhas | Envio em massa para grupos de clientes, com horário e velocidade.
- Cérebro | /cerebro | Visão de CEO por área: números da semana × anterior, metas com semáforo, pendências (Cobrar, prazo), resumo da semana da IA com prioridades, "Analisar agora" (dono) e "O que a área fez". O responsável de área vê só as suas áreas.
- Agora — equipe e fila | /supervisor | Fila em tempo real, quem está online, exportar contatos.
- Relatórios | /relatorios | Atendentes, qualidade, operação, melhorias, comercial e IA; exportar CSV.
- Funil de vendas | /funil | Instalar o funil pronto (etapas, etiquetas quente/morno/frio, fluxo de qualificação, retornos de 2, 5 e 10 dias em "Proposta enviada"), contatos por etapa e por origem, link de captação do WhatsApp.
- Avaliações | /avaliacoes | Avaliação automática dos atendimentos pela IA (ligar/desligar).
- Melhorias | /melhorias | Sugestões (do plano, das avaliações e do cérebro) → aprovar → instalar → no ar → resultado. Dono escolhe a área e o processo do Diagnóstico de cada sugestão; filtro por área.
- Diagnóstico | /diagnostico | Entrevista da empresa por etapas (escrever, falar ou "Entrevista por voz"); gera o planejamento e as automações. O processo mostra "Implantado em… · funcionou".
- Setores e processos | /setores | Setores da empresa, processos e plano de implementação (agora/depois).
- Equipe e permissões | /equipe | Convidar pessoas, papéis, departamentos (distribuição automática, atendente preferencial, ajuda entre setores), mensagens automáticas, ramais.
- Configurações | /configuracoes | Central em 6 grupos: onde seus clientes falam; sua empresa; assistente de IA; equipe (inclui Áreas e responsáveis); vendas e cobrança.
- Áreas e responsáveis | /configuracoes/areas | Áreas de gestão (Vendas, Financeiro…), quem aprova as sugestões de cada uma, substituto, "Agente sugere" e ligar/desligar. "Sugerir áreas pelos setores".
- Logo e cores | /configuracoes/aparencia | Logo da empresa no topo das telas e cores principal e secundária, com prévia.
- WhatsApp e e-mail | /numeros | Conectar número por QR ou pela Meta, caixas de e-mail, saúde de cada número.
- Horário de atendimento | /configuracoes/atendimento | Horário de atendimento e palavras para parar mensagens automáticas.
- Chave de IA própria | /configuracoes/ia | Opcional: sem ela usa a IA da Clubetec (já incluída). Leitura de imagens/PDF.
- Assistente de IA | /agente | Ligar o assistente, como ele se comporta, follow-up automático e "Testar o agente".
- Menus e respostas automáticas (fluxos) | /fluxos | Menus, triagem, horário e automações sem código; modelos prontos; bloco "Mover no funil"; publicar.
- Documentos para a IA | /conhecimento | Documentos que a IA consulta (por setor), documentos modelo do seu tipo de empresa.
- Arquivos e respostas prontas | /biblioteca | Arquivos e respostas rápidas para enviar no atendimento.
- Etiquetas e grupos | /etiquetas | Criar, colorir, ícones, etiquetas por setor, juntar duplicadas.
- Integrações | /integracoes | Conectar outros sistemas (ERP, agenda, cobrança) com guia passo a passo.
- Cobranças (configuração) | /configuracoes/cobrancas | Chave do Asaas, ambiente e regras de cobrança.
- Segurança | /seguranca | Verificação em duas etapas (MFA) e códigos de recuperação (ícone da pessoa → Segurança).

COMO FAZER (atalhos frequentes):
- Conectar o WhatsApp: Configurações → WhatsApp (ou /numeros) → Adicionar número → ler o QR Code com o celular.
- Convidar um atendente: Configurações → Pessoas e convites → Convidar → e-mail e papel.
- Criar setor: Configurações → Setores e fila (ou /setores) → Novo setor, escolher cor e pessoas.
- Distribuição automática da fila: Equipe → Departamentos → "Distribuição automática" e o limite por pessoa.
- Cliente voltar para o mesmo atendente: Equipe → Departamentos → ligar "Atendente preferencial".
- Ligar o agente de IA: Configurações → Ligar e testar o assistente → testar e ligar.
- Horário de atendimento: Configurações → Horário de atendimento (ou aprove a etapa Empresa do Diagnóstico e use o horário sugerido).
- Mensagem fora do horário / menu de triagem: Fluxos → Modelos prontos → instalar → revisar → publicar.
- Retorno automático para quem parou de responder numa etapa: Funil → Editar etapas → relógio da etapa → dias (ex.: 2, 5, 10).
- Gerar proposta para o cliente: na conversa → Mais → Gerar proposta (rascunho) → revisar → Enviar.
- Pôr o logo e as cores da empresa: Configurações → Logo e cores.
- Diagnóstico (2ª parte): etapas Pós-venda, Sistemas e dados (LGPD) e Publicar e medir; nesta, depois de aprovada, "Escrever textos" gera a descrição do perfil no Google, bio do Instagram, "Sobre" do Facebook e ideias de publicação. Em cada página de processos de um setor dá para "Convidar" alguém da equipe para escrever; a pessoa recebe aviso no sino, escreve em /diagnostico/setor (vê só aquele setor) e o dono clica "Usar este texto", organiza e aprova. No Planejamento, o botão "PDF" abre a impressão (Salvar como PDF).
- Google Agenda: Integrações → Conectores prontos → Google Agenda → "Conectar" (login do Google de quem tem a agenda; acesso só a eventos e livre/ocupado). Nos fluxos, o bloco do conector tem "Horários livres" (devolve a lista {horarios} para mostrar ao cliente) e "Agendar" (marca o horário que o cliente escolheu: guarde a resposta dele na variável horario — pode ser o número da lista ou dd/mm hh:mm). O compromisso entra na agenda com nome e telefone do cliente.
- Facebook e Instagram (módulo Canais): Números → Facebook e Instagram → "Conectar Página" com o ID da Página e o token da Página (gerado no Gerenciador de Negócios da Meta, usuário do sistema); o Instagram profissional ligado à Página entra junto. Dá para ligar/desligar Messenger e Instagram, escolher o setor e ligar "IA responde". As mensagens aparecem em Conversas; a Meta só deixa responder até 24 h depois da última mensagem da pessoa e, por enquanto, só texto.
- Rede de franquias: Configurações → Rede de franquias. Unidade: digita o código que a matriz enviou (pode sair quando quiser) e "Aplicar o padrão da rede" (acrescenta etapas, setores, etiquetas e troca as instruções do assistente e as regras; não apaga nada). Matriz: painel só com números por unidade (nunca dados de clientes), "Gerar código de convite" (vale 7 dias, uma unidade) e "Publicar o padrão" (opcional ou obrigatório). Criar a rede e o white label (nome, cores e logo da rede no lugar de "Deixa com a IA") é com a Clubetec.
- Antes × depois: no Início, "Começar a medir" guarda os números dos últimos 30 dias como ponto de partida da implantação; depois o cartão compara com os 30 dias mais recentes.
- Telefonia (módulo): o dono cadastra a própria central em Equipe → Ramais → "Novo ramal": escolhe a central (Asterisk/FreePBX/Issabel, 3CX, Nvoip, Handphone ou outra SIP), informa servidor, usuário e senha (vai para o cofre) e, se a central tiver WebRTC, o endereço wss:// para o telefone no navegador; "Testar" confere antes de salvar. Histórico de ligações de qualquer central: chave com "Registrar ligações" em Configurações → API e webhooks e a central (ou n8n) envia POST /calls.
- Chat da equipe (/chat): busca no alto da lista (acha só nas conversas que a pessoa vê), reações nas mensagens (passe o mouse e clique no rostinho) e Grupos com pessoas escolhidas ("+" em Grupos; só os membros veem; quem criou muda as pessoas; "Sair" deixa o grupo).
- Campanhas: no número oficial da Meta, "Buscar modelos aprovados" puxa os modelos da conta; "Teste A/B" manda uma segunda versão para metade da lista; no número por QR dá para anexar um arquivo da biblioteca (a mensagem vai como legenda); depois de iniciada, "Resultado" mostra quem respondeu em até 7 dias e quem saiu da lista, por versão.
- Relatórios: Resultados → Relatórios → escolher a aba, "7/30/90 dias" ou "Escolher datas" (até 1 ano); "PDF" abre a impressão do navegador (escolher "Salvar como PDF"); "CSV" baixa planilha; "Receber por e-mail" manda semanal (segunda) ou mensal (dia 1º) para o próprio e-mail, com os números que a pessoa já vê.
- Ligar com n8n, Make, Zapier ou outro sistema: Configurações → API e webhooks (/configuracoes/api) → Nova chave (aparece uma vez só; marcar só as permissões necessárias) e/ou Novo endereço de webhook (https público) para receber avisos de novo contato, nova conversa, mudança de etapa, atendimento encerrado e mensagem recebida. O botão de enviar testa o endereço.
- Usar o cérebro: Configurações → Áreas e responsáveis → Sugerir áreas → escolher responsáveis → ligar; em Resultados → Cérebro criar metas e "Analisar agora".
- Delegar aprovação para um responsável: Áreas e responsáveis → coluna Responsável (ele aprova processo e automação da área; agente de IA e integração só o dono).
- Ver resultados: Início ou Resultados → Relatórios.
- Ativar a verificação em duas etapas: ícone da pessoa → Segurança.
- Algo complexo (integração com sistema próprio, problema técnico): Integrações → "Pedir ajuda ao time Clubetec".
`;
