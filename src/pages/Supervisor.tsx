import { NumberHealthBanner } from "@/components/NumberHealthBanner";
import { AppHeader } from "@/components/AppHeader";
import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Download, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { Logo } from "@/components/Logo";
import { MainNav } from "@/components/MainNav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

// Célula de CSV; valor que começa com = + - @ vira texto (evita fórmula no Excel).
function csvCell(v: unknown) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

interface Dashboard {
  team: { user_id: string; name: string; status: string; pause_reason: string | null; status_since: string | null; open: number }[];
  queues: { department_id: string | null; name: string; mode: string; alert_minutes: number; queued: number; oldest_queued_at: string | null }[];
  today: { opened: number; closed: number; avg_queue_seconds: number | null; avg_first_response_seconds: number | null; avg_duration_seconds: number | null };
}

const STATUS: Record<string, { label: string; cls: string }> = {
  online: { label: "Online", cls: "bg-emerald-500" },
  paused: { label: "Pausa", cls: "bg-amber-500" },
  offline: { label: "Offline", cls: "bg-slate-400" },
};

function dur(sec: number | null | undefined) {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}
function since(iso: string | null) {
  return iso ? dur(Math.round((Date.now() - new Date(iso).getTime()) / 1000)) : "—";
}

/** Painel do supervisor (spec atendimento §7.7): equipe, filas e números de hoje. */
export default function Supervisor() {
  const { signOut } = useAuth();
  const { org, can } = useOrg();
  const navigate = useNavigate();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();

  // Exportação: o banco confere a permissão, registra quem/quantos e avisa dono/admin se negar.
  const exportContacts = async () => {
    if (!org) return;
    setExporting(true);
    const { data: r, error: e } = await supabase.rpc("export_contacts", { org: org.id });
    setExporting(false);
    const res = r as { ok: boolean; error?: string; count?: number; rows?: Record<string, unknown>[] } | null;
    if (e || !res?.ok) return toast({ variant: "destructive", title: "Exportação bloqueada", description: res?.error ?? e?.message });
    const cols = ["nome", "telefone", "email", "documento", "criado_em"];
    const csv = "\uFEFF" + [cols.join(";"), ...(res.rows ?? []).map((row) => cols.map((c) => csvCell(row[c])).join(";"))].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `contatos-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    URL.revokeObjectURL(url);
    const n = res.count ?? 0;
    toast({ title: n === 1 ? "1 contato exportado" : `${n} contatos exportados`, description: "A exportação ficou registrada na auditoria." });
  };

  const load = useCallback(async () => {
    if (!org) return;
    const { data: d, error: e } = await supabase.rpc("supervisor_dashboard", { org: org.id });
    if (e) setError(e.message);
    else setData(d as unknown as Dashboard);
  }, [org]);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 30_000);
    const ch = supabase.channel("supervisor-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_presence" }, () => load())
      .subscribe();
    return () => { window.clearInterval(id); supabase.removeChannel(ch); };
  }, [load]);

  if (!org) return null;
  if (!can("reports.view")) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="supervisor" />
      <NumberHealthBanner />

      <main className="flex-1 w-full max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Painel do supervisor</h1>
            <p className="text-sm text-muted-foreground">Ao vivo · atualiza sozinho</p>
          </div>
          {can("contacts.export") && (
            <Button variant="outline" size="sm" disabled={exporting} onClick={exportContacts}
              title="Planilha com nome, telefone, e-mail e documento. Fica registrado quem exportou.">
              <Download className="w-4 h-4 mr-1" /> {exporting ? "Exportando..." : "Exportar contatos"}
            </Button>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {data && (
          <>
            <section className="grid gap-3 grid-cols-2 lg:grid-cols-5">
              {[
                ["Abertos hoje", String(data.today.opened)],
                ["Finalizados hoje", String(data.today.closed)],
                ["Espera média na fila", dur(data.today.avg_queue_seconds)],
                ["1ª resposta média", dur(data.today.avg_first_response_seconds)],
                ["Duração média", dur(data.today.avg_duration_seconds)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border p-4">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-2xl font-semibold mt-1">{value}</p>
                </div>
              ))}
            </section>

            <section className="space-y-2">
              <h2 className="font-semibold">Filas</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.queues.map((q) => {
                  const waitMin = q.oldest_queued_at ? (Date.now() - new Date(q.oldest_queued_at).getTime()) / 60000 : 0;
                  const tone = q.queued === 0 ? "" : waitMin >= q.alert_minutes * 2 ? "border-red-500" : waitMin >= q.alert_minutes ? "border-amber-500" : "";
                  return (
                    <div key={q.department_id ?? "geral"} className={`rounded-lg border-2 p-4 ${tone || "border-border"}`}>
                      <div className="flex items-center justify-between">
                        <p className="font-medium">{q.name}</p>
                        <Badge variant="outline" className="text-xs">{q.mode === "auto" ? "Automática" : "Manual"}</Badge>
                      </div>
                      <p className="text-3xl font-semibold mt-2">{q.queued}</p>
                      <p className="text-xs text-muted-foreground">
                        {q.queued ? `na fila · maior espera ${since(q.oldest_queued_at)}` : "fila vazia"}
                      </p>
                      {!q.department_id && q.queued > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">Sem setor: escolha o setor de cada caixa de e-mail e número em Configurações; e-mail que não é cliente, use “Não é atendimento”.</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="font-semibold">Equipe</h2>
              <div className="rounded-md border divide-y">
                {data.team.map((p) => {
                  const st = STATUS[p.status] ?? STATUS.offline;
                  return (
                    <div key={p.user_id} className="flex items-center justify-between gap-3 p-3 text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${st.cls}`} />
                        <span className="font-medium truncate">{p.name}</span>
                        <span className="text-muted-foreground text-xs">
                          {st.label}{p.pause_reason ? ` · ${p.pause_reason}` : ""} · há {since(p.status_since)}
                        </span>
                      </div>
                      <span className="text-muted-foreground shrink-0">{p.open} em atendimento</span>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
