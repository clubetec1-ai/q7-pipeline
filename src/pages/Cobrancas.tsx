import { SectionTabs } from "@/components/layout/SectionTabs";
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
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
import { ChargeButton } from "./conversas/ChargeButton";

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
  const [rows, setRows] = useState<Charge[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [filter, setFilter] = useState("");
  const [who, setWho] = useState("");
  const [found, setFound] = useState<{ id: string; contact_name: string | null; contact_phone: string | null }[]>([]);
  const [chosen, setChosen] = useState<{ id: string; label: string } | null>(null);

  const load = useCallback(async () => {
    if (!org) return;
    const [o, c] = await Promise.all([
      supabase.from("organizations").select("settings").eq("id", org.id).maybeSingle(),
      supabase.from("charges").select("id, contact_id, value, due_date, description, status, invoice_url, created_at, paid_at")
        .eq("organization_id", org.id).order("created_at", { ascending: false }).limit(300),
    ]);
    const p = ((o.data?.settings ?? {}) as Record<string, any>).payments ?? {};
    setPay(p);
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
  if (!manage && !can("reports.view") && !can("conversations.attend")) return <Navigate to="/" replace />;
  const connected = pay.provider === "asaas";
  // Quem pode gerar cobrança: gestores ou, se a empresa liberar, quem atende.
  const canCharge = connected && (manage || can("reports.view") || (pay.allow_agents === true && can("conversations.attend")));
  const findClient = async (text: string) => {
    setWho(text);
    const s = text.trim().replace(/[%,()]/g, "");
    if (s.length < 2) return setFound([]);
    const digits = s.replace(/\D/g, "");
    const { data } = await supabase.from("conversations").select("id, contact_name, contact_phone")
      .eq("organization_id", org.id).eq("channel", "whatsapp")
      .or(digits.length >= 4 ? `contact_phone.ilike.%${digits}%,contact_name.ilike.%${s}%` : `contact_name.ilike.%${s}%`)
      .order("last_message_at", { ascending: false }).limit(8);
    setFound(data ?? []);
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
      <AppHeader active="cobrancas" />
      <SectionTabs group="clientes" active="cobrancas" />
      <NumberHealthBanner />

      <main className="flex-1 w-full max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Cobranças</h1>
          <p className="text-sm text-muted-foreground">Cobre pelo WhatsApp com PIX, boleto ou cartão. O pagamento é atualizado sozinho.</p>
        </div>

        {canCharge && (
          <section className="rounded-lg border p-4 space-y-2">
            <p className="font-semibold">Nova cobrança</p>
            <p className="text-xs text-muted-foreground">Busque o cliente; a cobrança vai pelo WhatsApp da conversa dele. O CPF/CNPJ precisa estar na ficha.</p>
            <Input className="max-w-sm" placeholder="Nome ou telefone do cliente" value={who} onChange={(e) => void findClient(e.target.value)} />
            {!chosen && found.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {found.map((f) => (
                  <Button key={f.id} size="sm" variant="outline" onClick={() => setChosen({ id: f.id, label: f.contact_name || f.contact_phone || "Cliente" })}>
                    {f.contact_name || f.contact_phone}{f.contact_name && f.contact_phone ? ` · ${f.contact_phone}` : ""}
                  </Button>
                ))}
              </div>
            )}
            {chosen && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span>Cliente: <b>{chosen.label}</b></span>
                <ChargeButton conversationId={chosen.id} />
                <Button size="sm" variant="ghost" onClick={() => { setChosen(null); setWho(""); setFound([]); void load(); }}>Trocar / atualizar lista</Button>
              </div>
            )}
          </section>
        )}
        {!canCharge && !manage && (
          <p className="text-sm rounded-md bg-muted p-3">
            {connected ? "Sua empresa ainda não liberou cobranças para atendentes. Peça ao gestor (Configurações → Cobranças → “Atendentes também podem cobrar”)."
              : "A empresa ainda não conectou o Asaas."}
          </p>
        )}

        {manage && (
          <div className={`rounded-lg border p-3 flex flex-wrap items-center justify-between gap-2 text-sm ${connected ? "" : "border-amber-400 bg-amber-50 dark:bg-amber-950/30"}`}>
            <span>{connected ? `Asaas conectado (${pay.env === "production" ? "produção" : "testes"}).` : "Para cobrar, conecte o Asaas primeiro."} A chave e as regras ficam em Configurações.</span>
            <Button size="sm" variant={connected ? "outline" : "default"} onClick={() => navigate("/configuracoes/cobrancas")}>{connected ? "Configurar cobranças" : "Conectar o Asaas"}</Button>
          </div>
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
