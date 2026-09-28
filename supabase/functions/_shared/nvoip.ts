import { getSecret } from "./secrets.ts";

/**
 * Nvoip API v3 (OAuth 2.0 client_credentials). Credencial por empresa no Vault:
 * org:<id>:nvoip_client_id / org:<id>:nvoip_client_secret. Token só em memória.
 * Os campos das respostas não vêm documentados: a leitura aceita os nomes mais
 * comuns e a ação "testar" devolve só os NOMES dos campos (nunca valores).
 */
export const NVOIP_BASE = "https://api.nvoip.com.br/v3";
const tokens = new Map<string, { token: string; until: number }>();

export class NvoipError extends Error {}

// deno-lint-ignore no-explicit-any
export async function nvoipToken(admin: any, orgId: string): Promise<string> {
  const hit = tokens.get(orgId);
  if (hit && hit.until > Date.now()) return hit.token;
  const [id, secret] = await Promise.all([
    getSecret(admin, `org:${orgId}:nvoip_client_id`),
    getSecret(admin, `org:${orgId}:nvoip_client_secret`),
  ]);
  if (!id || !secret) throw new NvoipError("Credencial da Nvoip não configurada");
  const res = await fetch(`${NVOIP_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${id}:${secret}`)}` },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json().catch(() => ({}));
  const token = body?.access_token;
  if (!res.ok || !token) throw new NvoipError(`Nvoip recusou a credencial (${res.status})`);
  const ttl = Math.max(60, Number(body?.expires_in) || 3000) - 60;
  tokens.set(orgId, { token, until: Date.now() + ttl * 1000 });
  return token;
}

export async function nvoipFetch(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${NVOIP_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.message ?? body?.error_description ?? body?.error ?? `HTTP ${res.status}`;
    throw new NvoipError(`Nvoip: ${String(msg).slice(0, 160)}`);
  }
  return body;
}

/** Número para a Nvoip: DDD + número, sem 55 (celular ou fixo). */
export function nationalNumber(raw: string) {
  const d = raw.replace(/\D/g, "").replace(/^0+/, "");
  return (d.length === 12 || d.length === 13) && d.startsWith("55") ? d.slice(2) : d;
}

// deno-lint-ignore no-explicit-any
type Any = Record<string, any>;
const pick = (o: Any, keys: string[]) => {
  for (const k of keys) if (o?.[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  return undefined;
};
const toDate = (v: unknown) => {
  if (v === undefined || v === null || v === "") return null;
  const d = typeof v === "number" ? new Date(v > 1e12 ? v : v * 1000) : new Date(String(v).replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Lista do histórico, venha como array ou dentro de data/calls/items. */
export function historyItems(body: unknown): Any[] {
  if (Array.isArray(body)) return body as Any[];
  const b = body as Any;
  for (const k of ["data", "calls", "items", "history", "results"]) {
    if (Array.isArray(b?.[k])) return b[k];
    if (Array.isArray(b?.[k]?.items)) return b[k].items;
  }
  return [];
}

export interface NormalizedCall {
  id: string; direction: "in" | "out"; phone: string; ext: string; status: "answered" | "missed" | "ended" | "failed";
  started_at: string | null; answered_at: string | null; ended_at: string | null; duration: number | null; recording: string | null;
}

/** Converte um item do histórico. Sem id ou sem número, devolve null (não grava). */
export function normalizeCall(it: Any, extNumbers: Set<string>): NormalizedCall | null {
  const id = pick(it, ["callId", "call_id", "id", "uuid", "uniqueid", "uniqueId"]);
  const caller = String(pick(it, ["caller", "from", "origem", "source", "src", "numberSip", "numbersip"]) ?? "").replace(/\D/g, "");
  const called = String(pick(it, ["called", "to", "destino", "destination", "dst"]) ?? "").replace(/\D/g, "");
  const typ = String(pick(it, ["direction", "type", "callType", "tipo"]) ?? "").toLowerCase();
  let direction: "in" | "out" = /in|entr|receb|received/.test(typ) ? "in" : /out|sa[ií]|made|efetu/.test(typ) ? "out" : "out";
  if (!typ) direction = extNumbers.has(called) && !extNumbers.has(caller) ? "in" : "out";
  const phone = direction === "in" ? caller : called;
  const ext = direction === "in" ? called : caller;
  if (!id || phone.length < 2) return null;
  const st = String(pick(it, ["status", "state", "disposition", "situacao"]) ?? "").toLowerCase();
  const duration = Number(pick(it, ["duration", "talkingDurationSeconds", "billsec", "durationSeconds", "duracao"]) ?? NaN);
  const answered = /answer|atend|complet|finaliz|finish|ended|hangup/.test(st) || duration > 0;
  const failed = /fail|erro|busy|ocupad|invalid/.test(st);
  const status = answered ? "ended" : failed ? (direction === "in" ? "missed" : "failed") : direction === "in" ? "missed" : "failed";
  const started = toDate(pick(it, ["startedAt", "started_at", "date", "createdAt", "created_at", "datetime", "data", "calldate"]));
  const ended = toDate(pick(it, ["endedAt", "ended_at", "finishedAt"]));
  const answeredAt = toDate(pick(it, ["answeredAt", "answered_at"]));
  const rec = pick(it, ["recording", "recordingUrl", "recording_url", "linkAudio", "audio", "record", "gravacao"]);
  return {
    id: String(id), direction, phone, ext, status,
    started_at: started, answered_at: answeredAt, ended_at: ended ?? (started && duration > 0 ? new Date(new Date(started).getTime() + duration * 1000).toISOString() : null),
    duration: Number.isFinite(duration) ? Math.round(duration) : null,
    recording: typeof rec === "string" && /^https:\/\//.test(rec) ? rec : null,
  };
}

/** Data de hoje (e de ontem) no horário de Brasília, AAAA-MM-DD. */
export function brDate(daysAgo = 0) {
  const d = new Date(Date.now() - 3 * 3600_000 - daysAgo * 86400_000);
  return d.toISOString().slice(0, 10);
}
