import { esc } from "./email.ts";

/**
 * Formato dos relatórios fora da tela (e-mail). Mesmos nomes e regras de
 * src/pages/Relatorios.tsx — se mudar um rótulo lá, mude aqui também.
 */
// deno-lint-ignore no-explicit-any
type Data = Record<string, any>;

export const KIND_LABEL: Record<string, string> = {
  atendentes: "Atendentes", qualidade: "Qualidade", operacao: "Operação",
  melhorias: "Melhorias", comercial: "Comercial", ia: "IA e automação",
};
const LOWER_BETTER = new Set(["fila_min", "fila_max_min", "resposta_min", "duracao_min", "insatisfeitos", "transferencias", "nao_funcionou",
  "dias_ate_aprovar", "em_atraso", "valor_em_atraso", "falhas", "passaram_para_humano"]);
const LABEL: Record<string, string> = {
  atendimentos: "Atendimentos", finalizados: "Finalizados", fila_min: "Fila média (min)", fila_max_min: "Maior espera (min)",
  resposta_min: "1ª resposta (min)", duracao_min: "Duração (min)", transferencias: "Transferências", transbordos: "Pedidos de ajuda (transbordo)",
  so_ia: "Resolvidos só pela IA", avaliados: "Avaliados", satisfeitos_pct: "Satisfeitos (%)", insatisfeitos: "Insatisfeitos", nota: "Nota média",
  sugeridas: "Sugeridas", aprovadas: "Aprovadas", no_ar: "No ar", funcionou: "Funcionaram", nao_funcionou: "Não funcionaram",
  inconclusivo: "Inconclusivas", correcoes: "Correções geradas", dias_ate_aprovar: "Dias até aprovar", resolvidos_pela_ia: "Resolvidos pela IA",
  passaram_para_humano: "Passaram para humano", respostas_da_ia: "Respostas da IA", midias_lidas: "Imagens/PDFs lidos",
  base_documentos: "Documentos na base", avaliacoes_automaticas: "Avaliações automáticas", novos_contatos: "Novos contatos",
  emitidas: "Cobranças emitidas", valor_emitido: "Valor emitido (R$)", pagas: "Pagas", valor_recebido: "Recebido (R$)",
  em_atraso: "Em atraso", valor_em_atraso: "Valor em atraso (R$)", enviados: "Mensagens enviadas", falhas: "Falhas", fora_da_lista: "Fora da lista (opt-out)",
  campanhas: "Campanhas", nome: "Pessoa", setor: "Setor", motivo: "Motivo", falha: "Falha de processo", n: "Quantidade", etapa: "Etapa",
};
const fmt = (v: unknown) => (typeof v === "number" ? v.toLocaleString("pt-BR") : v == null ? "—" : String(v));

export function summaryOf(kind: string, d: Data | null): Data {
  if (!d) return {};
  return kind === "ia" || kind === "comercial" ? { ...d, ...(d.cobrancas ?? {}), ...(d.campanhas ?? {}) } : (d.resumo ?? {});
}
export function rowsOf(kind: string, d: Data | null): Data[] {
  if (!d) return [];
  if (kind === "atendentes") return (d.linhas ?? []).map(({ user_id: _u, ...r }: Data) => r);
  if (kind === "operacao" || kind === "qualidade") return d.por_setor ?? [];
  if (kind === "melhorias") return d.resultados ?? [];
  if (kind === "comercial") return d.funil ?? [];
  return [];
}

/** Um bloco (HTML e texto) por tipo de relatório, com a variação contra o período anterior. */
export function renderSection(kind: string, cur: Data | null, prev: Data | null): { html: string; text: string } {
  const s = summaryOf(kind, cur), p = summaryOf(kind, prev);
  const cards = Object.entries(s).filter(([k, v]) => typeof v === "number" && LABEL[k]);
  const lines: string[] = [], cells: string[] = [];
  for (const [k, v] of cards) {
    const before = p[k];
    const diff = typeof before === "number" ? (v as number) - before : 0;
    const good = diff !== 0 && (LOWER_BETTER.has(k) ? diff < 0 : diff > 0);
    const arrow = diff ? `${diff > 0 ? "▲" : "▼"} ${fmt(Math.abs(Math.round(diff * 10) / 10))}` : "";
    lines.push(`- ${LABEL[k]}: ${fmt(v)}${arrow ? ` (${arrow} vs. antes)` : ""}`);
    cells.push(`<td style="padding:8px;border:1px solid #e2e8f0;vertical-align:top"><div style="font-size:12px;color:#64748b">${esc(LABEL[k])}</div>` +
      `<div style="font-size:20px;font-weight:600">${esc(fmt(v))}</div>` +
      (arrow ? `<div style="font-size:12px;color:${good ? "#059669" : "#dc2626"}">${esc(arrow)} vs. antes</div>` : "") + `</td>`);
  }
  const grid = cells.length
    ? `<table style="border-collapse:collapse;width:100%">${chunk(cells, 3).map((r) => `<tr>${r.join("")}</tr>`).join("")}</table>`
    : `<p style="color:#64748b">Sem dados no período.</p>`;

  const rows = rowsOf(kind, cur).slice(0, 10);
  let table = "";
  if (rows.length) {
    const cols = Object.keys(rows[0]).filter((c) => c !== "cor" && (typeof rows[0][c] !== "object" || rows[0][c] === null));
    table = `<table style="border-collapse:collapse;width:100%;margin-top:8px;font-size:13px"><tr>` +
      cols.map((c) => `<th style="text-align:left;padding:4px 6px;border-bottom:1px solid #cbd5e1;color:#64748b;font-weight:normal">${esc(LABEL[c] ?? c)}</th>`).join("") + `</tr>` +
      rows.map((r) => `<tr>${cols.map((c) => `<td style="padding:4px 6px;border-bottom:1px solid #f1f5f9">${esc(fmt(r[c]))}</td>`).join("")}</tr>`).join("") + `</table>`;
    lines.push(...rows.map((r) => "  · " + cols.map((c) => `${LABEL[c] ?? c}: ${fmt(r[c])}`).join(" | ")));
  }
  const title = KIND_LABEL[kind] ?? kind;
  return {
    html: `<h3 style="margin:20px 0 8px;font-size:16px">${esc(title)}</h3>${grid}${table}`,
    text: `${title}\n${lines.length ? lines.join("\n") : "Sem dados no período."}`,
  };
}

function chunk<T>(a: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}
