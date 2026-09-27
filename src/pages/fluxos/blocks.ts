/** Blocos do construtor de fluxo — espelham o motor (`_shared/flow/engine.ts`). */
export type BlockData = Record<string, unknown>;

export interface BlockDef {
  type: string;
  label: string;
  color: string;
  /** Saídas do bloco: id do handle → rótulo. */
  outputs: (d: BlockData) => { id: string; label: string }[];
  defaults: () => BlockData;
  summary: (d: BlockData) => string;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const cut = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s);

export const BLOCKS: BlockDef[] = [
  {
    type: "start", label: "Início", color: "#2EB67D",
    outputs: () => [{ id: "first_contact", label: "Primeiro contato" }, { id: "returning", label: "Cliente que volta" }],
    defaults: () => ({}),
    summary: () => "Quando o cliente manda mensagem",
  },
  {
    type: "message", label: "Mensagem", color: "#3FB8BE",
    outputs: () => [{ id: "next", label: "Depois" }],
    defaults: () => ({ text: "Olá {nome}!" }),
    summary: (d) => cut(str(d.text)),
  },
  {
    type: "menu", label: "Menu", color: "#6C8EF5",
    outputs: (d) => [
      ...((d.options as { id: string; label: string }[] | undefined) ?? []).map((o, i) => ({ id: `opt:${o.id}`, label: `${i + 1} - ${o.label}` })),
      { id: "invalid", label: "Não entendeu" },
    ],
    defaults: () => ({ text: "Como posso ajudar?", options: [{ id: "a", label: "Vendas" }, { id: "b", label: "Suporte" }], max_attempts: 2 }),
    summary: (d) => cut(str(d.text)),
  },
  {
    type: "question", label: "Pergunta", color: "#8B5CF6",
    outputs: () => [{ id: "ok", label: "Respondeu" }, { id: "invalid", label: "Inválida" }],
    defaults: () => ({ text: "Qual é o seu nome?", kind: "text", save_to: "name", max_attempts: 2 }),
    summary: (d) => cut(str(d.text)),
  },
  {
    type: "condition", label: "Condição", color: "#F5A623",
    outputs: () => [{ id: "true", label: "Sim" }, { id: "false", label: "Não" }],
    defaults: () => ({ kind: "first_contact" }),
    summary: (d) => ({ first_contact: "É o primeiro contato?", tag: "Tem a etiqueta?", contact_group: "Está no grupo?", weekday: "É dia da semana?" } as Record<string, string>)[str(d.kind)] ?? "",
  },
  {
    type: "business_hours", label: "Horário", color: "#F5A623",
    outputs: () => [{ id: "open", label: "Aberto" }, { id: "closed", label: "Fechado" }],
    defaults: () => ({}),
    summary: () => "Horário de atendimento da empresa",
  },
  {
    type: "ai_agent", label: "Agente de IA", color: "#E8618C",
    outputs: () => [{ id: "transferred", label: "Pediu humano" }, { id: "fallback", label: "Limite de respostas" }],
    defaults: () => ({ prompt: "", max_turns: 10, handoff_words: ["atendente", "humano", "pessoa"] }),
    summary: (d) => cut(str(d.prompt) || "Usa o prompt do agente da empresa"),
  },
  {
    type: "tag", label: "Etiqueta", color: "#64748B",
    outputs: () => [{ id: "next", label: "Depois" }],
    defaults: () => ({ tag_id: "", remove: false }),
    summary: (d) => (d.remove ? "Remove etiqueta" : "Adiciona etiqueta"),
  },
  {
    type: "transfer", label: "Transferir", color: "#0EA5E9",
    outputs: () => [],
    defaults: () => ({ department_id: "", text: "Vou te passar para um atendente." }),
    summary: (d) => (d.department_id ? "Para um departamento" : "Para a fila geral"),
  },
  {
    type: "close", label: "Finalizar", color: "#EF4444",
    outputs: () => [],
    defaults: () => ({ text: "Obrigado pelo contato!" }),
    summary: (d) => cut(str(d.text) || "Encerra o atendimento"),
  },
];

export const BLOCK = Object.fromEntries(BLOCKS.map((b) => [b.type, b])) as Record<string, BlockDef>;

export const NEW_GRAPH = {
  nodes: [{ id: "start", type: "start", position: { x: 80, y: 120 }, data: {} }],
  edges: [],
};
