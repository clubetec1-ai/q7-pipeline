import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Check, Loader2, PencilRuler, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MicTextarea } from "@/components/MicTextarea";
import { HowItWorks } from "./diagnostico/HowItWorks";

type Decisao = "fluxo" | "modelo" | "ia" | "pessoa";
interface Passo { n: number; o_que: string; quem_detalhe: string; ferramenta: string; prazo: string; decisao: Decisao; motivo: string }
interface Design {
  gatilho: string; objetivo: string; passos: Passo[]; excecoes: { quando: string; o_que_fazer: string }[];
  dados_cliente: { dado: string; sensivel: boolean }[]; base_legal: string; sla: string; indicadores: string[]; riscos: string[]; dono_do_processo: string;
}
interface Row { id: string; setor: string; nome: string; design: Design; status: "proposto" | "aprovado" | "arquivado"; version: number; architect_note: string | null; approved_at: string | null }
interface Narr { setor?: string; area?: string; nome: string }

const DECISAO: Record<Decisao, { label: string; cls: string; hint: string }> = {
  fluxo: { label: "Fluxo automático", cls: "bg-info-soft text-info-text", hint: "regra fixa, sem IA" },
  modelo: { label: "Modelo pronto", cls: "bg-info-soft text-info-text", hint: "mensagem ou automação pronta" },
  ia: { label: "IA", cls: "bg-primary/15 text-primary-text", hint: "a IA responde com a base de conhecimento" },
  pessoa: { label: "Pessoa", cls: "bg-warning-soft text-warning-text", hint: "decisão de uma pessoa da equipe" },
};
const key = (setor: string, nome: string) => `${setor.trim().toLowerCase()}|${nome.trim().toLowerCase()}`;

/**
 * Processos da empresa (desenho 07, fatia 3): cada processo contado no Diagnóstico ganha um desenho do
 * Arquiteto (IA) — passo a passo com a decisão de automação de cada passo — que o dono ou o responsável
 * da área aprova. O desenho só é gravado pelo servidor; aqui se lê, aprova, pede ajuste ou arquiva.
 */
export default function Processos() {
  const { org, can } = useOrg();
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [narr, setNarr] = useState<Narr[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const owner = can("org.settings");

  const load = useCallback(async () => {
    if (!org) return;
    const [{ data: d }, prof] = await Promise.all([
      supabase.from("process_designs").select("id, setor, nome, design, status, version, architect_note, approved_at").eq("organization_id", org.id).order("setor").order("nome"),
      owner ? supabase.from("company_profiles").select("processes").eq("organization_id", org.id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    setRows((d as unknown as Row[]) ?? []);
    setNarr(((prof.data?.processes as unknown as Narr[]) ?? []).filter((p) => p?.nome));
    setLoaded(true);
  }, [org, owner]);
  useEffect(() => { void load(); }, [load]);

  // Lista por setor: o que o dono contou no Diagnóstico + o que já tem desenho (o responsável só vê os desenhos).
  const bySetor = useMemo(() => {
    const m = new Map<string, { nome: string; row?: Row }[]>();
    const seen = new Set<string>();
    for (const r of rows) {
      seen.add(key(r.setor, r.nome));
      m.set(r.setor, [...(m.get(r.setor) ?? []), { nome: r.nome, row: r }]);
    }
    for (const p of narr) {
      const setor = (p.setor || p.area || "Sem setor").trim();
      if (seen.has(key(setor, p.nome))) continue;
      m.set(setor, [...(m.get(setor) ?? []), { nome: p.nome }]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows, narr]);

  const design = async (setor: string, nome: string) => {
    if (!org) return;
    setBusy(`d:${setor}|${nome}`);
    const r = await callFunction<{ id: string }>("architect", { action: "design", organization_id: org.id, setor, nome });
    setBusy(null);
    if (!r.ok) return toast({ variant: "destructive", title: "O Arquiteto não desenhou", description: r.message });
    toast({ title: "Desenho pronto", description: "Confira os passos e aprove." });
    setOpen(r.data.id);
    void load();
  };
  const designAll = async (setor: string, items: { nome: string; row?: Row }[]) => {
    for (const it of items.filter((x) => !x.row || x.row.status === "arquivado")) await design(setor, it.nome);
  };
  const approve = async (r: Row) => {
    setBusy(`a:${r.id}`);
    const { error } = await supabase.rpc("approve_process_design", { p_id: r.id });
    setBusy(null);
    if (error) return toast({ variant: "destructive", title: "Não aprovado", description: error.message });
    toast({ title: "Processo aprovado", description: "Ele já pode virar agentes e fluxos na implantação." });
    void load();
  };
  const askChange = async (r: Row) => {
    const t = (note[r.id] ?? "").trim();
    if (t.length < 5) return toast({ variant: "destructive", title: "Escreva ou fale o que mudar" });
    setBusy(`n:${r.id}`);
    const { error } = await supabase.rpc("set_process_design_note", { p_id: r.id, p_note: t });
    setBusy(null);
    if (error) return toast({ variant: "destructive", title: "Não salvo", description: error.message });
    setNote({ ...note, [r.id]: "" });
    await design(r.setor, r.nome); // o Arquiteto refaz já com o pedido
  };
  const archive = async (r: Row) => {
    if (!window.confirm(`Arquivar o processo "${r.nome}"? Ele sai da implantação (dá para desenhar de novo depois).`)) return;
    const { error } = await supabase.rpc("archive_process_design", { p_id: r.id });
    if (error) return toast({ variant: "destructive", title: "Não arquivado", description: error.message });
    void load();
  };

  const total = rows.filter((r) => r.status !== "arquivado").length;
  const aprovados = rows.filter((r) => r.status === "aprovado").length;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="configuracoes" />
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6 sm:px-6 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <Link to="/configuracoes" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"><ArrowLeft className="w-4 h-4" /> Configurações</Link>
            <h1 className="font-brand text-2xl leading-tight mt-1">Processos da empresa</h1>
            <p className="text-sm text-muted-foreground max-w-3xl">
              O <b>Arquiteto de processos (IA)</b> transforma cada processo que você contou no Diagnóstico em um passo a passo, e diz em cada passo
              se ele vira <b>fluxo automático</b>, <b>modelo pronto</b>, <b>IA</b> ou fica com uma <b>pessoa</b>. Você (ou o responsável da área) confere e aprova.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <HowItWorks guide="processos" className="" />
            <Button asChild variant="outline"><Link to="/organograma">Time de IA</Link></Button>
          </div>
        </div>

        {!loaded ? <Loader2 className="w-5 h-5 animate-spin" /> : bySetor.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Nenhum processo ainda. Conte os processos de cada setor no <Link to="/diagnostico" className="underline">Diagnóstico</Link> (etapa Processos) e volte aqui para o Arquiteto desenhar.
          </p>
        ) : (
          <>
            <p data-demo="resumo" className="text-sm">{aprovados} de {total} processo(s) desenhado(s) aprovado(s).</p>
            {bySetor.map(([setor, items]) => (
              <section key={setor} className="rounded-xl border bg-card p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-semibold">{setor}</h2>
                  {items.some((x) => !x.row) && (
                    <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void designAll(setor, items)}>
                      <PencilRuler className="w-4 h-4 mr-1" /> Desenhar os que faltam
                    </Button>
                  )}
                </div>
                {items.map(({ nome, row }) => {
                  const id = row?.id ?? `${setor}|${nome}`;
                  const isOpen = open === row?.id;
                  return (
                    <div key={id} data-demo="processo" className="rounded-lg border p-3 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <b className="mr-auto">{nome}</b>
                        {!row && <Badge variant="outline">Sem desenho</Badge>}
                        {row?.status === "proposto" && <Badge className="bg-warning-soft text-warning-text">Para aprovar</Badge>}
                        {row?.status === "aprovado" && <Badge className="bg-success-soft text-success-text">Aprovado · v{row.version}</Badge>}
                        {row?.status === "arquivado" && <Badge variant="outline">Arquivado</Badge>}
                        {row && row.status !== "arquivado" && (
                          <Button size="sm" variant="ghost" onClick={() => setOpen(isOpen ? null : row.id)}>{isOpen ? "Fechar" : "Ver desenho"}</Button>
                        )}
                        {(!row || row.status === "arquivado") && (
                          <Button size="sm" data-demo="btn-desenhar" disabled={!!busy} onClick={() => void design(setor, nome)}>
                            {busy === `d:${setor}|${nome}` ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <PencilRuler className="w-4 h-4 mr-1" />} Desenhar com o Arquiteto
                          </Button>
                        )}
                      </div>
                      {row && isOpen && <DesignView row={row} />}
                      {row && isOpen && row.status !== "arquivado" && (
                        <div className="space-y-2 border-t pt-2">
                          <div className="flex flex-wrap gap-2">
                            {row.status === "proposto" && (
                              <Button size="sm" data-demo="btn-aprovar" disabled={!!busy} onClick={() => void approve(row)}>
                                <Check className="w-4 h-4 mr-1" /> Aprovar processo
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => void archive(row)}>Arquivar</Button>
                          </div>
                          <p className="text-xs text-muted-foreground">Algo não está certo? Diga (ou fale) o que mudar e o Arquiteto refaz o desenho:</p>
                          {org && (
                            <MicTextarea orgId={org.id} rows={2} maxLength={800} value={note[row.id] ?? ""} onChange={(v) => setNote({ ...note, [row.id]: v })}
                              placeholder="Ex.: quem aprova o orçamento é o gerente, não o vendedor; o prazo é de 2 dias." />
                          )}
                          <Button size="sm" variant="outline" data-demo="btn-ajuste" disabled={!!busy || (note[row.id] ?? "").trim().length < 5} onClick={() => void askChange(row)}>
                            {busy === `d:${row.setor}|${row.nome}` ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null} Pedir ajuste e redesenhar
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            ))}
          </>
        )}
      </main>
    </div>
  );
}

function DesignView({ row }: { row: Row }) {
  const d = row.design;
  return (
    <div className="space-y-2 text-sm">
      {d.gatilho && <p><b>Começa quando:</b> {d.gatilho}</p>}
      {d.objetivo && <p><b>Objetivo:</b> {d.objetivo}</p>}
      <ol data-demo="passos" className="space-y-1.5">
        {d.passos.map((p) => (
          <li key={p.n} className="flex gap-2 rounded border p-2">
            <span className="text-muted-foreground">{p.n}.</span>
            <span className="min-w-0 flex-1">
              <span className="block">{p.o_que}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs">
                <span className={`rounded px-1.5 ${DECISAO[p.decisao].cls}`} title={DECISAO[p.decisao].hint}>{DECISAO[p.decisao].label}</span>
                {p.quem_detalhe && <span className="text-muted-foreground">· {p.quem_detalhe}</span>}
                {p.ferramenta && <span className="text-muted-foreground">· {p.ferramenta}</span>}
                {p.prazo && <span className="text-muted-foreground">· {p.prazo}</span>}
              </span>
              {p.motivo && <span className="block text-xs text-muted-foreground">Por quê: {p.motivo}</span>}
            </span>
          </li>
        ))}
      </ol>
      {d.excecoes.length > 0 && (
        <div><b>Casos diferentes:</b>
          <ul className="list-disc pl-5">{d.excecoes.map((e, i) => <li key={i}>Quando {e.quando}: {e.o_que_fazer}</li>)}</ul>
        </div>
      )}
      {d.dados_cliente.length > 0 && (
        <p><b>Dados do cliente:</b> {d.dados_cliente.map((x, i) => (
          <span key={i} className={`mr-1 inline-flex items-center gap-0.5 rounded px-1 text-xs ${x.sensivel ? "bg-danger-soft text-danger-text" : "bg-muted"}`}>
            {x.sensivel && <ShieldAlert className="h-3 w-3" />}{x.dado}{x.sensivel ? " (sensível)" : ""}
          </span>))}
          {d.base_legal && <span className="block text-xs text-muted-foreground">Base legal (LGPD): {d.base_legal}</span>}
        </p>
      )}
      {(d.sla || d.dono_do_processo) && <p className="text-xs text-muted-foreground">{d.sla && <>Prazo: {d.sla} · </>}{d.dono_do_processo && <>Responsável: {d.dono_do_processo}</>}</p>}
      {d.riscos.length > 0 && (
        <div className="rounded-md bg-warning-soft p-2 text-warning-text">
          <p className="flex items-center gap-1 font-medium"><AlertTriangle className="h-4 w-4" /> Atenção</p>
          <ul className="list-disc pl-5">{d.riscos.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}
      {row.architect_note && <p className="text-xs text-muted-foreground">Último ajuste pedido: {row.architect_note}</p>}
    </div>
  );
}
