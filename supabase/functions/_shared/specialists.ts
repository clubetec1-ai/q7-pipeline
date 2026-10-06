/**
 * Especialista de cada etapa do Diagnóstico: quem conduz a entrevista e o que os agentes de IA
 * precisam saber daquela parte da empresa (com o porquê). O entrevistador compara esta lista com
 * os anexos, as respostas e as etapas já aprovadas, e pergunta só o que falta ou está incompleto,
 * explicando ao dono o que o atendimento não vai conseguir fazer sem aquilo.
 */
export interface Need { item: string; porque: string }
export interface Specialist { papel: string; precisa: Need[] }

const N = (item: string, porque: string): Need => ({ item, porque });

export const SPECIALISTS: Record<string, Specialist> = {
  empresa: {
    papel: "especialista em atendimento e operação comercial",
    precisa: [
      N("o que a empresa faz e para quem", "o agente precisa apresentar a empresa e entender se o cliente é o público certo"),
      N("cidade, endereço ou região atendida", "o agente responde se atende o cliente onde ele está"),
      N("canais e horário de atendimento", "fora do horário o agente avisa quando uma pessoa vai responder"),
      N("produtos ou serviços principais com preço, faixa de preço ou regra de orçamento", "sem isso o agente não responde \"quanto custa\" e passa tudo para uma pessoa"),
      N("formas de pagamento e prazos de entrega ou execução", "são as perguntas mais comuns antes de fechar"),
      N("políticas de troca, cancelamento e garantia", "evita o agente prometer o que a empresa não faz"),
      N("dúvidas frequentes dos clientes e as respostas", "o agente resolve sozinho o que mais se repete"),
    ],
  },
  clientes: {
    papel: "especialista em vendas e jornada do cliente",
    precisa: [
      N("quem compra (tipo de cliente, empresa ou pessoa, o que busca)", "o agente adapta a conversa a cada tipo de cliente"),
      N("por onde os clientes chegam", "a origem muda a primeira resposta e as campanhas"),
      N("perguntas que fazem antes de comprar", "o agente já tem a resposta pronta"),
      N("objeções mais comuns e como a empresa responde", "sem isso o agente trava quando o cliente acha caro ou demorado"),
      N("o que faz o cliente fechar", "o agente destaca o que mais convence"),
      N("quando passar o cliente para um vendedor", "o agente sabe a hora certa de chamar uma pessoa e não perde a venda"),
    ],
  },
  posvenda: {
    papel: "especialista em pós-venda e sucesso do cliente",
    precisa: [
      N("como é a entrega ou execução e que avisos o cliente recebe", "o agente informa o andamento sem chamar ninguém"),
      N("reclamações: por onde chegam, quem resolve, em quanto tempo e o passo a passo", "sem isso, quando um cliente reclamar, o agente não sabe para quem passar nem o que prometer"),
      N("garantia e trocas na prática", "o agente orienta o cliente sem prometer errado"),
      N("como pede avaliação e indicação", "o agente faz isso no momento certo"),
      N("como traz o cliente de volta (recompra, revisão, renovação)", "permite lembretes e campanhas automáticas"),
    ],
  },
  marca: {
    papel: "especialista em marketing e marca",
    precisa: [
      N("se as cores e fontes sugeridas pelo kit representam a marca", "tudo que o sistema gerar vai usar essas cores e fontes"),
      N("onde usa o logo completo e onde usa só o símbolo", "evita o logo errado em posts e documentos"),
      N("jeito de falar com o cliente (você ou senhor, emoji, mais sério ou descontraído)", "o agente escreve como a empresa escreve"),
      N("palavras e expressões que a empresa usa e as que evita", "o agente não soa estranho para o cliente"),
      N("slogan ou frase da marca", "aparece em assinaturas, posts e materiais"),
    ],
  },
  cultura: {
    papel: "especialista em cultura organizacional e pessoas",
    precisa: [
      N("missão, visão e valores", "guiam como o agente e a equipe se comportam"),
      N("como os valores aparecem no dia a dia (exemplos reais)", "valor sem exemplo não vira comportamento no atendimento"),
      N("como a equipe deve tratar o cliente, inclusive em conflito ou reclamação", "o agente segue o mesmo padrão da equipe quando o cliente está insatisfeito"),
      N("o que é inaceitável no atendimento", "vira regra que o agente nunca quebra"),
      N("perfil de quem a empresa contrata", "ajuda a montar treinamentos e o atendimento humano"),
    ],
  },
  situacao: {
    papel: "especialista em gestão e diagnóstico empresarial",
    precisa: [
      N("tamanho da equipe e quem atende os clientes", "define a fila e quando a IA assume"),
      N("volume de mensagens, pedidos ou atendimentos por mês e horários de pico", "mostra onde a IA tira mais trabalho"),
      N("maiores dores hoje", "o plano ataca primeiro o que mais pesa"),
      N("o que já funciona bem", "evita mexer no que dá certo"),
    ],
  },
  sistemas: {
    papel: "especialista em sistemas, integrações e LGPD",
    precisa: [
      N("sistemas e planilhas usados em cada tarefa (pedidos, estoque, agenda, financeiro, nota)", "o agente só consulta o que estiver ligado"),
      N("o que é digitado duas vezes", "mostra onde integrar e ganhar tempo"),
      N("onde ficam os dados dos clientes, quem acessa e por quanto tempo guarda", "é exigência da LGPD e define o que o agente pode ver"),
      N("se pede autorização do cliente para guardar e usar os dados", "evita problema com a LGPD"),
    ],
  },
  objetivos: {
    papel: "especialista em planejamento estratégico",
    precisa: [
      N("2 ou 3 resultados para os próximos 6 a 12 meses, com número", "o cérebro acompanha e cobra cada um"),
      N("como medir cada resultado", "sem medida não dá para saber se melhorou"),
      N("o que impede hoje de chegar lá", "vira as primeiras melhorias"),
    ],
  },
  setores: {
    papel: "especialista em organização e estrutura",
    precisa: [
      N("todos os setores da empresa", "o agente encaminha cada assunto para o setor certo"),
      N("responsável de cada setor e quantas pessoas", "define filas, aprovações e quem recebe os avisos"),
      N("o que cada setor resolve para o cliente", "sem isso o agente transfere o cliente para o setor errado"),
    ],
  },
  processos: {
    papel: "especialista em processos",
    precisa: [
      N("os processos principais do setor", "cada processo pode virar um fluxo automático"),
      N("o que dispara cada processo e o passo a passo", "o agente segue os mesmos passos que a equipe"),
      N("quem faz e com que ferramenta", "define quem recebe a tarefa"),
      N("quanto tempo leva e onde trava", "mostra onde automatizar primeiro"),
      N("exceções e o que o cliente precisa informar", "o agente pede tudo de uma vez e não trava no caso diferente"),
    ],
  },
  regras: {
    papel: "especialista em atendimento com IA e conformidade",
    precisa: [
      N("o que a IA pode resolver sozinha", "o agente sabe até onde ir"),
      N("o que a IA nunca pode fazer ou prometer (desconto, prazo, assunto jurídico ou médico, dados de cartão)", "evita prejuízo e problema legal"),
      N("quando passar para uma pessoa e para quem", "o cliente não fica sem resposta nos casos difíceis"),
      N("assuntos sensíveis e como tratar", "o agente responde com cuidado ou passa para uma pessoa"),
    ],
  },
  publicar: {
    papel: "especialista em marketing digital",
    precisa: [
      N("onde a empresa aparece (Google, Instagram, Facebook, site, marketplaces)", "define onde publicar e onde o cliente chega"),
      N("com que frequência publica e o que funciona", "o plano de conteúdo repete o que dá resultado"),
      N("o que acompanhar para saber se está melhorando", "o cérebro mede e mostra a evolução"),
    ],
  },
};

/** Especialista da etapa; em Processos, o papel leva o nome do setor. */
export function specialistFor(stageKey: string, setor = ""): Specialist | null {
  const s = SPECIALISTS[stageKey];
  if (!s) return null;
  return stageKey === "processos" && setor ? { ...s, papel: `especialista em processos do setor ${setor}` } : s;
}

/** Lista para o prompt: um item por linha, com o porquê. */
export const needsText = (s: Specialist) => s.precisa.map((n, i) => `${i + 1}. ${n.item} — porque ${n.porque}`).join("\n");

/**
 * Revisor de cada etapa (desenho 07, fatia 2): o diretor da área no organograma de IA, que dá a
 * segunda opinião sobre o que foi levantado — diferente do especialista que entrevistou.
 */
export interface Reviewer { papel: string; foco: string }
const COMERCIAL: Reviewer = { papel: "Diretor Comercial e de Marketing (IA)", foco: "preços, prazos, condições, políticas e promessas ao cliente coerentes entre si e com o que a empresa faz de verdade" };
const ATENDIMENTO: Reviewer = { papel: "Diretor de Atendimento e Pós-venda (IA)", foco: "horários, canais, prazos de resposta, reclamações, garantia e trocas coerentes com as outras etapas, e quem resolve cada caso" };
const OPERACOES: Reviewer = { papel: "Diretor de Operações (IA)", foco: "setores, responsáveis, processos e volumes coerentes entre si; passos que dependem de alguém ou de algo que não existe" };
export const REVIEWERS: Record<string, Reviewer> = {
  empresa: COMERCIAL,
  clientes: COMERCIAL,
  publicar: COMERCIAL,
  marca: { papel: "Diretor Comercial e de Marketing (IA)", foco: "jeito de falar, slogan e identidade coerentes com o público, a cultura e o que a empresa promete" },
  posvenda: ATENDIMENTO,
  cultura: { papel: "Diretor de Pessoas (IA)", foco: "valores e comportamentos coerentes com o jeito de atender e com as regras; nada que vire avaliação individual de pessoas" },
  situacao: OPERACOES,
  setores: OPERACOES,
  processos: OPERACOES,
  sistemas: { papel: "Diretor de Tecnologia e Dados (IA)", foco: "sistemas e dados coerentes com os processos; riscos de LGPD (dados pessoais, acesso, guarda, consentimento)" },
  objetivos: { papel: "Cérebro — visão de CEO (IA)", foco: "objetivos coerentes com a situação, a equipe e os setores; metas que dá para medir" },
  regras: { papel: "Diretor Administrativo e de Conformidade (IA)", foco: "regras da IA coerentes com as políticas e a lei; promessas proibidas, assuntos jurídicos, médicos ou de dados pessoais" },
};
export const reviewerFor = (stageKey: string): Reviewer | null => REVIEWERS[stageKey] ?? null;
