/**
 * Google Agenda (conector): horários livres e agendamento na agenda principal de quem
 * conectou. Horário de Brasília (UTC−3, sem horário de verão desde 2019). Só a agenda
 * da própria empresa (token da organização no Vault); o cliente nunca vê a agenda,
 * só os horários livres.
 */
export interface GcalInput { phone: string; name?: string | null; vars: Record<string, string> }
export interface GcalResult { ok: boolean; vars?: Record<string, string>; error?: string }

const API = "https://www.googleapis.com/calendar/v3";
const TZ = "America/Sao_Paulo";
const OFFSET = -3 * 3600_000;
const DOW = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const num = (v: unknown, d: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : d;
};
/** Hora local de Brasília de um instante (para montar a grade). */
const local = (t: number) => new Date(t + OFFSET);
const label = (t: number) => {
  const d = local(t);
  return `${DOW[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")} às ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

async function busy(token: string, from: number, to: number): Promise<{ ok: true; list: [number, number][] } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${API}/freeBusy`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), timeZone: TZ, items: [{ id: "primary" }] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401) return { ok: false, error: "Google recusou o acesso" };
    if (!res.ok) return { ok: false, error: `Google respondeu HTTP ${res.status}` };
    const d = await res.json();
    const list = ((d?.calendars?.primary?.busy ?? []) as { start: string; end: string }[])
      .map((b) => [Date.parse(b.start), Date.parse(b.end)] as [number, number]).filter(([a, b]) => a < b);
    return { ok: true, list };
  } catch {
    return { ok: false, error: "não consegui falar com o Google" };
  }
}

/** Próximos horários livres em dias úteis, dentro do expediente. */
export async function freeSlots(token: string, input: GcalInput): Promise<GcalResult> {
  const v = input.vars;
  const dur = num(v.duracao_min, 60, 15, 240) * 60_000;
  const days = num(v.dias, 7, 1, 30);
  const startH = num(v.inicio_h, 9, 0, 23), endH = num(v.fim_h, 18, 1, 24);
  const max = num(v.quantos, 6, 1, 10);
  const now = Date.now() + 2 * 3600_000; // não oferece horário para daqui a menos de 2 h
  const to = now + days * 86_400_000;
  const b = await busy(token, now, to);
  if (!b.ok) return b;
  const out: number[] = [];
  const day0 = local(now);
  for (let i = 0; i <= days && out.length < max; i++) {
    const base = Date.UTC(day0.getUTCFullYear(), day0.getUTCMonth(), day0.getUTCDate() + i) - OFFSET; // 00:00 de Brasília
    const dow = local(base).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    for (let t = base + startH * 3600_000; t + dur <= base + endH * 3600_000 && out.length < max; t += dur) {
      if (t < now) continue;
      if (b.list.some(([s, e]) => t < e && t + dur > s)) continue;
      out.push(t);
    }
  }
  if (!out.length) return { ok: false, error: "sem horário livre no período" };
  return { ok: true, vars: {
    horarios: out.map((t, i) => `${i + 1}) ${label(t)}`).join("\n"),
    horarios_iso: out.map((t) => new Date(t).toISOString()).join(","),
  } };
}

/** Lê o horário escolhido: número da lista (1, 2…), ISO, ou "dd/mm hh:mm". */
function parseChoice(v: Record<string, string>): number | null {
  const raw = String(v.horario ?? v.resposta ?? "").trim();
  const list = String(v.horarios_iso ?? "").split(",").filter(Boolean);
  const n = raw.match(/^\s*(\d{1,2})\s*\)?\s*$/);
  if (n && list[Number(n[1]) - 1]) return Date.parse(list[Number(n[1]) - 1]);
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw) && !Number.isNaN(Date.parse(raw))) return Date.parse(raw);
  const m = raw.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\D+(\d{1,2})(?:[:h](\d{2}))?/i);
  if (!m) return null;
  const nowL = local(Date.now());
  const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : nowL.getUTCFullYear();
  const t = Date.UTC(year, Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5] ?? 0)) - OFFSET;
  return Number.isNaN(t) ? null : t;
}

/** Cria o compromisso (se o horário ainda estiver livre). */
export async function book(token: string, input: GcalInput): Promise<GcalResult> {
  const v = input.vars;
  const start = parseChoice(v);
  if (!start || start < Date.now()) return { ok: false, error: "horário inválido" };
  const end = start + num(v.duracao_min, 60, 15, 240) * 60_000;
  const b = await busy(token, start, end);
  if (!b.ok) return b;
  if (b.list.some(([s, e]) => start < e && end > s)) return { ok: false, error: "horário ocupado" };
  const nome = String(input.name ?? v.nome ?? "").slice(0, 80) || "Cliente";
  const what = String(v.servico ?? v.assunto ?? "Atendimento").slice(0, 80);
  try {
    const res = await fetch(`${API}/calendars/primary/events`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: `${what} — ${nome}`,
        description: `Agendado pelo atendimento (Deixa com a IA).\nCliente: ${nome}\nTelefone: ${input.phone || "—"}`,
        start: { dateTime: new Date(start).toISOString(), timeZone: TZ },
        end: { dateTime: new Date(end).toISOString(), timeZone: TZ },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, error: `Google respondeu HTTP ${res.status}` };
    const d = await res.json();
    return { ok: true, vars: { evento_inicio: label(start), evento_link: String(d?.htmlLink ?? "").slice(0, 300) } };
  } catch {
    return { ok: false, error: "não consegui falar com o Google" };
  }
}
