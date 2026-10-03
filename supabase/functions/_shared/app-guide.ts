/**
 * Mapa do sistema para o assistente "Como faço…?": telas, onde ficam e como se faz.
 * Atualize quando uma tela mudar de lugar (é o que o assistente ensina ao cliente).
 */
export const APP_GUIDE = `
MENU DE CIMA: Início · Conversas · Kanban · Chat · Clientes (Clientes e fichas, Registros, Cobranças, Campanhas) · Gestão (Relatórios, Supervisor, Avaliações, Melhorias) · Minha empresa (Diagnóstico, Marca, Setores e processos, Equipe e permissões) · Configurações. No canto direito: sino de avisos e o ícone da pessoa (Segurança, tema, Sair).

TELAS (nome | caminho | para que serve):
- Início | /inicio | Primeiros passos em ordem, saúde do sistema e resultados da empresa.
- Conversas | / | Atender clientes de WhatsApp e e-mail: assumir, responder, transferir, finalizar, etiquetas, grupos, cobrar, ligar.
- Kanban | /kanban | Funil de vendas: arrastar o cliente entre as etapas.
- Chat | /chat | Conversa interna da equipe (canal geral, por setor e direto).
- Clientes e fichas | /clientes | Buscar cliente e abrir a ficha (dados, grupos, registros, protocolos, excluir dados LGPD).
- Registros | /registros | Cadastros próprios da empresa (pedidos, contas a receber, contratos) com modelos prontos.
- Cobranças | /cobrancas | Gerar cobrança PIX/boleto e acompanhar pagamentos (configurar o Asaas em Configurações → Cobranças).
- Campanhas | /campanhas | Envio em massa para grupos de clientes, com horário e velocidade.
- Relatórios | /relatorios | Atendentes, qualidade, operação, melhorias, comercial e IA; exportar CSV.
- Supervisor | /supervisor | Fila em tempo real, quem está online, exportar contatos.
- Avaliações | /avaliacoes | Avaliação automática dos atendimentos pela IA (ligar/desligar).
- Melhorias | /melhorias | Melhorias sugeridas → aprovar → instalar → medir resultado.
- Diagnóstico | /diagnostico | Entrevista da empresa por etapas (escrever, falar ou "Entrevista por voz"); gera o planejamento e as automações.
- Marca | /diagnostico?pagina=marca | Cores, logos, fontes e tom de voz que os agentes seguem.
- Setores e processos | /setores | Setores da empresa, processos e plano de implementação (agora/depois).
- Equipe e permissões | /equipe | Convidar pessoas, papéis, departamentos (distribuição automática, atendente preferencial, ajuda entre setores), mensagens automáticas, ramais.
- Configurações | /configuracoes | Central com tudo de instalação, em cartões (configurado/pendente).
- Números (WhatsApp e e-mail) | /numeros | Conectar número por QR ou pela Meta, caixas de e-mail, saúde de cada número.
- Horário e LGPD | /configuracoes/atendimento | Horário de atendimento e palavras para parar mensagens automáticas.
- Chaves de IA | /configuracoes/ia | Chave própria de IA (opcional; sem ela usa a IA da Clubetec) e leitura de imagens/PDF.
- Agente de IA | /agente | Ligar o agente, como ele se comporta, follow-up automático e "Testar o agente".
- Fluxos | /fluxos | Menus, triagem, horário e automações sem código; modelos prontos; publicar.
- Base de conhecimento | /conhecimento | Documentos que a IA consulta (por setor), documentos modelo do seu tipo de empresa.
- Biblioteca | /biblioteca | Arquivos e respostas rápidas para enviar no atendimento.
- Etiquetas e grupos | /etiquetas | Criar, colorir, ícones, etiquetas por setor, juntar duplicadas.
- Integrações | /integracoes | Conectar outros sistemas (ERP, agenda, cobrança) com guia passo a passo.
- Cobranças (configuração) | /configuracoes/cobrancas | Chave do Asaas, ambiente e regras de cobrança.
- Segurança | /seguranca | Verificação em duas etapas (MFA) e códigos de recuperação.

COMO FAZER (atalhos frequentes):
- Conectar o WhatsApp: Configurações → WhatsApp (ou /numeros) → Adicionar número → ler o QR Code com o celular.
- Convidar um atendente: Minha empresa → Equipe e permissões → Convidar → e-mail e papel.
- Criar setor: Minha empresa → Setores e processos (ou Equipe → Departamentos) → Novo setor, escolher cor e pessoas.
- Distribuição automática da fila: Equipe → Departamentos → "Distribuição automática" e o limite por pessoa.
- Cliente voltar para o mesmo atendente: Equipe → Departamentos → ligar "Atendente preferencial".
- Ligar o agente de IA: Agente de IA → ligar; teste antes em "Testar o agente".
- Horário de atendimento: Configurações → Horário e LGPD (ou aprove a etapa Empresa do Diagnóstico e use o horário sugerido).
- Mensagem fora do horário / menu de triagem: Fluxos → Modelos prontos → instalar → revisar → publicar.
- Etiquetas: Clientes → (na conversa) botão de etiquetas; criar e colorir em Etiquetas e grupos.
- Mudar a cor da marca nas telas: Marca → kit da marca → usar a primeira cor como cor principal.
- Ver resultados: Início (Resultados) ou Gestão → Relatórios.
- Ativar a verificação em duas etapas: ícone da pessoa → Segurança.
- Algo complexo (integração com sistema próprio, problema técnico): Integrações → "Pedir ajuda ao time Clubetec".
`;
