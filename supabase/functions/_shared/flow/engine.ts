/**
 * Motor de fluxo — FUNÇÃO PURA (spec fluxo §6.1): não acessa banco, rede nem
 * relógio. Recebe o grafo, o bloco atual, a entrada do cliente e o contexto;
 * devolve as ações a aplicar, os passos percorridos e o novo estado.
 */

export interface FlowNode { id: string; type: string; data: Record<string, any> }
export interface FlowEdge { source: string; sourceHandle?: string | null; target: string }
export interface FlowGraph { nodes: FlowNode[]; edges: FlowEdge[] }

export interface FlowCtx {
  firstContact: boolean;
  weekday: number;            // 0 = domingo, no fuso da organização
  minutes: number;            // minutos desde 00:00, no fuso da organização
  tagIds: string[];
  groupIds: string[];
  contactName: string;
  protocol?: string;
  vars: Record<string, string>;
  attempts: number;
  aiTurns: number;
  businessHours?: Record<string, { start: string; end: string }[]>; // "0".."6"
}

export type FlowAction =
  | { type: "send"; text: string }
  | { type: "set_field"; field: "name" | "email" | "document"; value: string }
  | { type: "tag"; tagId: string; remove: boolean }
  | { type: "ai"; nodeId: string }
  | { type: "transfer"; departmentId: string | null; userId: string | null }
  | { type: "close"; reasonId: string | null }
  | { type: "queue" };

export interface FlowResult {
  actions: FlowAction[];
  steps: { nodeId: string; outcome: string }[];
  currentNodeId: string | null;
  state: "waiting_input" | "ai" | "done" | "error";
  vars: Record<string, string>;
  attempts: number;
  aiTurns: number;
  error?: string;
}

export const MAX_STEPS = 50;
const HANDOFF = ["atendente", "humano", "pessoa"];

export function fill(text: string, ctx: FlowCtx): string {
  const first = (ctx.contactName || "").trim().split(/\s+/)[0] ?? "";
  return String(text ?? "")
    .split("{nome}").join(first)
    .split("{protocolo}").join(ctx.protocol ?? "")
    .replace(/\{var\.([a-z0-9_]{1,40})\}/gi, (_, k) => ctx.vars[k] ?? "");
}

function norm(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

/** Valida resposta de Pergunta. Devolve o valor normalizado ou null. */
export function validate(kind: string, raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  switch (kind) {
    case "number": return /^-?\d+([.,]\d+)?$/.test(v) ? v.replace(",", ".") : null;
    case "email": return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? v.toLowerCase() : null;
    case "cpf_cnpj": {
      const d = v.replace(/\D/g, "");
      return d.length === 11 || d.length === 14 ? d : null;
    }
    case "date": {
      const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!m) return null;
      const [dd, mm, yy] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const dt = new Date(Date.UTC(yy, mm - 1, dd));
      return dt.getUTCDate() === dd && dt.getUTCMonth() === mm - 1 ? `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}` : null;
    }
    default: return v.slice(0, 500);
  }
}

function isOpen(ctx: FlowCtx): boolean {
  const slots = ctx.businessHours?.[String(ctx.weekday)] ?? [];
  const toMin = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + (m || 0);
  };
  return slots.some((s) => ctx.minutes >= toMin(s.start) && ctx.minutes < toMin(s.end));
}

function menuText(node: FlowNode, ctx: FlowCtx): string {
  const opts = (node.data.options ?? []) as { id: string; label: string }[];
  return `${fill(node.data.text ?? "", ctx)}\n\n${opts.map((o, i) => `${i + 1} - ${o.label}`).join("\n")}`;
}

/**
 * Avança o fluxo a partir de `nodeId`. `input` só existe quando o cliente
 * respondeu a um bloco que estava esperando (menu, pergunta, IA).
 */
export function advance(graph: FlowGraph, nodeId: string, input: string | null, ctx0: FlowCtx): FlowResult {
  const ctx: FlowCtx = { ...ctx0, vars: { ...ctx0.vars } };
  const actions: FlowAction[] = [];
  const steps: FlowResult["steps"] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const nextOf = (id: string, handle: string) =>
    graph.edges.find((e) => e.source === id && (e.sourceHandle ?? "next") === handle)?.target ?? null;

  const finish = (state: FlowResult["state"], current: string | null, error?: string): FlowResult => ({
    actions, steps, currentNodeId: current, state, vars: ctx.vars, attempts: ctx.attempts, aiTurns: ctx.aiTurns, error,
  });

  let current: string | null = nodeId;
  let pending = input;
  for (let i = 0; i < MAX_STEPS; i++) {
    const node = current ? byId.get(current) : undefined;
    if (!node) {
      // Saída sem ligação: fim do fluxo → fila geral (nunca fica preso em "bot").
      actions.push({ type: "queue" });
      return finish("done", null);
    }
    const d = node.data ?? {};
    let handle: string;

    switch (node.type) {
      case "start":
        handle = ctx.firstContact || !nextOf(node.id, "returning") ? "first_contact" : "returning";
        break;
      case "message":
        actions.push({ type: "send", text: fill(d.text ?? "", ctx) });
        handle = "next";
        break;
      case "menu": {
        if (pending === null) {
          actions.push({ type: "send", text: menuText(node, ctx) });
          steps.push({ nodeId: node.id, outcome: "asked" });
          return finish("waiting_input", node.id);
        }
        const opts = (d.options ?? []) as { id: string; label: string }[];
        const n = Number(pending.trim());
        const hit = Number.isInteger(n) && n >= 1 && n <= opts.length
          ? opts[n - 1]
          : opts.find((o) => norm(o.label) === norm(pending!));
        pending = null;
        if (hit) { ctx.attempts = 0; handle = `opt:${hit.id}`; break; }
        ctx.attempts += 1;
        if (ctx.attempts >= Number(d.max_attempts ?? 2)) { ctx.attempts = 0; handle = "invalid"; break; }
        actions.push({ type: "send", text: `Não entendi. ${menuText(node, ctx)}` });
        steps.push({ nodeId: node.id, outcome: "retry" });
        return finish("waiting_input", node.id);
      }
      case "question": {
        if (pending === null) {
          actions.push({ type: "send", text: fill(d.text ?? "", ctx) });
          steps.push({ nodeId: node.id, outcome: "asked" });
          return finish("waiting_input", node.id);
        }
        const value = validate(String(d.kind ?? "text"), pending);
        pending = null;
        if (value !== null) {
          ctx.attempts = 0;
          if (["name", "email", "document"].includes(d.save_to)) actions.push({ type: "set_field", field: d.save_to, value });
          if (d.var_name) ctx.vars[String(d.var_name).slice(0, 40)] = value;
          handle = "ok";
          break;
        }
        ctx.attempts += 1;
        if (ctx.attempts >= Number(d.max_attempts ?? 2)) { ctx.attempts = 0; handle = "invalid"; break; }
        actions.push({ type: "send", text: fill(d.invalid_text || "Resposta inválida. Pode tentar de novo?", ctx) });
        steps.push({ nodeId: node.id, outcome: "retry" });
        return finish("waiting_input", node.id);
      }
      case "condition": {
        let ok = false;
        if (d.kind === "first_contact") ok = ctx.firstContact;
        else if (d.kind === "tag") ok = ctx.tagIds.includes(d.tag_id);
        else if (d.kind === "contact_group") ok = ctx.groupIds.includes(d.group_id);
        else if (d.kind === "weekday") ok = ((d.weekdays ?? []) as number[]).includes(ctx.weekday);
        handle = ok ? "true" : "false";
        break;
      }
      case "business_hours":
        handle = isOpen(ctx) ? "open" : "closed";
        break;
      case "ai_agent": {
        const words = ((d.handoff_words as string[] | undefined)?.length ? d.handoff_words : HANDOFF) as string[];
        if (pending !== null && words.some((w) => norm(pending!).includes(norm(w)))) {
          pending = null;
          handle = "transferred";
          if (!nextOf(node.id, "transferred")) {
            actions.push({ type: "transfer", departmentId: d.handoff_department_id ?? null, userId: null });
            steps.push({ nodeId: node.id, outcome: handle });
            return finish("done", null);
          }
          break;
        }
        if (ctx.aiTurns >= Number(d.max_turns ?? 10)) { pending = null; handle = "fallback"; break; }
        if (pending === null && ctx.aiTurns === 0 && d.intro) actions.push({ type: "send", text: fill(d.intro, ctx) });
        actions.push({ type: "ai", nodeId: node.id });
        ctx.aiTurns += 1;
        steps.push({ nodeId: node.id, outcome: "reply" });
        return finish("ai", node.id);
      }
      case "tag":
        if (d.tag_id) actions.push({ type: "tag", tagId: d.tag_id, remove: !!d.remove });
        handle = "next";
        break;
      case "transfer":
        if (d.text) actions.push({ type: "send", text: fill(d.text, ctx) });
        actions.push({ type: "transfer", departmentId: d.department_id ?? null, userId: d.user_id ?? null });
        steps.push({ nodeId: node.id, outcome: "transfer" });
        return finish("done", null);
      case "close":
        if (d.text) actions.push({ type: "send", text: fill(d.text, ctx) });
        actions.push({ type: "close", reasonId: d.reason_id ?? null });
        steps.push({ nodeId: node.id, outcome: "close" });
        return finish("done", null);
      default:
        actions.push({ type: "queue" });
        return finish("error", node.id, `bloco desconhecido: ${node.type}`);
    }

    steps.push({ nodeId: node.id, outcome: handle });
    current = nextOf(node.id, handle);
  }
  actions.push({ type: "queue" });
  return finish("error", current, "limite de 50 blocos por mensagem");
}
