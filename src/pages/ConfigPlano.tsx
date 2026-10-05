import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type Plan, money } from "./Planos";

export interface Sub {
  status: "trial" | "active" | "past_due" | "canceled" | "expired" | "sem_assinatura";
  plan_key?: string; plan_name?: string; price_cents?: number; setup_cents?: number; trial_ends_at?: string | null;
  current_period_end?: string | null; cancel_at_period_end?: boolean; billing_email?: string | null; has_billing?: boolean;
  ai_used?: number; ai_limit?: number | null;
}
export const SUB_LABEL: Record<string, [string, string]> = {
  trial: ["Teste grátis", "bg-info-soft text-info-text"],
  active: ["Ativa", "bg-success-soft text-success-text"],
  past_due: ["Pagamento em atraso", "bg-warning-soft text-warning-text"],
  canceled: ["Cancelada", "bg-muted text-muted-foreground"],
  expired: ["Vencida", "bg-danger-soft text-danger-text"],
};
const date = (d?: string | null) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");
export const daysLeft = (d?: string | null) => (d ? Math.max(0, Math.ceil((new Date(d).getTime() - Date.now()) / 864e5)) : 0);
const onlyDigits = (s: string) => s.replace(/\D/g, "");

interface Billing { invoices: { id: string; value: number; due: string; status: string; url: string | null }[] }

/**
 * Configurações → Plano e assinatura (dono). Situação, uso de IA do mês × franquia,
 * escolher plano e assinar (a cobrança abre na página segura do Asaas: PIX, boleto ou
 * cartão — nenhum dado de pagamento passa pelo sistema).
 */
export default function ConfigPlano() {
  const { org, can } = useOrg();
  const { toast } = useToast();
  const [sub, setSub] = useState<Sub | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plan, setPlan] = useState("");
  const [doc, setDoc] = useState("");
  const [busy, setBusy] = useState(false);
  const [billing, setBilling] = useState<Billing | null>(null);

  const load = useCallback(async () => {
    if (!org) return;
    const [{ data: s }, { data: p }] = await Promise.all([
      supabase.rpc("my_subscription", { org: org.id }),
      supabase.from("plans").select("key, name, description, price_cents, setup_cents, features, trial_days, modules, sort").eq("active", true).eq("public", true).order("sort"),
    ]);
    const cur = s as unknown as Sub;
    setSub(cur);
    setPlans((p as Plan[]) ?? []);
    setPlan((x) => x || cur?.plan_key || "");
    if (cur?.has_billing) {
      const r = await callFunction<Billing>("billing", { action: "status", organization_id: org.id });
      if (r.ok) setBilling(r.data);
    }
  }, [org]);
  useEffect(() => { void load(); }, [load]);

  if (!org) return null;
  if (!can("org.billing")) return <Navigate to="/configuracoes" replace />;

  const subscribe = async () => {
    const d = onlyDigits(doc);
    if (d.length !== 11 && d.length !== 14) return toast({ variant: "destructive", title: "Informe o CPF ou o CNPJ de quem paga" });
    setBusy(true);
    const r = await callFunction<{ url: string | null }>("billing", { action: "subscribe", organization_id: org.id, plan, cpf_cnpj: d });
    setBusy(false);
    if (!r.ok) return toast({ variant: "destructive", title: "Não foi possível assinar", description: r.message });
    toast({ title: "Assinatura criada", description: "Abrimos a cobrança na página do Asaas." });
    if (r.data.url) window.open(r.data.url, "_blank", "noopener");
    void load();
  };
  const cancel = async () => {
    if (!window.confirm("Cancelar a assinatura? Vale até o fim do período já pago; depois os módulos desligam (seus dados ficam guardados).")) return;
    const r = await callFunction("billing", { action: "cancel", organization_id: org.id });
    if (!r.ok) return toast({ variant: "destructive", title: "Não foi possível cancelar", description: r.message });
    toast({ title: "Assinatura cancelada no fim do período" });
    void load();
  };

  const label = sub ? SUB_LABEL[sub.status] : null;
  const pct = sub?.ai_limit ? Math.min(100, Math.round(((sub.ai_used ?? 0) / sub.ai_limit) * 100)) : 0;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="configuracoes" />
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-6 sm:px-6 space-y-6">
        <div>
          <Link to="/configuracoes" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"><ArrowLeft className="w-4 h-4" /> Configurações</Link>
          <h1 className="font-brand text-2xl leading-tight mt-1">Plano e assinatura</h1>
        </div>

        {sub?.status === "sem_assinatura" ? (
          <section className="rounded-xl border bg-card p-5 text-sm">
            O plano desta empresa é definido diretamente com a Clubetec. Para mudar, fale com a gente.
          </section>
        ) : sub && (
          <section className="rounded-xl border bg-card p-5 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-base font-semibold flex-1">Plano {sub.plan_name}</p>
              {label && <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${label[1]}`}>{label[0]}</span>}
            </div>
            <p className="text-sm text-muted-foreground">
              {sub.status === "trial" && <>Teste grátis até <b>{date(sub.trial_ends_at)}</b> ({daysLeft(sub.trial_ends_at)} dia(s)). Assine antes para não parar.</>}
              {sub.status === "active" && <>Ativa até {date(sub.current_period_end)}{sub.cancel_at_period_end ? " — cancelada, não renova" : ", renova sozinha"}.</>}
              {sub.status === "past_due" && <>O último pagamento está em atraso. Pague para não perder o acesso.</>}
              {(sub.status === "expired" || sub.status === "canceled") && <>Os módulos estão parados. Seus dados estão guardados: assine para voltar.</>}
            </p>
            <p className="text-sm">{money(sub.price_cents ?? 0)}/mês{sub.setup_cents ? ` · implantação ${money(sub.setup_cents)}` : ""}</p>
            {sub.ai_limit ? (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Respostas de IA neste mês: {(sub.ai_used ?? 0).toLocaleString("pt-BR")} de {sub.ai_limit.toLocaleString("pt-BR")}</p>
                <div className="h-2 rounded-full bg-muted overflow-hidden"><div className={`h-full ${pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-warning" : "bg-success"}`} style={{ width: `${pct}%` }} /></div>
                {pct >= 100 && <p className="text-xs text-danger-text">A franquia do mês acabou: a IA espera o próximo mês. Troque para um plano maior para continuar agora.</p>}
              </div>
            ) : null}
          </section>
        )}

        {billing?.invoices?.length ? (
          <section className="rounded-xl border bg-card p-5 space-y-2">
            <h2 className="text-base font-semibold">Cobranças</h2>
            <ul className="divide-y text-sm">
              {billing.invoices.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="w-24 text-muted-foreground">{date(i.due)}</span>
                  <span className="flex-1 tabular-nums">{money(Math.round(i.value * 100))}</span>
                  <span className="text-xs">{i.status === "paid" ? "Paga" : i.status === "overdue" ? "Em atraso" : i.status === "canceled" ? "Cancelada" : "Em aberto"}</span>
                  {i.url && i.status !== "paid" && <a className="text-xs underline inline-flex items-center gap-1" href={i.url} target="_blank" rel="noopener noreferrer">Pagar <ExternalLink className="w-3 h-3" /></a>}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {sub && sub.status !== "sem_assinatura" && (sub.status !== "active" || !sub.has_billing) && (
          <section className="rounded-xl border bg-card p-5 space-y-4">
            <h2 className="text-base font-semibold">Assinar</h2>
            <div className="grid gap-2 sm:grid-cols-3">
              {plans.map((p) => (
                <label key={p.key} className={`rounded-lg border p-3 text-sm cursor-pointer ${plan === p.key ? "border-primary bg-primary/5" : ""}`}>
                  <input type="radio" name="plano" className="mr-2" checked={plan === p.key} onChange={() => setPlan(p.key)} />
                  <span className="font-medium">{p.name}</span>
                  <span className="block text-xs text-muted-foreground mt-1">{money(p.price_cents)}/mês</span>
                </label>
              ))}
            </div>
            <label className="block space-y-1.5 text-sm max-w-xs">
              <span className="font-medium">CPF ou CNPJ de quem paga</span>
              <Input value={doc} inputMode="numeric" maxLength={18} onChange={(e) => setDoc(e.target.value)} placeholder="Só números" />
              <span className="text-xs text-muted-foreground">O Asaas exige para emitir a cobrança.</span>
            </label>
            <Button disabled={busy || !plan} onClick={() => void subscribe()}>{busy ? "Abrindo…" : "Assinar e pagar"}</Button>
            <p className="text-xs text-muted-foreground">A cobrança abre na página segura do Asaas: PIX, boleto ou cartão. A assinatura renova todo mês até você cancelar.</p>
          </section>
        )}

        {sub?.status === "active" && sub.has_billing && !sub.cancel_at_period_end && (
          <div><Button variant="ghost" size="sm" onClick={() => void cancel()}>Cancelar assinatura</Button></div>
        )}
      </main>
    </div>
  );
}
