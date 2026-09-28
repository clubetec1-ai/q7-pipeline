import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ExternalLink, LogOut } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Charge {
  id: string; contact_id: string | null; value: number; due_date: string; description: string | null;
  status: string; invoice_url: string | null; created_at: string; paid_at: string | null;
}
const STATUS: Record<string, { label: string; variant: "secondary" | "outline" | "destructive" | "default" }> = {
  pending: { label: "Em aberto", variant: "outline" }, paid: { label: "Paga", variant: "default" },
  overdue: { label: "Vencida", variant: "destructive" }, canceled: { label: "Cancelada", variant: "secondary" },
  refunded: { label: "Estornada", variant: "secondary" },
};
const brl = (v: number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brDate = (d: string) => d.split("-").reverse().join("/");

/** Cobranças pelo WhatsApp (Asaas): conectar, regras e lista. */
export default function Cobrancas() {
  const { signOut } = useAuth();
  const { org, can } = useOrg();
  const navigate = useNavigate();
  const { toast } = useToast();
  const manage = can("org.settings");
  const [pay, setPay] = useState<Record<string, any>>({});
  const [env, setEnv] = useState("sandbox");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Charge[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    if (!org) return;
    const [o, c] = await Promise.all([
      supabase.from("organizations").select("settings").eq("id", org.id).maybeSingle(),
      supabase.from("charges").select("id, contact_id, value, due_date, description, status, invoice_url, created_at, paid_at")
        .eq("organization_id", org.id).order("created_at", { ascending: false }).limit(300),
    ]);
    const p = ((o.data?.settings ?? {}) as Record<string, any>).payments ?? {};
    setPay(p);
    if (p.env) setEnv(p.env);
    const list = (c.data as Charge[]) ?? [];
    setRows(list);
    const ids = [...new Set(list.map((r) => r.contact_id).filter(Boolean))] as string[];
    if (ids.length) {
      const { data: cs } = await supabase.from("contacts").select("id, name, phone, email").in("id", ids);
      setNames(new Map((cs ?? []).map((x) => [x.id, x.name || x.phone || x.email || "Contato"])));
    }
  }, [org]);
  useEffect(() => { void load(); }, [load]);

  if (!org) return null;
  if (!manage && !can("reports.view")) return <Navigate to="/" replace />;
  const connected = pay.provider === "asaas";

  const connect = async () => {
    setBusy(true);
    const r = await callFunction<{ warning: string | null }>("payments", { action: "connect", organization_id: org.id, env, api_key: apiKey.trim() });
    setBusy(false);
    if (!r.ok) return toast({ variant: "destructive", title: "Não conectado", description: r.message });
    setApiKey("");
    toast(r.data.warning ? { variant: "destructive", title: "Conectado com aviso", description: r.data.warning } : { title: "Asaas conectado", description: "Os pagamentos serão avisados automaticamente." });
    void load();
  };
  const disconnect = async () => {
    if (!window.confirm("Desconectar o Asaas? As cobranças existentes continuam na lista.")) return;
    await callFunction("payments", { action: "disconnect", organization_id: org.id });
    void load();
  };
  const setRule = async (k: string, v: boolean) => {
    const { data } = await supabase.from("organizations").select("settings").eq("id", org.id).maybeSingle();
    const s = (data?.settings ?? {}) as Record<string, any>;
    const { error } = await supabase.from("organizations").update({ settings: { ...s, payments: { ...(s.payments ?? {}), [k]: v } } as never }).eq("id", org.id);
    if (error) return toast({ variant: "destructive", title: "Sem permissão" });
    setPay((p) => ({ ...p, [k]: v }));
  };
  const cancel = async (c: Charge) => {
    if (!window.confirm(`Cancelar a cobrança de ${brl(c.value)}?`)) return;
    const r = await callFunction("payments", { action: "cancel", organization_id: org.id, charge_id: c.id });
    if (!r.ok) return toast({ variant: "destructive", title: r.message });
    void load();
  };

  const shown = rows.filter((r) => !filter || r.status === filter);
  const open = rows.filter((r) => ["pending", "overdue"].includes(r.status)).reduce((s, r) => s + Number(r.value), 0);
  const paid30 = rows.filter((r) => r.status === "paid" && r.paid_at && Date.now() - new Date(r.paid_at).getTime() < 30 * 86_400_000)
    .reduce((s, r) => s + Number(r.value), 0);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b px-4 h-14 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Logo horizontal width={26} height={26} />
          <MainNav active="cobrancas" />
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" size="icon" title="Sair" onClick={async () => { await signOut(); navigate("/login"); }}><LogOut className="w-4 h-4" /></Button>
        </div>
      </header>
      <NumberHealthBanner />

      <main className="flex-1 w-full max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Cobranças</h1>
          <p className="text-sm text-muted-foreground">Cobre pelo WhatsApp com PIX, boleto ou cartão. O pagamento é atualizado sozinho.</p>
        </div>

        {manage && (
          <section className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold">Asaas</p>
              {connected ? <Badge>{pay.env === "production" ? "Conectado (produção)" : "Conectado (testes)"}</Badge> : <Badge variant="outline">Não conectado</Badge>}
            </div>
            <ol className="list-decimal pl-5 text-xs text-muted-foreground space-y-0.5">
              <li>Crie a conta no Asaas (para testar, use o ambiente de testes: sandbox.asaas.com).</li>
              <li>No Asaas: Integrações → Chaves de API → Gerar chave. Copie a chave.</li>
              <li>Cole abaixo, escolha o ambiente certo e clique em Conectar. O aviso de pagamento é configurado sozinho.</li>
            </ol>
            <div className="flex flex-wrap gap-2">
              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={env} onChange={(e) => setEnv(e.target.value)}>
                <option value="sandbox">Testes (sandbox)</option><option value="production">Produção</option>
              </select>
              <Input type="password" autoComplete="off" className="max-w-sm" placeholder={connected ? "Trocar chave" : "Chave de API do Asaas"}
                value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              <Button onClick={connect} disabled={busy || apiKey.trim().length < 20}>{busy ? "Conectando..." : "Conectar"}</Button>
              {connected && <Button variant="ghost" onClick={disconnect}>Desconectar</Button>}
            </div>
            {connected && (
              <div className="space-y-2 text-sm pt-2">
                <label className="flex items-center gap-2"><Switch checked={pay.allow_agents === true} onCheckedChange={(v) => setRule("allow_agents", v)} /> Atendentes também podem cobrar</label>
                <label className="flex items-center gap-2"><Switch checked={pay.notify_paid !== false} onCheckedChange={(v) => setRule("notify_paid", v)} /> Avisar o cliente quando o pagamento cair</label>
                <label className="flex items-center gap-2"><Switch checked={pay.reminders !== false} onCheckedChange={(v) => setRule("reminders", v)} /> Lembrete um dia antes e um dia depois do vencimento</label>
              </div>
            )}
          </section>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="outline">Em aberto: {brl(open)}</Badge>
          <Badge variant="outline">Recebido nos últimos 30 dias: {brl(paid30)}</Badge>
          <select className="h-8 rounded-md border bg-background px-2 text-sm ml-auto" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </select>
        </div>
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead><TableHead>Descrição</TableHead><TableHead className="text-right">Valor</TableHead>
                <TableHead>Vencimento</TableHead><TableHead>Situação</TableHead><TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.contact_id ? names.get(c.contact_id) ?? "—" : "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{c.description ?? "—"}</TableCell>
                  <TableCell className="text-right">{brl(c.value)}</TableCell>
                  <TableCell>{brDate(c.due_date)}</TableCell>
                  <TableCell><Badge variant={STATUS[c.status]?.variant ?? "outline"}>{STATUS[c.status]?.label ?? c.status}</Badge></TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {c.invoice_url && <Button variant="ghost" size="icon" title="Abrir cobrança" onClick={() => window.open(c.invoice_url!, "_blank", "noopener")}><ExternalLink className="w-4 h-4" /></Button>}
                    {["pending", "overdue"].includes(c.status) && <Button variant="ghost" size="sm" onClick={() => cancel(c)}>Cancelar</Button>}
                  </TableCell>
                </TableRow>
              ))}
              {shown.length === 0 && <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">Nenhuma cobrança.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </main>
    </div>
  );
}
