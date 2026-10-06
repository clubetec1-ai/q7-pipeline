/**
 * Cobertura do Diagnóstico (desenho 07, fatia 1): o que a IA avaliou sobre cada item que os agentes
 * precisam saber. A lista é fechada (a do especialista da etapa): item e porquê vêm sempre da lista,
 * nunca da IA; o que a IA não avaliou, ou avaliou com status estranho, fica "faltando".
 */
import type { Specialist } from "./specialists.ts";

export type CoverageStatus = "completo" | "incompleto" | "faltando";
export interface CoverageItem { n: number; item: string; porque: string; status: CoverageStatus; nota: string }

const STATUS = new Set<CoverageStatus>(["completo", "incompleto", "faltando"]);

export function parseCoverage(raw: unknown, spec: Specialist): CoverageItem[] {
  const got = new Map<number, { status: CoverageStatus; nota: string }>();
  for (const x of Array.isArray(raw) ? raw : []) {
    const o = (x ?? {}) as Record<string, unknown>;
    const n = Number(o.n);
    const st = String(o.status ?? "") as CoverageStatus;
    if (Number.isInteger(n) && n >= 1 && n <= spec.precisa.length && STATUS.has(st)) {
      got.set(n, { status: st, nota: String(o.nota ?? "").trim().slice(0, 300) });
    }
  }
  return spec.precisa.map((need, i) => ({
    n: i + 1, item: need.item, porque: need.porque,
    status: got.get(i + 1)?.status ?? "faltando", nota: got.get(i + 1)?.nota ?? "",
  }));
}
