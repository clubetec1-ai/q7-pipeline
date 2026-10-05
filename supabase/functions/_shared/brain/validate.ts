import { redact } from "../review.ts";
import { BRAIN_MODELS, kindsOf } from "./rules.ts";

/**
 * Validação da saída da IA do cérebro: tudo que não está nas listas fechadas cai fora,
 * números NUNCA vêm da IA (a evidência é refeita com o valor do pacote) e todo texto
 * é cortado e anonimizado. Proposta sem evidência válida é descartada (exceto processo
 * que existe no Diagnóstico).
 */
export interface PacketArea {
  id: string; key: string; nome: string; agente_ligado: boolean;
  indicadores: Record<string, number>; semana_anterior: Record<string, number>;
  metas: { id: string; titulo: string; indicador: string }[];
  processos: { nome: string }[];
}
export interface Packet { areas: PacketArea[] }

/** Pacote seguro para a IA: anonimiza todo texto (e-mail, telefone, CPF...) recursivamente; ids ficam. */
export function sanitizePacket<T>(v: T): T {
  if (typeof v === "string") return redact(v) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => sanitizePacket(x)) as unknown as T;
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, k === "id" ? x : sanitizePacket(x)])) as T;
  }
  return v;
}

const clip = (s: unknown, n: number) => redact(String(s ?? "").replace(/\s+/g, " ").trim()).slice(0, n);
/** Corta no fim da última frase que cabe (nada de texto parado no meio). */
const clipSentence = (s: unknown, n: number) => {
  const t = clip(s, n + 1);
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > 0 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…";
};
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
/** A IA às vezes responde a área pelo nome ou pelo tipo: aceita id, nome ou tipo (se só houver uma área daquele tipo). */
function areaResolver(areas: PacketArea[]) {
  const byId = new Map(areas.map((a) => [a.id, a]));
  const byName = new Map(areas.map((a) => [norm(a.nome), a]));
  const byKey = new Map<string, PacketArea[]>();
  for (const a of areas) byKey.set(a.key, [...(byKey.get(a.key) ?? []), a]);
  return (v: unknown): PacketArea | undefined => {
    const s = String(v ?? "");
    return byId.get(s) ?? byName.get(norm(s)) ?? (byKey.get(s)?.length === 1 ? byKey.get(s)![0] : undefined);
  };
}

export interface Orchestration {
  resumo: string;
  prioridades: { area_id: string; area_key: string; titulo: string; por_que: string; meta_id: string | null }[];
  delegar: string[];
  cobrar: string[];
}

// deno-lint-ignore no-explicit-any
export function validateOrchestration(raw: any, packet: Packet): Orchestration {
  const find = areaResolver(packet.areas);
  const goalIds = new Set(packet.areas.flatMap((a) => a.metas.map((m) => m.id)));
  const prioridades = (Array.isArray(raw?.prioridades) ? raw.prioridades : [])
    // deno-lint-ignore no-explicit-any
    .filter((p: any) => !!find(p?.area_id ?? p?.area_key ?? p?.area) && clip(p?.titulo, 120).length >= 3)
    .slice(0, 3)
    // deno-lint-ignore no-explicit-any
    .map((p: any) => ({
      area_id: find(p.area_id ?? p.area_key ?? p.area)!.id, area_key: find(p.area_id ?? p.area_key ?? p.area)!.key,
      titulo: clip(p.titulo, 120), por_que: clip(p.por_que, 300),
      meta_id: goalIds.has(String(p?.meta_id)) ? String(p.meta_id) : null,
    }));
  const asked: unknown[] = Array.isArray(raw?.delegar) ? raw.delegar : [];
  const delegar = [...new Set(asked.map((k) => find(k)).filter((a): a is PacketArea => !!a && a.agente_ligado).map((a) => a.id))].slice(0, 3);
  const cobrar = (Array.isArray(raw?.cobrar) ? raw.cobrar : []).map((c: unknown) => clip(c, 160)).filter(Boolean).slice(0, 5);
  return { resumo: clipSentence(raw?.resumo, 900), prioridades, delegar, cobrar };
}

export interface Proposal {
  titulo: string; problema: string; como: string; tipo: string; modelo: string | null; meta_id: string | null;
  evidencias: { indicador: string; valor: number | null; semana_anterior: number | null }[];
  processo: string | null; prioridade: number | null; prazo_dias: number | null;
}

// deno-lint-ignore no-explicit-any
export function validateProposals(raw: any, area: PacketArea): Proposal[] {
  const allowed = kindsOf(area.key);
  const goals = new Set(area.metas.map((m) => m.id));
  const procs = new Map(area.processos.map((p) => [p.nome.trim().toLowerCase(), p.nome]));
  const list = Array.isArray(raw?.propostas) ? raw.propostas : [];
  const out: Proposal[] = [];
  for (const p of list.slice(0, 6)) {
    const titulo = clip(p?.titulo, 160);
    if (titulo.length < 3) continue;
    const tipo = allowed.includes(String(p?.tipo)) ? String(p.tipo) : allowed[0];
    const modelo = Object.prototype.hasOwnProperty.call(BRAIN_MODELS, String(p?.modelo)) ? String(p.modelo) : null;
    // Evidência: só indicadores que existem no pacote desta área; o valor é o do pacote, nunca o da IA.
    const ev: unknown[] = Array.isArray(p?.evidencias) ? p.evidencias : [];
    const keys: string[] = [...new Set(ev.map((e) => {
      const o = e as { indicador?: unknown; metric_key?: unknown } | string;
      return String(typeof o === "string" ? o : o?.indicador ?? o?.metric_key ?? "");
    }))].filter((k) => Object.prototype.hasOwnProperty.call(area.indicadores, k)).slice(0, 4);
    const evidencias = keys.map((k) => ({
      indicador: k,
      valor: Number.isFinite(Number(area.indicadores[k])) ? Number(area.indicadores[k]) : null,
      semana_anterior: Number.isFinite(Number(area.semana_anterior?.[k])) ? Number(area.semana_anterior[k]) : null,
    }));
    const processo = procs.get(String(p?.processo ?? "").trim().toLowerCase()) ?? null;
    if (!evidencias.length && !(tipo === "processo" && processo)) continue;
    const pr = Number(p?.prioridade);
    const pd = Number(p?.prazo_dias);
    out.push({
      titulo, problema: clip(p?.problema, 600), como: clip(p?.como, 1500), tipo, modelo,
      meta_id: goals.has(String(p?.meta_id)) ? String(p.meta_id) : null, evidencias, processo,
      prioridade: Number.isInteger(pr) && pr >= 1 && pr <= 5 ? pr : null,
      prazo_dias: Number.isInteger(pd) && pd >= 1 && pd <= 60 ? pd : null,
    });
    if (out.length === 3) break;
  }
  return out;
}

/** Hash curto do pacote (pular a análise quando nada mudou). */
export async function packetHash(packet: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(packet));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
