import { useCallback, useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { useNavigate } from "react-router-dom";
import { BarChart3, Download, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { Logo } from "@/components/Logo";
import { MainNav } from "@/components/MainNav";
import { NumberHealthBanner } from "@/components/NumberHealthBanner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";

type Kind = "atendentes" | "operacao" | "qualidade" | "melhorias" | "comercial" | "ia";
type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const TABS: [Kind, string, boolean][] = [
  ["atendentes", "Atendentes", true], ["qualidade", "Qualidade", true], ["operacao", "Operação", false],
  ["melhorias", "Melhorias", false], ["comercial", "Comercial", false], ["ia", "IA e automação", false],
];
const PERIODS: [string, number][] = [["7 dias", 7], ["30 dias", 30], ["90 dias", 90]];
const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
// Indicadores em que MENOR é melhor (seta verde quando cai).
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
  campanhas: "Campanhas", nome: "Pessoa", setor: "Setor", motivo: "Motivo", falha: "Falha de processo", n: "Quantidade",
};
const fmt = (v: unknown) => (typeof v === "number" ? v.toLocaleString("pt-BR") : v == null ? "—" : String(v));

/** Relatórios por papel: dono/admin tudo; supervisor os setores dele; atendente só os próprios números. */
export default function Relatorios() {
  const { signOut } = useAuth();
  const { org, can } = useOrg();
  const { toast } = useToast();
  const navigate = useNavigate();
  const onlySelf = !can("org.settings") && !can("reports.view") && !can("conversations.view_all");
  const tabs = TABS.filter(([, , agent]) => agent || !onlySelf);
  const [kind, setKind] = useState<Kind>("atendentes");
  const [days, setDays] = useState(30);
  const [dept, setDept] = useState("");
  const [depts, setDepts] = useState<{ id: string; name: string }[]>([]);
  const [cur, setCur] = useState<Data | null>(null);
  const [prev, setPrev] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!org || onlySelf) return;
    void supabase.from("departments").select("id, name").eq("organization_id", org.id).order("name").then(({ data }) => setDepts(data ?? []));
  }, [org, onlySelf]);

  const load = useCallback(async () => {
    if (!org) return;
    const now = Date.now(), span = days * 86_400_000;
    const call = (from: number, to: number) => supabase.rpc("report", {
      org: org.id, kind, since: new Date(from).toISOString(), until: new Date(to).toISOString(), dept: dept || null,
    } as never);
    const [a, b] = await Promise.all([call(now - span, now), call(now - 2 * span, now - span)]);
    setError(a.error?.message ?? null);
    setCur((a.data as Data) ?? null);
    setPrev((b.data as Data) ?? null);
  }, [org, kind, days, dept]);
  useEffect(() => { void load(); }, [load]);

  const tableRows = useMemo(() => {
    if (!cur) return [] as Data[];
    if (kind === "atendentes") return (cur.linhas ?? []).map(({ user_id: _u, ...r }: Data) => r);
    if (kind === "operacao") return cur.por_setor ?? [];
    if (kind === "qualidade") return cur.por_setor ?? [];
    if (kind === "melhorias") return cur.resultados ?? [];
    if (kind === "comercial") return cur.funil ?? [];
    return [];
  }, [cur, kind]);

  if (!org) return null;

  const exportCsv = async () => {
    const rows: Data[] = tableRows.length ? tableRows : [cur?.resumo ?? cur ?? {}];
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((c) => typeof rows[0]?.[c] !== "object" || rows[0]?.[c] === null);
    const cell = (v: unknown) => { let s = v == null ? "" : String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
    const csv = "﻿" + [cols.map((c) => cell(LABEL[c] ?? c)).join(";"), ...rows.map((r) => cols.map((c) => cell(r[c])).join(";"))].join("\r\n");
    await supabase.rpc("log_report_export", { org: org.id, kind } as never);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    Object.assign(document.createElement("a"), { href: url, download: `relatorio-${kind}-${new Date().toISOString().slice(0, 10)}.csv` }).click();
    URL.revokeObjectURL(url);
    toast({ title: "Relatório exportado", description: "A exportação ficou registrada na auditoria." });
  };

  // Resumo: números do período com a variação contra o período anterior.
  const summary: Data = kind === "ia" || kind === "comercial"
    ? { ...(cur ?? {}), ...(cur?.cobrancas ?? {}), ...(cur?.campanhas ?? {}) }
    : (cur?.resumo ?? {});
  const prevSummary: Data = kind === "ia" || kind === "comercial"
    ? { ...(prev ?? {}), ...(prev?.cobrancas ?? {}), ...(prev?.campanhas ?? {}) }
    : (prev?.resumo ?? {});
  const cards = Object.entries(summary).filter(([k, v]) => typeof v === "number" && LABEL[k]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="relatorios" />
      <NumberHealthBanner />

      <main className="flex-1 w-full max-w-6xl mx-auto p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2"><BarChart3 className="w-6 h-6" /> Relatórios</h1>
            <p className="text-sm text-muted-foreground">
              {onlySelf ? "Seus números no período." : "Comparando com o período anterior de mesmo tamanho."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border overflow-hidden">
              {PERIODS.map(([l, d]) => (
                <button key={d} type="button" onClick={() => setDays(d)} className={`px-3 py-1.5 text-sm ${days === d ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{l}</button>
              ))}
            </div>
            {!onlySelf && (
              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={dept} onChange={(e) => setDept(e.target.value)}>
                <option value="">Todos os setores</option>
                {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!cur}><Download className="w-4 h-4 mr-1" /> CSV</Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 border-b">
          {tabs.map(([k, l]) => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className={`px-3 py-2 text-sm -mb-px border-b-2 ${kind === k ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{l}</button>
          ))}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {cards.length > 0 && (
          <section className="grid gap-3 grid-cols-2 md:grid-cols-4">
            {cards.map(([k, v]) => {
              const p = prevSummary[k];
              const diff = typeof p === "number" ? (v as number) - p : null;
              const good = diff !== null && diff !== 0 && (LOWER_BETTER.has(k) ? diff < 0 : diff > 0);
              return (
                <div key={k} className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{LABEL[k]}</p>
                  <p className="text-2xl font-semibold">{fmt(v)}</p>
                  {diff !== null && diff !== 0 && (
                    <p className={`text-xs ${good ? "text-emerald-600" : "text-red-600"}`}>{diff > 0 ? "▲" : "▼"} {fmt(Math.abs(Math.round(diff * 10) / 10))} vs. antes</p>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {kind === "operacao" && cur && (
          <section className="grid gap-4 md:grid-cols-2">
            <Bars title="Atendimentos por hora" values={cur.por_hora ?? []} labels={Array.from({ length: 24 }, (_, h) => `${h}h`)} />
            <Bars title="Atendimentos por dia da semana" values={cur.por_dia_semana ?? []} labels={DOW} />
            <List title="Motivos de finalização" rows={cur.motivos ?? []} k="motivo" />
          </section>
        )}
        {kind === "qualidade" && cur && (
          <section className="grid gap-4 md:grid-cols-2">
            <List title="Principais motivos de insatisfação" rows={cur.motivos_insatisfacao ?? []} k="motivo" />
            <List title="Falhas de processo mais frequentes" rows={cur.falhas_processo ?? []} k="falha" />
          </section>
        )}
        {kind === "comercial" && cur && (
          <Bars title="Funil (conversas em cada etapa agora)" values={(cur.funil ?? []).map((f: Data) => f.n)} labels={(cur.funil ?? []).map((f: Data) => f.etapa)} />
        )}

        {tableRows.length > 0 && (
          <section className="rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground border-b">
                {Object.keys(tableRows[0]).filter((c) => c !== "cor").map((c) => <th key={c} className="p-2 font-normal">{LABEL[c] ?? c}</th>)}
              </tr></thead>
              <tbody>
                {tableRows.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    {Object.entries(r).filter(([c]) => c !== "cor").map(([c, v]) => <td key={c} className="p-2">{fmt(v)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        {cur && !cards.length && !tableRows.length && <p className="text-sm text-muted-foreground">Sem dados no período.</p>}
      </main>
    </div>
  );
}

function Bars({ title, values, labels }: { title: string; values: number[]; labels: string[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="rounded-lg border p-3 space-y-2">
      <p className="text-sm font-medium">{title}</p>
      <div className="flex items-end gap-1 h-32">
        {values.map((v, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end h-full" title={`${labels[i]}: ${v}`}>
            <div className="w-full rounded-t bg-primary/70" style={{ height: `${(v / max) * 100}%`, minHeight: v ? 2 : 0 }} />
            <span className="text-xs text-muted-foreground mt-0.5 truncate w-full text-center">{labels[i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function List({ title, rows, k }: { title: string; rows: Data[]; k: string }) {
  return (
    <div className="rounded-lg border p-3 space-y-1">
      <p className="text-sm font-medium">{title}</p>
      {!rows.length && <p className="text-xs text-muted-foreground">Sem dados.</p>}
      {rows.map((r, i) => (
        <div key={i} className="flex justify-between gap-3 text-sm border-t py-1"><span className="min-w-0">{r[k]}</span><span className="font-medium">{r.n}</span></div>
      ))}
    </div>
  );
}
