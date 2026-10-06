import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, Plus, Sparkles } from "lucide-react";
import { callFunction } from "@/lib/callFunction";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { memberNames, type MemberName } from "@/lib/memberNames";
import { AppHeader } from "@/components/AppHeader";
import { SectionTabs } from "@/components/layout/SectionTabs";
import { NetworkPanel } from "./cerebro/NetworkPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { LIGHT, METRICS, fmt, metricsOf } from "./cerebro/metrics";
import { AreaActivityDetails } from "./cerebro/AreaActivity";

interface Goal { id: string; title: string; metric_key: string; direction: string; target: number; baseline: number | null; period: string; status: string; value: number | null; light: string }
interface AreaView {
  id: string; key: string; name: string; approver_id: string | null; approval_mode: string;
  metrics: Record<string, number>; previous: Record<string, number>; goals: Goal[];
  pending: { sugeridas: number; aprovadas: number; no_ar: number };
}
interface Overview { scope: "dono" | "responsavel"; areas: AreaView[] }
interface Pending { id: string; title: string; status: string; area_id: string | null; due_date: string | null; reminders: number; since: string; motivo: string }
const MOTIVO: Record<string, string> = {
  esperando_aprovacao: "Esperando aprovação", aprovada_sem_ir_ao_ar: "Aprovada, falta colocar no ar", prazo_vencido: "Prazo vencido",
};
interface Run {
  id: string; kind: string; status: string; started_at: string; error: string | null; calls: number;
  summary: { resumo?: string; prioridades?: { area_id?: string; area_key: string; titulo: string; por_que: string }[]; delegou?: { area_key: string; propostas: number }[]; propostas?: number } | null;
}
const RUN_STATUS: Record<string, string> = { ok: "Concluída", pulado: "Sem mudanças", erro: "Não concluiu", rodando: "Em andamento" };
const days = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 864e5));

function Delta({ k, now, before }: { k: string; now: unknown; before: unknown }) {
  const a = Number(now), b = Number(before);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return null;
  const up = a > b;
  const good = (METRICS[k]?.better ?? "up") === "up" ? up : !up;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return <span className={`inline-flex items-center text-xs ${good ? "text-success-text" : "text-danger-text"}`}><Icon className="w-3 h-3" />{fmt(k, b)}</span>;
}

/**
 * Cérebro (Resultados → Cérebro): a visão de CEO por área — números da semana × a
 * anterior, metas com semáforo (calculado no banco) e o que está esperando cada
 * responsável. O dono vê todas as áreas; o responsável, só as suas.
 */
export default function Cerebro() {
  const { org } = useOrg();
  const { toast } = useToast();
  const [ov, setOv] = useState<Overview | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [quota, setQuota] = useState(8);
  const [analyzing, setAnalyzing] = useState(false);
  const [mailOn, setMailOn] = useState(false);
  const [denied, setDenied] = useState(false);
  const [names, setNames] = useState<Map<string, MemberName>>(new Map());
  const [goalFor, setGoalFor] = useState<AreaView | null>(null);
  const [goal, setGoal] = useState({ title: "", metric: "", target: "", period: "semana" });

  const load = useCallback(async () => {
    if (!org) return;
    const { data, error } = await supabase.rpc("brain_overview", { org: org.id });
    if (error) { setDenied(true); return; }
    setOv(data as unknown as Overview);
    const { data: p } = await supabase.rpc("brain_pending", { org: org.id });
    setPending((p as unknown as Pending[]) ?? []);
    if ((data as unknown as Overview)?.scope === "dono") {
      const [{ data: r }, { data: m }] = await Promise.all([
        supabase.from("brain_runs").select("id, kind, status, started_at, error, calls, summary").eq("organization_id", org.id)
          .order("started_at", { ascending: false }).limit(10),
        supabase.from("org_modules").select("limits").eq("organization_id", org.id).eq("module", "gestao").maybeSingle(),
      ]);
      setRuns((r as unknown as Run[]) ?? []);
      const { data: o } = await supabase.from("organizations").select("settings").eq("id", org.id).maybeSingle();
      setMailOn(!!(o?.settings as { brain_email?: boolean } | null)?.brain_email);
      const lim = Number((m?.limits as { analises_mes?: number } | null)?.analises_mes);
      setQuota(Number.isFinite(lim) && lim > 0 ? lim : 8);
    }
    void memberNames(org.id).then(setNames);
  }, [org]);
  useEffect(() => { void load(); }, [load]);

  if (!org) return null;
  const owner = ov?.scope === "dono";

  const openGoal = (a: AreaView) => {
    const m = metricsOf(a.key)[0];
    setGoal({ title: "", metric: m, target: "", period: "semana" });
    setGoalFor(a);
  };
  const saveGoal = async () => {
    if (!goalFor) return;
    const info = METRICS[goal.metric];
    const { error } = await supabase.rpc("save_area_goal", {
      org: org.id, goal: null, area: goalFor.id, p_title: goal.title.trim() || `${info?.label ?? goal.metric}: ${goal.target}`,
      p_metric: goal.metric, p_direction: info?.better ?? "up", p_target: Number(goal.target), p_period: goal.period, p_ends: null,
    });
    if (error) return toast({ variant: "destructive", title: "Não salvou", description: error.message });
    toast({ title: "Meta criada", description: "O semáforo é calculado com os números reais do sistema." });
    setGoalFor(null);
    void load();
  };
  const nudge = async (p: Pending) => {
    const { error } = await supabase.rpc("nudge_improvement", { improvement: p.id });
    if (error) return toast({ variant: "destructive", title: "Não foi possível cobrar", description: error.message });
    toast({ title: "Cobrança enviada", description: "O responsável recebeu o aviso no sino." });
    void load();
  };
  const setDue = async (p: Pending, due: string) => {
    const { error } = await supabase.rpc("set_improvement_due", { improvement: p.id, due: due || null });
    if (error) return toast({ variant: "destructive", title: "Prazo não salvo", description: error.message });
    void load();
  };
  const toggleMail = async (on: boolean) => {
    const { data } = await supabase.from("organizations").select("settings").eq("id", org.id).maybeSingle();
    const next = { ...((data?.settings ?? {}) as Record<string, unknown>), brain_email: on };
    const { error } = await supabase.from("organizations").update({ settings: next as never }).eq("id", org.id);
    if (error) return toast({ variant: "destructive", title: "Não salvou", description: error.message });
    setMailOn(on);
    toast({ title: on ? "Você vai receber o cérebro por e-mail" : "E-mail do cérebro desligado" });
  };
  const analyze = async () => {
    setAnalyzing(true);
    const r = await callFunction<{ propostas: number; skipped: boolean }>("brain", { organization_id: org.id });
    setAnalyzing(false);
    if (!r.ok) return toast({ variant: "destructive", title: "Não foi possível analisar", description: r.message });
    toast({ title: "Análise pronta", description: r.data.propostas ? `${r.data.propostas} sugestão(ões) para aprovar.` : "Sem sugestões novas desta vez." });
    void load();
  };
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const used = runs.filter((r) => ["ok", "erro", "rodando"].includes(r.status) && new Date(r.started_at).getTime() >= monthStart).length;
  const latest = runs.find((r) => r.status === "ok");
  const areaOf = (id: string | undefined, k: string) => ov?.areas.find((a) => (id ? a.id === id : a.key === k))?.name ?? k;
  const areaName = (id: string | null) => ov?.areas.find((a) => a.id === id)?.name ?? "Sem área";
  const closeGoal = async (g: Goal) => {
    const { error } = await supabase.rpc("set_area_goal_status", { goal: g.id, new_status: "encerrada" });
    if (error) return toast({ variant: "destructive", title: "Não foi possível", description: error.message });
    void load();
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="cerebro" />
      <SectionTabs group="resultados" active="cerebro" />
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6 sm:px-6 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-brand text-2xl leading-tight">Cérebro</h1>
            <p className="text-sm text-muted-foreground max-w-3xl">
              Como cada área da empresa está nesta semana, as metas e o que está esperando aprovação. Os números vêm do
              sistema; as sugestões da IA chegam como propostas e só seguem com aprovação.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm"><Link to="/organograma">Time de IA</Link></Button>
            <Button asChild variant="outline" size="sm"><Link to="/processos">Processos</Link></Button>
          </div>
          {owner && org && <div className="w-full"><NetworkPanel orgId={org.id} /></div>}
          {owner && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer" title="Resumo da semana, metas fora do rumo e propostas paradas no seu e-mail">
                <input type="checkbox" className="h-3.5 w-3.5" checked={mailOn} onChange={(e) => void toggleMail(e.target.checked)} /> Receber por e-mail
              </label>
              <span className="text-xs text-muted-foreground">{used} de {quota} análises no mês</span>
              <Button asChild variant="outline"><Link to="/configuracoes/areas">Áreas e responsáveis</Link></Button>
              <Button disabled={analyzing || used >= quota || !ov?.areas.length} onClick={() => void analyze()}>
                <Sparkles className="w-4 h-4 mr-1" /> {analyzing ? "Analisando…" : "Analisar agora"}
              </Button>
            </div>
          )}
        </div>

        {denied && (
          <div className="rounded-xl border bg-card p-10 text-center">
            <p className="font-medium">Você não é responsável por nenhuma área</p>
            <p className="text-sm text-muted-foreground mt-1">O dono da empresa define os responsáveis em Configurações → Áreas e responsáveis.</p>
          </div>
        )}

        {ov && !ov.areas.length && (
          <div className="rounded-xl border bg-card p-10 text-center">
            <p className="font-medium">Nenhuma área ligada</p>
            <p className="text-sm text-muted-foreground mt-1">
              {owner ? <>Comece em <Link className="underline" to="/configuracoes/areas">Áreas e responsáveis</Link>: sugira as áreas pelos setores, escolha os responsáveis e ligue.</> : "Peça ao dono para ligar as áreas."}
            </p>
          </div>
        )}

        {owner && latest?.summary && (
          <section className="rounded-xl border bg-card p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Resumo da semana</h2>
              <span className="rounded-md bg-status-ia-soft text-status-ia-text px-2 py-0.5 text-xs font-medium">Sugestão da IA — a decisão é sua</span>
            </div>
            {latest.summary.resumo && <p className="text-sm whitespace-pre-wrap">{latest.summary.resumo}</p>}
            {!!latest.summary.prioridades?.length && (
              <ol className="space-y-1.5 list-decimal pl-5 text-sm">
                {latest.summary.prioridades.map((p, i) => (
                  <li key={i}><span className="font-medium">{p.titulo}</span> <span className="text-muted-foreground">· {areaOf(p.area_id, p.area_key)}{p.por_que ? ` — ${p.por_que}` : ""}</span></li>
                ))}
              </ol>
            )}
            <p className="text-xs text-muted-foreground">
              Análise de {new Date(latest.started_at).toLocaleDateString("pt-BR")}
              {latest.summary.propostas ? ` · ${latest.summary.propostas} sugestão(ões) enviada(s) aos responsáveis` : ""}
            </p>
          </section>
        )}

        {pending.length > 0 && (
          <section className="rounded-xl border bg-card p-5 space-y-3">
            <div>
              <h2 className="text-base font-semibold">Pendências</h2>
              <p className="text-xs text-muted-foreground">O sistema cobra sozinho a cada 3 dias; depois de 2 cobranças, avisa o dono.</p>
            </div>
            <ul className="divide-y">
              {pending.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${p.motivo === "prazo_vencido" ? "bg-danger-soft text-danger-text" : "bg-warning-soft text-warning-text"}`}>
                    {MOTIVO[p.motivo] ?? p.motivo}
                  </span>
                  <span className="flex-1 min-w-[12rem]">
                    <span className="font-medium">{p.title}</span>
                    <span className="block text-xs text-muted-foreground">{areaName(p.area_id)} · há {days(p.since)} dia(s) · {p.reminders} cobrança(s)</span>
                  </span>
                  <label className="text-xs text-muted-foreground flex items-center gap-1">
                    Prazo
                    <input type="date" className="h-8 rounded-md border bg-background px-2 text-xs" value={p.due_date ?? ""}
                      min={new Date().toISOString().slice(0, 10)} onChange={(e) => void setDue(p, e.target.value)} />
                  </label>
                  {owner && <Button size="sm" variant="outline" onClick={() => void nudge(p)}>Cobrar</Button>}
                  <Button asChild size="sm" variant="ghost"><Link to={`/melhorias?area=${p.area_id ?? ""}`}>Abrir</Link></Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {ov?.areas.map((a) => (
            <section key={a.id} className="rounded-xl border bg-card p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold">{a.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    Responsável: {a.approver_id ? names.get(a.approver_id)?.name ?? "—" : "só o dono"}{a.approval_mode === "dono" ? " · só o dono aprova" : ""}
                  </p>
                </div>
                <Link to={`/melhorias?area=${a.id}`} className="text-xs text-primary-text underline">
                  {a.pending.sugeridas} para aprovar · {a.pending.aprovadas} aprovada(s) · {a.pending.no_ar} no ar
                </Link>
              </div>

              <dl className="grid grid-cols-2 gap-3">
                {metricsOf(a.key).map((k) => (
                  <div key={k} className="rounded-lg bg-muted/50 px-3 py-2">
                    <dt className="text-xs text-muted-foreground">{METRICS[k]?.label ?? k}</dt>
                    <dd className="flex items-baseline gap-2">
                      <span className="font-brand text-xl tabular-nums">{fmt(k, a.metrics[k])}</span>
                      <Delta k={k} now={a.metrics[k]} before={a.previous[k]} />
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs text-muted-foreground -mt-2">Últimos 7 dias; a seta compara com os 7 dias anteriores.</p>

              <AreaActivityDetails orgId={org.id} areaId={a.id} />

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Metas</p>
                  {owner && <Button size="sm" variant="ghost" onClick={() => openGoal(a)}><Plus className="w-4 h-4 mr-1" /> Nova meta</Button>}
                </div>
                {!a.goals.length ? <p className="text-xs text-muted-foreground">Sem metas nesta área.</p> : (
                  <ul className="space-y-1.5">
                    {a.goals.map((g) => (
                      <li key={g.id} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${LIGHT[g.light]?.[1] ?? ""}`}>{LIGHT[g.light]?.[0] ?? g.light}</span>
                        <span className="flex-1 min-w-0 truncate">{g.title}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {fmt(g.metric_key, g.value)} de {g.direction === "down" ? "no máx. " : ""}{fmt(g.metric_key, g.target)} ({g.period === "mes" ? "30 dias" : "7 dias"})
                        </span>
                        {owner && <button className="text-xs text-muted-foreground underline" onClick={() => void closeGoal(g)}>encerrar</button>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ))}
        </div>
        {owner && runs.length > 0 && (
          <section className="rounded-xl border bg-card p-5 space-y-2">
            <h2 className="text-base font-semibold">Histórico de análises</h2>
            <ul className="divide-y text-sm">
              {runs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="w-28 text-muted-foreground">{new Date(r.started_at).toLocaleDateString("pt-BR")}</span>
                  <span className="w-20">{r.kind === "manual" ? "Manual" : "Semanal"}</span>
                  <span className={`rounded-md px-2 py-0.5 text-xs ${r.status === "ok" ? "bg-success-soft text-success-text" : r.status === "erro" ? "bg-danger-soft text-danger-text" : "bg-muted text-muted-foreground"}`}>
                    {RUN_STATUS[r.status] ?? r.status}
                  </span>
                  <span className="text-xs text-muted-foreground flex-1">
                    {r.status === "erro" ? r.error : r.summary?.propostas ? `${r.summary.propostas} sugestão(ões)` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <Dialog open={!!goalFor} onOpenChange={(o) => !o && setGoalFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova meta — {goalFor?.name}</DialogTitle>
            <DialogDescription>Escolha um indicador que o sistema já mede. O semáforo compara o número real com a meta.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">Indicador</span>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={goal.metric} onChange={(e) => setGoal({ ...goal, metric: e.target.value })}>
                {goalFor && metricsOf(goalFor.key).map((k) => <option key={k} value={k}>{METRICS[k]?.label ?? k}</option>)}
              </select>
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">{METRICS[goal.metric]?.better === "down" ? "No máximo" : "Pelo menos"}</span>
              <Input type="number" inputMode="decimal" value={goal.target} onChange={(e) => setGoal({ ...goal, target: e.target.value })} placeholder="Ex.: 20" />
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">Período</span>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={goal.period} onChange={(e) => setGoal({ ...goal, period: e.target.value })}>
                <option value="semana">Por semana (últimos 7 dias)</option>
                <option value="mes">Por mês (últimos 30 dias)</option>
              </select>
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">Nome da meta (opcional)</span>
              <Input value={goal.title} maxLength={160} onChange={(e) => setGoal({ ...goal, title: e.target.value })} placeholder="Ex.: Responder em até 5 minutos" />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGoalFor(null)}>Cancelar</Button>
            <Button disabled={goal.target === "" || !Number.isFinite(Number(goal.target))} onClick={() => void saveGoal()}>Criar meta</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
