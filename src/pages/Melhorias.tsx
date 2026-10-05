import { SectionTabs } from "@/components/layout/SectionTabs";
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Navigate, useNavigate } from "react-router-dom";
import { LogOut, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { Logo } from "@/components/Logo";
import { MainNav } from "@/components/MainNav";
import { NumberHealthBanner } from "@/components/NumberHealthBanner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface Improvement {
  id: string; title: string; description: string | null; how: string | null; source: string; kind: string;
  modelo: string | null; department_id: string | null; status: string; artifact_kind: string | null; artifact_id: string | null;
  parent_id: string | null; version: number; measure_days: number; live_at: string | null; closed_at: string | null;
  metrics_before: Record<string, number> | null; metrics_after: Record<string, number> | null;
  result: string | null; result_note: string | null; created_at: string; area_id?: string | null;
}

const COLUMNS: [string, string][] = [["sugerida", "Para aprovar"], ["aprovada", "Aprovadas"], ["no_ar", "No ar — medindo"], ["resultado", "Resultados"]];
const SOURCE: Record<string, string> = { plano: "Planejamento", avaliacoes: "Avaliações", monitor: "Correção", manual: "Manual", cerebro: "Cérebro" };
const KIND: Record<string, string> = { automacao: "Automação", agente: "Agente de IA", processo: "Processo", integracao: "Integração" };
const RESULT: Record<string, [string, string]> = {
  funcionou: ["Funcionou", "bg-success-soft text-success-text"],
  nao_funcionou: ["Não funcionou", "bg-danger-soft text-danger-text"],
  inconclusivo: ["Inconclusivo", "bg-muted text-muted-foreground"],
};
const METRIC: [string, string, "up" | "down"][] = [
  ["atendimentos", "Atendimentos", "up"], ["satisfeitos_pct", "Satisfeitos (%)", "up"], ["nota_media", "Nota média", "up"],
  ["fila_min", "Fila (min)", "down"], ["resposta_min", "1ª resposta (min)", "down"], ["fluxo_execucoes", "Execuções do fluxo", "up"],
];

/**
 * Ciclo de melhoria contínua: sugerida → aprovada → no ar (medindo) → resultado.
 * Quem aprova: dono/admin, o supervisor do setor ou o responsável da área (Configurações →
 * Áreas e responsáveis). Nada vai ao ar sozinho.
 */
export default function Melhorias() {
  const { signOut } = useAuth();
  const { org, can } = useOrg();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [list, setList] = useState<Improvement[]>([]);
  const [depts, setDepts] = useState<{ id: string; name: string; color: string | null }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<{ title: string; description: string; how: string; kind: string; department: string } | null>(null);
  const [showDiscarded, setShowDiscarded] = useState(false);
  const [areas, setAreas] = useState<{ id: string; name: string }[]>([]);
  const [areaFilter, setAreaFilter] = useState("");
  const [loaded, setLoaded] = useState(false);
  const manage = can("org.settings");

  const load = useCallback(async () => {
    if (!org) return;
    const [i, d, a] = await Promise.all([
      supabase.from("improvements").select("*").eq("organization_id", org.id).order("created_at", { ascending: false }).limit(200),
      supabase.from("departments").select("id, name, color").eq("organization_id", org.id).order("name"),
      supabase.from("org_areas").select("id, name").eq("organization_id", org.id).order("name"),
    ]);
    setList((i.data as unknown as Improvement[]) ?? []);
    setDepts(d.data ?? []);
    setAreas(a.data ?? []);
    setLoaded(true);
  }, [org]);
  useEffect(() => { void load(); }, [load]);

  if (!org) return null;
  // Responsável de área (sem relatórios) também entra: vê só as propostas das suas áreas (RLS).
  if (!manage && !can("reports.view") && loaded && !areas.length) return <Navigate to="/" replace />;

  const fail = (title: string, description?: string) => toast({ variant: "destructive", title, description });
  const rpc = async (name: string, args: Record<string, unknown>, okTitle: string) => {
    const { error } = await supabase.rpc(name as never, args as never);
    if (error) { fail("Não foi possível", error.message); return false; }
    toast({ title: okTitle });
    await load();
    return true;
  };

  const approve = async (i: Improvement) => {
    setBusy(i.id);
    if (!(await rpc("approve_improvement", { improvement: i.id }, "Melhoria aprovada"))) return setBusy(null);
    // Com modelo pronto e sem rascunho ainda: o implementador instala em rascunho e liga à melhoria.
    if (i.modelo && !i.artifact_id && manage) {
      const r = await callFunction<{ kind: string; id: string }>("implementer", { action: "install", organization_id: org.id, template: i.modelo });
      if (r.ok && (r.data.kind === "flow" || r.data.kind === "record_type")) {
        await supabase.rpc("link_improvement_artifact", { improvement: i.id, akind: r.data.kind, aid: r.data.id });
        toast({ title: "Rascunho instalado", description: "Revise, publique e depois coloque a melhoria no ar." });
      }
    }
    setBusy(null);
    await load();
  };
  const goLive = async (i: Improvement) => {
    const d = window.prompt("Medir por quantos dias antes de dar o resultado? (7 a 60)", String(i.measure_days || 14));
    if (!d) return;
    setBusy(i.id);
    await rpc("set_improvement_live", { improvement: i.id, days: Number(d) || 14 }, "No ar — medição começou");
    setBusy(null);
  };
  const discard = async (i: Improvement) => {
    const reason = window.prompt(`Descartar "${i.title}"? Motivo (opcional):`, "");
    if (reason === null) return;
    await rpc("discard_improvement", { improvement: i.id, reason }, "Melhoria descartada");
  };
  const fix = async (i: Improvement) => {
    setBusy(i.id);
    const r = await callFunction("improvements", { action: "propose_fix", organization_id: org.id, improvement_id: i.id });
    setBusy(null);
    if (!r.ok) return fail(r.message);
    toast({ title: "Ajuste preparado pela IA", description: "Confira o novo passo a passo antes de aprovar." });
    await load();
  };
  const fromReviews = async () => {
    setBusy("reviews");
    const r = await callFunction<{ created: number; message?: string }>("improvements", { action: "from_reviews", organization_id: org.id });
    setBusy(null);
    if (!r.ok) return fail(r.message);
    toast({ title: r.data.created ? `${r.data.created} melhoria(s) sugerida(s)` : "Nada novo", description: r.data.message });
    await load();
  };
  const create = async () => {
    if (!form) return;
    const { error } = await supabase.rpc("create_improvement", {
      org: org.id, title: form.title, description: form.description, how: form.how, kind: form.kind, department: form.department || null,
    } as never);
    if (error) return fail("Não salvo", error.message);
    setForm(null);
    await load();
  };

  const deptName = (id: string | null) => depts.find((d) => d.id === id)?.name;
  const card = (i: Improvement) => (
    <div key={i.id} className="rounded-lg border bg-background p-3 space-y-2 text-sm">
      <div className="space-y-1">
        <p className="font-medium leading-snug">{i.title}</p>
        <div className="flex flex-wrap gap-1">
          <Badge variant="outline">{KIND[i.kind] ?? i.kind}</Badge>
          <Badge variant="secondary">{SOURCE[i.source] ?? i.source}{i.version > 1 ? ` · v${i.version}` : ""}</Badge>
          {deptName(i.department_id) && <Badge variant="outline">{deptName(i.department_id)}</Badge>}
          {i.area_id && areas.find((a) => a.id === i.area_id) && <Badge variant="outline">Área: {areas.find((a) => a.id === i.area_id)!.name}</Badge>}
        </div>
      </div>
      {i.description && <p className="text-muted-foreground whitespace-pre-wrap">{i.description.length > 280 ? `${i.description.slice(0, 280)}…` : i.description}</p>}
      {manage && areas.length > 0 && i.status !== "descartada" && i.status !== "resultado" && (
        <select className="h-8 w-full rounded-md border bg-background px-2 text-xs" value={i.area_id ?? ""} aria-label="Área que aprova"
          onChange={(e) => void rpc("set_improvement_area", { improvement: i.id, area: e.target.value || null }, e.target.value ? "Área definida: o responsável foi avisado" : "Sem área")}>
          <option value="">Sem área (só o dono aprova)</option>
          {areas.map((a) => <option key={a.id} value={a.id}>Área: {a.name}</option>)}
        </select>
      )}
      {i.how && <details><summary className="cursor-pointer text-xs">Como implementar</summary><p className="whitespace-pre-wrap text-xs mt-1">{i.how}</p></details>}
      {i.status === "no_ar" && i.live_at && (
        <p className="text-xs text-muted-foreground">
          No ar desde {new Date(i.live_at).toLocaleDateString("pt-BR")} · resultado em {new Date(new Date(i.live_at).getTime() + i.measure_days * 86_400_000).toLocaleDateString("pt-BR")}
        </p>
      )}
      {i.status === "resultado" && i.result && (
        <div className="space-y-1">
          <span className={`rounded-full px-2 text-xs ${RESULT[i.result][1]}`}>{RESULT[i.result][0]}</span>
          {i.result_note && <p className="text-xs">{i.result_note}</p>}
          <Compare before={i.metrics_before} after={i.metrics_after} />
        </div>
      )}
      <div className="flex flex-wrap gap-1 pt-1">
        {i.status === "sugerida" && <>
          <Button size="sm" disabled={busy === i.id} onClick={() => approve(i)}>{i.modelo && manage ? "Aprovar e instalar" : "Aprovar"}</Button>
          <Button size="sm" variant="outline" disabled={busy === i.id} onClick={() => fix(i)} title="A IA revisa o passo a passo com os números e avaliações recentes">
            <Sparkles className="w-3.5 h-3.5 mr-1" /> {busy === i.id ? "..." : "Ajustar com IA"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => discard(i)}>Descartar</Button>
        </>}
        {i.status === "aprovada" && <>
          {i.artifact_kind === "flow" && i.artifact_id && <Button size="sm" variant="outline" onClick={() => navigate(`/fluxos/${i.artifact_id}`)}>Abrir fluxo</Button>}
          <Button size="sm" disabled={busy === i.id} onClick={() => goLive(i)}>Colocar no ar</Button>
          <Button size="sm" variant="ghost" onClick={() => discard(i)}>Descartar</Button>
        </>}
        {i.status === "no_ar" && (
          <Button size="sm" variant="outline" onClick={() => rpc("close_improvement_now", { improvement: i.id }, "Medição encerrada")}>Encerrar medição agora</Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="melhorias" />
      <SectionTabs group="resultados" active="melhorias" />
      <NumberHealthBanner />

      <main className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2"><RefreshCw className="w-6 h-6" /> Melhorias</h1>
            <p className="text-sm text-muted-foreground">Ciclo contínuo: sugerida → aprovada → no ar (medindo) → resultado. Se não funcionar, a correção volta para aprovação.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy === "reviews"} onClick={fromReviews}>
              <Sparkles className="w-4 h-4 mr-1" /> {busy === "reviews" ? "Analisando..." : "Buscar melhorias nas avaliações"}
            </Button>
            <Button onClick={() => setForm({ title: "", description: "", how: "", kind: "processo", department: "" })}><Plus className="w-4 h-4 mr-1" /> Nova melhoria</Button>
          </div>
        </div>

        {form && (
          <section className="rounded-lg border p-4 space-y-2">
            <div className="flex items-center justify-between"><p className="font-medium">Nova melhoria</p>
              <Button variant="ghost" size="icon" onClick={() => setForm(null)}><X className="w-4 h-4" /></Button></div>
            <Input placeholder="O que melhorar (ex.: Confirmar agendamento um dia antes)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <Textarea rows={2} placeholder="Por quê (problema de hoje)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <Textarea rows={3} placeholder="Como implementar (passo a passo)" value={form.how} onChange={(e) => setForm({ ...form, how: e.target.value })} />
            <div className="flex flex-wrap gap-2">
              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                <option value="">Empresa toda</option>
                {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <Button className="ml-auto" disabled={form.title.trim().length < 2} onClick={create}>Salvar</Button>
            </div>
          </section>
        )}

        {areas.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Área:</span>
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)}>
              <option value="">Todas</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map(([st, label]) => {
            const items = list.filter((i) => i.status === st && (!areaFilter || i.area_id === areaFilter));
            return (
              <section key={st} className="rounded-lg bg-muted/40 p-2 space-y-2 min-h-[8rem]">
                <p className="text-sm font-semibold px-1">{label} <span className="text-muted-foreground font-normal">({items.length})</span></p>
                {items.map(card)}
                {!items.length && <p className="text-xs text-muted-foreground px-1">
                  {st === "sugerida" ? "Gere o planejamento no Diagnóstico ou busque nas avaliações." : "Nada aqui ainda."}</p>}
              </section>
            );
          })}
        </div>

        {list.some((i) => i.status === "descartada") && (
          <div>
            <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setShowDiscarded(!showDiscarded)}>
              {showDiscarded ? "Esconder" : "Ver"} descartadas ({list.filter((i) => i.status === "descartada").length})
            </button>
            {showDiscarded && <div className="grid gap-2 md:grid-cols-3 mt-2">{list.filter((i) => i.status === "descartada").map(card)}</div>}
          </div>
        )}
      </main>
    </div>
  );
}

/** Antes × depois, com seta verde quando melhorou. */
function Compare({ before, after }: { before: Record<string, number> | null; after: Record<string, number> | null }) {
  const rows = METRIC.filter(([k]) => before?.[k] !== undefined || after?.[k] !== undefined);
  if (!rows.length) return null;
  return (
    <table className="w-full text-xs">
      <thead><tr className="text-muted-foreground text-left"><th className="font-normal">Indicador</th><th className="font-normal">Antes</th><th className="font-normal">Depois</th></tr></thead>
      <tbody>
        {rows.map(([k, label, good]) => {
          const b = before?.[k], a = after?.[k];
          const better = a !== undefined && b !== undefined && (good === "up" ? a > b : a < b);
          const worse = a !== undefined && b !== undefined && (good === "up" ? a < b : a > b);
          return (
            <tr key={k} className="border-t">
              <td className="py-0.5">{label}</td><td>{b ?? "—"}</td>
              <td className={better ? "text-emerald-600 font-medium" : worse ? "text-red-600 font-medium" : ""}>{a ?? "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
