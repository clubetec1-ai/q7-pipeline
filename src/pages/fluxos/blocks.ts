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
/** Saída "Sem resposta" quando o bloco tem tempo limite. */
const timeout = (d: BlockData) => (Number(d.timeout_minutes) > 0 ? [{ id: "timeout", label: `Sem resposta em ${d.timeout_minutes} min` }] : []);
export const PROVIDER_LABEL: Record<string, string> = {
  groq: "Groq", openai: "OpenAI", openrouter: "OpenRouter", gemini: "Google Gemini", anthropic: "Anthropic (Claude)", deepseek: "DeepSeek",
};
export const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);

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
    summary: (d) => `${d.library_file_id ? "📎 " : ""}${cut(str(d.text))}`,
  },
  {
    type: "menu", label: "Menu", color: "#6C8EF5",
    outputs: (d) => [
      ...((d.options as { id: string; label: string }[] | undefined) ?? []).map((o, i) => ({ id: `opt:${o.id}`, label: `${i + 1} - ${o.label}` })),
      { id: "invalid", label: "Não entendeu" },
      ...timeout(d),
    ],
    defaults: () => ({ text: "Como posso ajudar?", options: [{ id: "a", label: "Vendas" }, { id: "b", label: "Suporte" }], max_attempts: 2 }),
    summary: (d) => cut(str(d.text)),
  },
  {
    type: "question", label: "Pergunta", color: "#8B5CF6",
    outputs: (d) => [{ id: "ok", label: "Respondeu" }, { id: "invalid", label: "Inválida" }, ...timeout(d)],
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
    summary: (d) => `${str(d.provider) ? PROVIDER_LABEL[str(d.provider)] ?? "IA" : "IA padrão"} · ${cut(str(d.prompt) || "Usa o prompt do agente da empresa", 45)}`,
  },
  {
    type: "wait", label: "Aguardar", color: "#94A3B8",
    outputs: () => [{ id: "elapsed", label: "Passou o tempo" }, { id: "replied", label: "Cliente respondeu" }],
    defaults: () => ({ minutes: 60 }),
    summary: (d) => `Espera ${fmtMinutes(Number(d.minutes) || 60)}`,
  },
  {
    type: "survey", label: "Pesquisa", color: "#10B981",
    outputs: () => [{ id: "answered", label: "Respondeu" }, { id: "timeout", label: "Sem resposta em 24 h" }],
    defaults: () => ({ kind: "csat", text: "Como você avalia o nosso atendimento?", comment: "" }),
    summary: (d) => (d.kind === "nps" ? "Nota de 0 a 10" : "Nota de 1 a 5"),
  },
  {
    type: "http", label: "Consultar sistema", color: "#7C3AED",
    outputs: () => [{ id: "success", label: "Deu certo" }, { id: "error", label: "Deu erro" }],
    defaults: () => ({ method: "GET", url: "https://", headers: [], body: "", map: [], sample: "" }),
    summary: (d) => {
      try { return `${str(d.method) || "GET"} ${new URL(str(d.url)).hostname}`; } catch { return "Configure a URL"; }
    },
  },
  {
    type: "connector", label: "Conector", color: "#9333EA",
    outputs: () => [{ id: "success", label: "Deu certo" }, { id: "error", label: "Não deu" }],
    defaults: () => ({ connector: "", connector_action: "" }),
    summary: (d) => (str(d.connector) ? `${str(d.connector)}: ${str(d.connector_action)}` : "Escolha o sistema"),
  },
  {
    type: "record", label: "Registro", color: "#0F766E",
    outputs: () => [{ id: "success", label: "Deu certo" }, { id: "error", label: "Não deu" }],
    defaults: () => ({ mode: "create", type_id: "", values: {} }),
    summary: (d) => ({ create: "Cria registro", update: "Atualiza o último registro", read: "Consulta o último registro" } as Record<string, string>)[str(d.mode) || "create"],
  },
  {
    type: "tag", label: "Etiqueta", color: "#64748B",
    outputs: () => [{ id: "next", label: "Depois" }],
    defaults: () => ({ tag_id: "", remove: false }),
    summary: (d) => (d.remove ? "Remove etiqueta" : "Adiciona etiqueta"),
  },
  {
    type: "stage", label: "Mover no funil", color: "#8B5CF6",
    outputs: () => [{ id: "next", label: "Depois" }],
    defaults: () => ({ stage_id: "" }),
    summary: () => "Move a conversa para uma etapa do Kanban",
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
