import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { memberNames, type MemberName } from "@/lib/memberNames";
import { AppHeader } from "@/components/AppHeader";
import { SectionTabs } from "@/components/layout/SectionTabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { LIGHT, METRICS, fmt, metricsOf } from "./cerebro/metrics";

interface Goal { id: string; title: string; metric_key: string; direction: string; target: number; baseline: number | null; period: string; status: string; value: number | null; light: string }
interface AreaView {
  id: string; key: string; name: string; approver_id: string | null; approval_mode: string;
  metrics: Record<string, number>; previous: Record<string, number>; goals: Goal[];
  pending: { sugeridas: number; aprovadas: number; no_ar: number };
}
interface Overview { scope: "dono" | "responsavel"; areas: AreaView[] }

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
  const [denied, setDenied] = useState(false);
  const [names, setNames] = useState<Map<string, MemberName>>(new Map());
  const [goalFor, setGoalFor] = useState<AreaView | null>(null);
  const [goal, setGoal] = useState({ title: "", metric: "", target: "", period: "semana" });

  const load = useCallback(async () => {
    if (!org) return;
    const { data, error } = await supabase.rpc("brain_overview", { org: org.id });
    if (error) { setDenied(true); return; }
    setOv(data as unknown as Overview);
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
          {owner && <Button asChild variant="outline"><Link to="/configuracoes/areas">Áreas e responsáveis</Link></Button>}
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
