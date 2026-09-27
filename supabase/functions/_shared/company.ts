/**
 * Retrato da empresa (entrevistador). Só as seções PÚBLICAS vão para a IA de
 * atendimento, e só se o dono deixar ligado (use_in_ai). Processos, pessoas,
 * sistemas e metas são internos e nunca saem daqui para o cliente.
 */

export const SECTIONS: Record<string, { label: string; public: boolean }> = {
  empresa: { label: "Sobre a empresa", public: true },
  atendimento: { label: "Atendimento (canais, horários, prazos)", public: true },
  produtos: { label: "Produtos, serviços e preços", public: true },
  politicas: { label: "Políticas (troca, cancelamento, pagamento, garantia)", public: true },
  faq: { label: "Perguntas frequentes", public: true },
  areas: { label: "Áreas, pessoas e responsáveis", public: false },
  sistemas: { label: "Sistemas usados", public: false },
  metas: { label: "Volumes, metas e maiores dores", public: false },
};

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
