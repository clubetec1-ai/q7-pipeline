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
  /** Retomado pelo relógio (wait_until venceu), não por mensagem do cliente. */
  timerFired?: boolean;
  /** Resultado da chamada do bloco HTTP em que o run parou (o executor chamou). */
  httpResult?: "success" | "error";
  /** Resultado do bloco Registro em que o run parou (o executor gravou/leu). */
  recordResult?: "success" | "error";
  /** Resultado do bloco Conector (Bling etc.) em que o run parou. */
  connectorResult?: "success" | "error";
  businessHours?: Record<string, { start: string; end: string }[]>; // "0".."6"
}

export type FlowAction =
  | { type: "send"; text: string; fileId?: string }
  | { type: "set_field"; field: string; value: string } // name | email | document | custom:<chave>
  | { type: "tag"; tagId: string; remove: boolean }
  | { type: "ai"; nodeId: string }
  | { type: "transfer"; departmentId: string | null; userId: string | null }
  | { type: "close"; reasonId: string | null }
  | { type: "rating"; value: number }
  | { type: "rating_comment"; text: string }
  | { type: "queue" };

export interface FlowResult {
  actions: FlowAction[];
  steps: { nodeId: string; outcome: string }[];
  currentNodeId: string | null;
  state: "waiting_input" | "waiting_timer" | "ai" | "http" | "record" | "connector" | "done" | "error";
  vars: Record<string, string>;
  attempts: number;
  aiTurns: number;
  error?: string;
  /** Minutos até o relógio retomar o fluxo (wait_until). */
  waitMinutes?: number;
  /** Pesquisa com resposta inválida: a mensagem segue o caminho normal. */
  passthrough?: boolean;
}

export const MAX_STEPS = 50;
/** Espera máxima: fica dentro da janela de 24 h do WhatsApp. */
export const MAX_WAIT_MIN = 1380;
const SURVEY_WAIT_MIN = 1440;

const clampWait = (v: unknown) => Math.min(MAX_WAIT_MIN, Math.max(1, Math.round(Number(v) || 60)));
const timeoutOf = (d: Record<string, any>) =>
  Number(d.timeout_minutes) > 0 ? { waitMinutes: clampWait(d.timeout_minutes) } : {};
const HANDOFF = ["atendente", "humano", "pessoa"];

/** Lê um caminho simples `a.b[0].c` de um JSON. */
export function pickPath(obj: unknown, path: string): unknown {
  let cur: any = obj;
  for (const part of String(path).match(/[^.[\]]+/g) ?? []) {
    if (cur === null || typeof cur !== "object") return undefined;
    if (part === "__proto__" || part === "constructor" || part === "prototype") return undefined;
    cur = Object.prototype.hasOwnProperty.call(cur, part) ? cur[part] : undefined;
  }
  return cur;
}

/** Copia campos da resposta do HTTP para variáveis (texto, até 500 caracteres). */
export function mapResponse(body: unknown, map: unknown, vars: Record<string, string>): Record<string, string> {
  const out = { ...vars };
  for (const m of (Array.isArray(map) ? map : []).slice(0, 20)) {
    const name = String(m?.var ?? "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 40);
    if (!name || !m?.path) continue;
    const v = pickPath(body, String(m.path));
    if (v === undefined || v === null) continue;
    out[name] = (typeof v === "object" ? JSON.stringify(v) : String(v)).slice(0, 500);
  }
  return out;
}

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

  const finish = (state: FlowResult["state"], current: string | null, error?: string, extra: Partial<FlowResult> = {}): FlowResult => ({
    actions, steps, currentNodeId: current, state, vars: ctx.vars, attempts: ctx.attempts, aiTurns: ctx.aiTurns, error, ...extra,
  });

  let current: string | null = nodeId;
  let pending = input;
  let fired = !!ctx0.timerFired; // vale só para o bloco em que o run parou
  let http = ctx0.httpResult;
  let rec = ctx0.recordResult;
  let con = ctx0.connectorResult;
  for (let i = 0; i < MAX_STEPS; i++) {
    const node = current ? byId.get(current) : undefined;
    const timer = fired;
    const httpDone = http;
    const recDone = rec;
    rec = undefined;
    const conDone = con;
    con = undefined;
    fired = false;
    http = undefined;
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
        actions.push({ type: "send", text: fill(d.text ?? "", ctx), ...(d.library_file_id ? { fileId: String(d.library_file_id) } : {}) });
        handle = "next";
        break;
      case "menu": {
        if (timer && pending === null) { ctx.attempts = 0; handle = "timeout"; break; }
        if (pending === null) {
          actions.push({ type: "send", text: menuText(node, ctx) });
          steps.push({ nodeId: node.id, outcome: "asked" });
          return finish("waiting_input", node.id, undefined, timeoutOf(d));
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
        return finish("waiting_input", node.id, undefined, timeoutOf(d));
      }
      case "question": {
        if (timer && pending === null) { ctx.attempts = 0; handle = "timeout"; break; }
        if (pending === null) {
          actions.push({ type: "send", text: fill(d.text ?? "", ctx) });
          steps.push({ nodeId: node.id, outcome: "asked" });
          return finish("waiting_input", node.id, undefined, timeoutOf(d));
        }
        const value = validate(String(d.kind ?? "text"), pending);
        pending = null;
        if (value !== null) {
          ctx.attempts = 0;
          if (["name", "email", "document"].includes(d.save_to) || /^custom:[a-z0-9_]{1,40}$/.test(String(d.save_to ?? ""))) {
            actions.push({ type: "set_field", field: String(d.save_to), value });
          }
          if (d.var_name) ctx.vars[String(d.var_name).slice(0, 40)] = value;
          handle = "ok";
          break;
        }
        ctx.attempts += 1;
        if (ctx.attempts >= Number(d.max_attempts ?? 2)) { ctx.attempts = 0; handle = "invalid"; break; }
        actions.push({ type: "send", text: fill(d.invalid_text || "Resposta inválida. Pode tentar de novo?", ctx) });
        steps.push({ nodeId: node.id, outcome: "retry" });
        return finish("waiting_input", node.id, undefined, timeoutOf(d));
      }
      case "wait":
        if (pending !== null) { pending = null; handle = "replied"; break; }
        if (timer) { handle = "elapsed"; break; }
        steps.push({ nodeId: node.id, outcome: "waiting" });
        return finish("waiting_timer", node.id, undefined, { waitMinutes: clampWait(d.minutes) });
      case "http":
        if (httpDone) { handle = httpDone; break; }
        steps.push({ nodeId: node.id, outcome: "call" });
        return finish("http", node.id);
      case "connector":
        if (conDone) { handle = conDone; break; }
        steps.push({ nodeId: node.id, outcome: "call" });
        return finish("connector", node.id);
      case "record":
        if (recDone) { handle = recDone; break; }
        steps.push({ nodeId: node.id, outcome: "call" });
        return finish("record", node.id);
      case "survey": {
        const [min, max] = d.kind === "nps" ? [0, 10] : [1, 5];
        const stage = ctx.vars.__sv;
        if (timer) { delete ctx.vars.__sv; handle = stage === "c" ? "answered" : "timeout"; break; }
        if (pending === null) {
          ctx.vars.__sv = "r";
          actions.push({ type: "send", text: `${fill(d.text || "Como você avalia o nosso atendimento?", ctx)}\n\nResponda com um número de ${min} a ${max}.` });
          steps.push({ nodeId: node.id, outcome: "asked" });
          return finish("waiting_input", node.id, undefined, { waitMinutes: SURVEY_WAIT_MIN });
        }
        const answer = pending.trim();
        pending = null;
        if (stage === "c") {
          delete ctx.vars.__sv;
          actions.push({ type: "rating_comment", text: answer.slice(0, 1000) });
          handle = "answered";
          break;
        }
        const m = answer.match(/^(\d{1,2})(?!\d)/);
        const n = m ? Number(m[1]) : NaN;
        if (!(n >= min && n <= max)) {
          delete ctx.vars.__sv;
          steps.push({ nodeId: node.id, outcome: "invalid" });
          return finish("done", null, undefined, { passthrough: true });
        }
        actions.push({ type: "rating", value: n });
        if (d.comment) {
          ctx.vars.__sv = "c";
          actions.push({ type: "send", text: fill(d.comment, ctx) });
          steps.push({ nodeId: node.id, outcome: "rated" });
          return finish("waiting_input", node.id, undefined, { waitMinutes: SURVEY_WAIT_MIN });
        }
        delete ctx.vars.__sv;
        handle = "answered";
        break;
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
