import { useCallback, useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Navigate, useNavigate } from "react-router-dom";
import { ClipboardCheck, LogOut, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { memberNames } from "@/lib/memberNames";
import { Logo } from "@/components/Logo";
import { MainNav } from "@/components/MainNav";
import { NumberHealthBanner } from "@/components/NumberHealthBanner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

interface Review {
  id: string; ticket_id: string; agent_id: string | null; status: string; satisfied: string | null; score: number | null;
  reason: string | null; agent_feedback: string | null; process_issues: { falha: string; sugestao: string }[];
  created_at: string; reviewed_at: string | null;
}

const SAT: Record<string, { label: string; cls: string }> = {
  sim: { label: "Satisfeito", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  nao: { label: "Insatisfeito", cls: "bg-red-500/15 text-red-700 dark:text-red-400" },
  indefinido: { label: "Indefinido", cls: "bg-muted text-muted-foreground" },
};

/**
 * Avaliação automática dos atendimentos: a pessoa vê as dela; a supervisão vê a
 * equipe (a RLS limita) e gera o relatório de melhorias. Dono/admin liga ou desliga.
 */
export default function Avaliacoes() {
  const { signOut } = useAuth();
  const { org, can } = useOrg();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Review[]>([]);
  const [protocols, setProtocols] = useState<Map<string, string>>(new Map());
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const supervise = can("reports.view");

  const load = useCallback(async () => {
    if (!org) return;
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [{ data }, { data: o }] = await Promise.all([
      supabase.from("ticket_reviews").select("id, ticket_id, agent_id, status, satisfied, score, reason, agent_feedback, process_issues, created_at, reviewed_at")
        .eq("organization_id", org.id).gte("created_at", since).order("created_at", { ascending: false }).limit(300),
      supabase.from("organizations").select("settings").eq("id", org.id).maybeSingle(),
    ]);
    const list = (data as unknown as Review[]) ?? [];
    setRows(list);
    setEnabled(((o?.settings ?? {}) as Record<string, unknown>).auto_review === true);
    const ids = [...new Set(list.map((r) => r.ticket_id))];
    if (ids.length) {
      const { data: t } = await supabase.from("tickets").select("id, protocol").in("id", ids);
      setProtocols(new Map((t ?? []).map((x) => [x.id, x.protocol])));
    }
    const people = [...new Set(list.map((r) => r.agent_id).filter(Boolean))] as string[];
    const m = await memberNames(org.id, people);
    setNames(new Map([...m].map(([k, v]) => [k, v.name])));
  }, [org]);
  useEffect(() => { void load(); }, [load]);

  const done = useMemo(() => rows.filter((r) => r.status === "done"), [rows]);
  const stats = (list: Review[]) => ({
    n: list.length,
    sat: list.length ? Math.round((list.filter((r) => r.satisfied === "sim").length / list.length) * 100) : 0,
    avg: list.length ? (list.reduce((a, r) => a + (r.score ?? 0), 0) / list.length).toFixed(1) : "—",
  });
  const total = stats(done);
  const byAgent = useMemo(() => {
    const g = new Map<string, Review[]>();
    for (const r of done) if (r.agent_id) g.set(r.agent_id, [...(g.get(r.agent_id) ?? []), r]);
    return [...g].map(([id, list]) => ({ id, name: names.get(id) ?? "—", ...stats(list) })).sort((a, b) => b.n - a.n);
  }, [done, names]);

  if (!org) return null;
  if (!can("conversations.attend") && !supervise) return <Navigate to="/" replace />;

  const toggle = async (v: boolean) => {
    const { error } = await supabase.rpc("set_auto_review", { org: org.id, enabled: v });
    if (error) return toast({ variant: "destructive", title: "Não foi possível alterar" });
    setEnabled(v);
    toast({ title: v ? "Avaliação automática ligada" : "Avaliação automática desligada",
      description: v ? "Avise a equipe: os atendimentos finalizados serão avaliados pela IA." : undefined });
  };
  const makeReport = async () => {
    setBusy(true);
    const r = await callFunction<{ report: string | null; count: number }>("reviews-report", { organization_id: org.id, days: 30 });
    setBusy(false);
    if (!r.ok) return toast({ variant: "destructive", title: r.message });
    setReport(r.data.report ?? "Ainda não há avaliações concluídas nos últimos 30 dias.");
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="avaliacoes" />
      <NumberHealthBanner />

      <main className="flex-1 w-full max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2"><ClipboardCheck className="w-6 h-6" /> Avaliações</h1>
            <p className="text-sm text-muted-foreground">
              {supervise ? "Como os clientes saíram dos atendimentos, nota e feedback de cada pessoa (últimos 30 dias)."
                : "Suas avaliações: nota e dicas de melhoria de cada atendimento finalizado (últimos 30 dias)."}
            </p>
          </div>
          {can("org.settings") && enabled !== null && (
            <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              <Switch checked={enabled} onCheckedChange={toggle} />
              Avaliação automática {enabled ? "ligada" : "desligada"}
            </label>
          )}
        </div>
        {can("org.settings") && enabled === false && (
          <p className="text-sm rounded-md bg-muted p-3">
            Ao ligar, cada atendimento finalizado por uma pessoa é lido pela IA da empresa (Fluxos → Chaves de IA), que dá a
            nota, diz se o cliente saiu satisfeito e sugere melhorias. Só a análise fica guardada. Avise a equipe antes de ligar.
          </p>
        )}

        <section className="grid gap-3 grid-cols-3">
          {[["Avaliados", String(total.n)], ["Clientes satisfeitos", total.n ? `${total.sat}%` : "—"], ["Nota média", String(total.avg)]].map(([k, v]) => (
            <div key={k} className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">{k}</p><p className="text-2xl font-semibold">{v}</p></div>
          ))}
        </section>

        {supervise && byAgent.length > 0 && (
          <section className="rounded-lg border divide-y">
            <p className="p-3 font-medium text-sm">Por atendente</p>
            {byAgent.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <span className="truncate">{a.name}</span>
                <span className="text-muted-foreground shrink-0">{a.n} atend. · {a.sat}% satisfeitos · nota {a.avg}</span>
              </div>
            ))}
          </section>
        )}

        {supervise && (
          <section className="rounded-lg border p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">Relatório de melhorias</p>
                <p className="text-xs text-muted-foreground">Junta as falhas de processo e os feedbacks e mostra o que melhorar e como implementar.</p>
              </div>
              <Button size="sm" onClick={makeReport} disabled={busy}>
                <Sparkles className="w-4 h-4 mr-1" /> {busy ? "Gerando..." : "Gerar relatório (30 dias)"}
              </Button>
            </div>
            {report && <div className="whitespace-pre-wrap text-sm rounded-md bg-muted/50 p-3">{report}</div>}
          </section>
        )}

        <section className="space-y-2">
          {rows.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma avaliação nos últimos 30 dias.</p>}
          {rows.map((r) => (
            <div key={r.id} className="rounded-lg border">
              <button type="button" className="w-full flex flex-wrap items-center gap-2 p-3 text-left text-sm" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <span className="font-medium">#{protocols.get(r.ticket_id) ?? "—"}</span>
                {supervise && r.agent_id && <span className="text-muted-foreground">{names.get(r.agent_id) ?? ""}</span>}
                {r.status === "done" ? (
                  <>
                    <span className={`rounded-full px-2 text-xs ${SAT[r.satisfied ?? "indefinido"].cls}`}>{SAT[r.satisfied ?? "indefinido"].label}</span>
                    <Badge variant="outline">Nota {r.score}</Badge>
                    <span className="text-muted-foreground truncate flex-1 min-w-[12rem]">{r.reason}</span>
                  </>
                ) : (
                  <Badge variant="secondary">{r.status === "pending" ? "Aguardando avaliação" : r.status === "skipped" ? "Não avaliado" : "Falhou"}</Badge>
                )}
                <span className="ml-auto text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
              </button>
              {open === r.id && r.status === "done" && (
                <div className="border-t p-3 space-y-2 text-sm">
                  <div><p className="text-xs font-medium text-muted-foreground">Feedback para o atendente</p><p>{r.agent_feedback}</p></div>
                  {r.process_issues.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">Falhas de processo</p>
                      <ul className="list-disc pl-5 space-y-1">
                        {r.process_issues.map((i, k) => <li key={k}>{i.falha} <span className="text-muted-foreground">→ {i.sugestao}</span></li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
