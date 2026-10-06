/**
 * Revisão de área do Diagnóstico (desenho 07, fatia 2): o diretor da área confere a etapa organizada
 * contra as etapas já aprovadas e aponta incoerências, riscos e lacunas críticas. A saída da IA é dado:
 * só tipos, gravidades e etapas das listas fechadas; no máximo 5 itens.
 */
export type FindingType = "incoerencia" | "risco" | "lacuna_critica";
export type FindingLevel = "critica" | "media" | "baixa";
export interface Finding { n: number; tipo: FindingType; gravidade: FindingLevel; texto: string; etapas: string[]; sugestao: string }

const TIPOS = new Set<FindingType>(["incoerencia", "risco", "lacuna_critica"]);
const NIVEIS = new Set<FindingLevel>(["critica", "media", "baixa"]);
const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

export function parseFindings(raw: unknown, stageKeys: string[]): Finding[] {
  const keys = new Set(stageKeys);
  const out: Finding[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    if (out.length >= 5) break;
    const o = (x ?? {}) as Record<string, unknown>;
    const tipo = String(o.tipo ?? "") as FindingType;
    const texto = clip(o.texto, 400);
    if (!TIPOS.has(tipo) || !texto) continue;
    const g = String(o.gravidade ?? "") as FindingLevel;
    out.push({
      n: out.length + 1, tipo, gravidade: NIVEIS.has(g) ? g : "media", texto,
      etapas: (Array.isArray(o.etapas) ? o.etapas : []).map((e) => String(e)).filter((e) => keys.has(e)).slice(0, 4),
      sugestao: clip(o.sugestao, 300),
    });
  }
  return out;
}
