import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, Bot, CheckCircle2, Clock, Hourglass, MessageSquare, type LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type J = Record<string, any>;
interface Period { op: J; ia: J }
const DAY = 86400_000;
const SCOPE: Record<string, string> = { all: "da empresa", dept: "do seu setor", self: "seus" };

async function fetchPeriod(orgId: string, from: Date, to: Date): Promise<Period | null> {
  const args = { org: orgId, since: from.toISOString(), until: to.toISOString() };
  const [op, ia] = await Promise.all([
    supabase.rpc("report", { ...args, kind: "operacao" }),
    supabase.rpc("report", { ...args, kind: "ia" }),
  ]);
  if (op.error || ia.error) return null;
  return { op: (op.data as J) ?? {}, ia: (ia.data as J) ?? {} };
}

/** Variação contra o período anterior; em tempo, cair é bom. */
function Delta({ now, before, lowerIsBetter = false }: { now: number | null; before: number | null; lowerIsBetter?: boolean }) {
  if (now == null || before == null || before === 0) return null;
  const pct = Math.round(((now - before) / before) * 100);
  if (!pct) return <span className="text-[11px] text-muted-foreground">= semana anterior</span>;
  const good = lowerIsBetter ? pct < 0 : pct > 0;
  const Icon = pct > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center text-[11px] font-medium ${good ? "text-emerald-600" : "text-red-600"}`}>
      <Icon className="w-3.5 h-3.5" />{Math.abs(pct)}%
    </span>
  );
}

function Kpi({ icon: Icon, color, label, value, suffix, delta }: { icon: LucideIcon; color: string; label: string; value: string; suffix?: string; delta?: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${color}22`, color }}><Icon className="w-5 h-5" /></span>
        {delta}
      </div>
      <div>
        <p className="text-2xl font-semibold leading-tight">{value}<span className="text-sm font-normal text-muted-foreground">{suffix}</span></p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

/**
 * Painel do Início: últimos 7 ou 30 dias contra o período anterior, no escopo de
 * quem vê (empresa, setor ou só os seus — a regra é do banco). Sem dados, some.
 */
export function Dashboard({ orgId }: { orgId: string }) {
  const [days, setDays] = useState(7);
  const [cur, setCur] = useState<Period | null>(null);
  const [prev, setPrev] = useState<Period | null>(null);
  const [colors, setColors] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    const now = new Date();
    void Promise.all([
      fetchPeriod(orgId, new Date(now.getTime() - days * DAY), now),
      fetchPeriod(orgId, new Date(now.getTime() - 2 * days * DAY), new Date(now.getTime() - days * DAY)),
      supabase.from("departments").select("name, color").eq("organization_id", orgId),
    ]).then(([c, p, d]) => {
      if (!alive) return;
      setCur(c); setPrev(p);
      setColors(Object.fromEntries((d.data ?? []).map((x) => [x.name, x.color ?? "#94A3B8"])));
    });
    return () => { alive = false; };
  }, [orgId, days]);

  if (!cur) return null;
  const r = cur.op.resumo ?? {};
  const pr = prev?.op.resumo ?? {};
  const total = Number(r.atendimentos ?? 0);
  const ia = Number(cur.ia.resolvidos_pela_ia ?? 0);
  const human = Number(cur.ia.passaram_para_humano ?? 0);
  const iaPct = ia + human ? Math.round((ia / (ia + human)) * 100) : 0;
  const hours: number[] = cur.op.por_hora ?? [];
  const maxH = Math.max(1, ...hours);
  const sectors: { setor: string; atendimentos: number }[] = cur.op.por_setor ?? [];
  const maxS = Math.max(1, ...sectors.map((x) => x.atendimentos));
  const fmtMin = (v: unknown) => (v == null ? "—" : String(v).replace(".", ","));

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-lg">Resultados {SCOPE[cur.op.escopo] ?? ""}</h2>
        <div className="flex rounded-lg border overflow-hidden text-xs">
          {[7, 30].map((d) => (
            <button key={d} type="button" onClick={() => setDays(d)} className={`px-3 py-1.5 ${days === d ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{d} dias</button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <Kpi icon={MessageSquare} color="#6C8EF5" label="Atendimentos" value={String(total)} delta={<Delta now={total} before={Number(pr.atendimentos ?? 0)} />} />
        <Kpi icon={CheckCircle2} color="#10B981" label="Finalizados" value={String(r.finalizados ?? 0)} delta={<Delta now={Number(r.finalizados ?? 0)} before={Number(pr.finalizados ?? 0)} />} />
        <Kpi icon={Bot} color="#8B5CF6" label="Resolvidos pela IA" value={String(ia)} suffix={ia + human ? ` · ${iaPct}%` : ""}
          delta={<Delta now={ia} before={Number(prev?.ia.resolvidos_pela_ia ?? 0)} />} />
        <Kpi icon={Clock} color="#3FB8BE" label="1ª resposta (média)" value={fmtMin(r.resposta_min)} suffix={r.resposta_min == null ? "" : " min"}
          delta={<Delta now={r.resposta_min ?? null} before={pr.resposta_min ?? null} lowerIsBetter />} />
        <Kpi icon={Hourglass} color="#F59E0B" label="Espera na fila (média)" value={fmtMin(r.fila_min)} suffix={r.fila_min == null ? "" : " min"}
          delta={<Delta now={r.fila_min ?? null} before={pr.fila_min ?? null} lowerIsBetter />} />
      </div>

      {total > 0 && (
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-xl border bg-card p-4 space-y-2 lg:col-span-2">
            <p className="text-sm font-medium">Atendimentos por hora</p>
            <div className="flex items-end gap-1 h-36">
              {hours.map((v, h) => (
                <div key={h} className="flex-1 flex flex-col items-center justify-end h-full" title={`${h}h: ${v}`}>
                  <div className="w-full rounded-t bg-primary/80 hover:bg-primary transition" style={{ height: `${(v / maxH) * 100}%`, minHeight: v ? 3 : 0 }} />
                  <span className="text-[9px] text-muted-foreground mt-0.5">{h % 3 === 0 ? `${h}h` : ""}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4 space-y-3">
            <p className="text-sm font-medium">IA × pessoas</p>
            <div className="flex items-center gap-4">
              <div className="w-24 h-24 rounded-full shrink-0 grid place-items-center"
                style={{ background: `conic-gradient(#8B5CF6 0 ${iaPct}%, hsl(var(--muted)) ${iaPct}% 100%)` }}>
                <div className="w-16 h-16 rounded-full bg-card grid place-items-center text-sm font-semibold">{iaPct}%</div>
              </div>
              <div className="text-xs space-y-1">
                <p><span className="inline-block w-2 h-2 rounded-full bg-[#8B5CF6] mr-1" />IA resolveu: <b>{ia}</b></p>
                <p><span className="inline-block w-2 h-2 rounded-full bg-muted-foreground mr-1" />Passou para pessoa: <b>{human}</b></p>
              </div>
            </div>
          </div>

          {sectors.length > 0 && (
            <div className="rounded-xl border bg-card p-4 space-y-2 lg:col-span-3">
              <div className="flex items-center justify-between"><p className="text-sm font-medium">Por setor</p><Link to="/relatorios" className="text-xs underline text-muted-foreground">Ver relatórios</Link></div>
              {sectors.slice(0, 8).map((x) => (
                <div key={x.setor} className="flex items-center gap-2 text-xs">
                  <span className="w-32 truncate">{x.setor}</span>
                  <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(x.atendimentos / maxS) * 100}%`, background: colors[x.setor] ?? "hsl(var(--primary))" }} />
                  </div>
                  <span className="w-8 text-right font-medium">{x.atendimentos}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {total === 0 && <p className="text-sm text-muted-foreground">Ainda sem atendimentos neste período — os números aparecem aqui assim que as conversas começarem.</p>}
    </section>
  );
}
