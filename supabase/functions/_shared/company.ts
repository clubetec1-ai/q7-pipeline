/**
 * Retrato da empresa (entrevistador). Só as seções PÚBLICAS vão para a IA de
 * atendimento, e só se o dono deixar ligado (use_in_ai). Cultura, situação,
 * objetivos, setores, processos, pessoas, sistemas e metas são internos e nunca
 * saem daqui para o cliente.
 */

export const SECTIONS: Record<string, { label: string; public: boolean }> = {
  empresa: { label: "Sobre a empresa", public: true },
  atendimento: { label: "Atendimento (canais, horários, prazos)", public: true },
  produtos: { label: "Produtos, serviços e preços", public: true },
  politicas: { label: "Políticas (troca, cancelamento, pagamento, garantia)", public: true },
  faq: { label: "Perguntas frequentes", public: true },
  cultura: { label: "Cultura: missão, visão, valores e jeito de trabalhar", public: false },
  situacao: { label: "Onde a empresa está hoje (números, dores, o que funciona)", public: false },
  objetivos: { label: "Resultados que quer alcançar", public: false },
  setores: { label: "Setores e responsáveis", public: false },
  areas: { label: "Áreas, pessoas e responsáveis", public: false },
  sistemas: { label: "Sistemas usados", public: false },
  metas: { label: "Volumes, metas e maiores dores", public: false },
};

/** Etapas da consultoria, em ordem; cada uma diz o que perguntar e onde salvar. */
export const STAGES: { key: string; label: string; sections: string[]; guide: string }[] = [
  { key: "empresa", label: "Empresa e atendimento", sections: ["empresa", "atendimento", "produtos", "politicas", "faq"],
    guide: "Confirme o que veio de dados públicos (se houver) e complete: o que a empresa faz, para quem, onde; canais e horários; produtos/serviços e preços ou regra de orçamento; políticas; dúvidas frequentes dos clientes." },
  { key: "cultura", label: "Cultura", sections: ["cultura"],
    guide: "Pergunte se a empresa já tem cultura definida e como ela aparece no dia a dia. Peça missão, visão e valores; se não tiver, ajude a escrever a partir do que o dono contar (marque como proposta para ele aprovar)." },
  { key: "situacao", label: "Onde está hoje", sections: ["situacao", "metas", "sistemas"],
    guide: "Entenda a situação atual: tamanho da equipe, volumes (mensagens, pedidos, atendimentos por mês), faturamento aproximado se ele quiser dizer, sistemas usados, maiores dores e o que já funciona bem." },
  { key: "objetivos", label: "Objetivos", sections: ["objetivos"],
    guide: "Pergunte quais resultados quer buscar nos próximos 6 a 12 meses (vendas, atendimento, tempo, custo, crescimento) e como vai medir cada um." },
  { key: "setores", label: "Setores", sections: ["setores", "areas"],
    guide: "Mapeie TODOS os setores da empresa (ex.: comercial, financeiro, atendimento, operação, RH), quem é o responsável e quantas pessoas. Ainda não detalhe processos." },
  { key: "processos", label: "Processos por setor", sections: [],
    guide: "Entre em um setor por vez, na ordem do mapa de setores. Para cada processo peça para descrever COMO SE ESTIVESSE ENSINANDO UMA PESSOA NOVA: passo a passo, quem faz, com que ferramenta, quanto tempo, onde trava e as exceções. Dê um exemplo curto na primeira vez (ex.: '1. Cliente pede orçamento no WhatsApp; 2. Vendedor confere estoque na planilha; 3. ...'). Quando o setor acabar, confirme e passe ao próximo." },
];

const MAX_KNOWLEDGE = 6000;

/** Texto para o prompt da IA de atendimento ("" se não houver ou estiver desligado). */
// deno-lint-ignore no-explicit-any
export async function companyKnowledge(org: any): Promise<string> {
  const { data } = await org.select("company_profiles", "sections, use_in_ai").maybeSingle();
  if (!data?.use_in_ai) return "";
  const parts = Object.entries(SECTIONS)
    .filter(([k, s]) => s.public && typeof data.sections?.[k] === "string" && data.sections[k].trim())
    .map(([k, s]) => `## ${s.label}\n${String(data.sections[k]).trim()}`);
  if (!parts.length) return "";
  const text = parts.join("\n\n").slice(0, MAX_KNOWLEDGE);
  return `Informações da empresa (use para responder; não invente o que não estiver aqui):\n${text}`;
}
