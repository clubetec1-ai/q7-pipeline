import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { MODULE_INFO } from "@/components/ModuleGate";
import type { ModuleKey } from "@/contexts/OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { money } from "../Planos";

interface PlanRow {
  key: string; name: string; description: string | null; price_cents: number; setup_cents: number; modules: string[];
  limits: Record<string, number>; features: string[]; trial_days: number; public: boolean; active: boolean; sort: number;
}
const LIMITS: [string, string][] = [["ai_calls_mes", "Respostas de IA/mês"], ["numeros", "Números"], ["membros", "Pessoas"], ["analises_mes", "Análises do cérebro/mês"], ["manual_dia", "Análises manuais/dia"]];
const EMPTY: PlanRow = { key: "", name: "", description: "", price_cents: 0, setup_cents: 0, modules: ["ia", "canais"], limits: {}, features: [], trial_days: 14, public: true, active: true, sort: 9 };
const STATUS: [string, string][] = [["trial", "Teste grátis"], ["active", "Ativa"], ["past_due", "Em atraso"], ["canceled", "Cancelada"], ["expired", "Vencida"]];

/**
 * Plataforma → Planos (só a Clubetec): preços, módulos, franquias e o que aparece em
 * /planos; e o plano/situação de cada empresa (venda fechada fora do site, cortesia).
 */
export function PlansPanel({ orgs }: { orgs: { id: string; name: string }[] }) {
  const { toast } = useToast();
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [edit, setEdit] = useState<PlanRow | null>(null);
  const [orgId, setOrgId] = useState("");
  const [orgPlan, setOrgPlan] = useState({ plan: "", status: "active", days: "14" });

  const load = useCallback(async () => {
    const { data } = await supabase.from("plans").select("*").order("sort");
    setPlans((data as unknown as PlanRow[]) ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!edit) return;
    if (!/^[a-z0-9_]{2,30}$/.test(edit.key)) return toast({ variant: "destructive", title: "Código do plano: letras minúsculas, números e _" });
    const { error } = await supabase.rpc("platform_save_plan", {
      p_key: edit.key, p_name: edit.name, p_description: edit.description || null, p_price: edit.price_cents, p_setup: edit.setup_cents,
      p_modules: edit.modules, p_limits: edit.limits, p_features: edit.features.filter(Boolean), p_trial: edit.trial_days,
      p_public: edit.public, p_active: edit.active, p_sort: edit.sort,
    });
    if (error) return toast({ variant: "destructive", title: "Não salvou", description: error.message });
    toast({ title: `Plano ${edit.name} salvo` });
    setEdit(null);
    void load();
  };
  const setSub = async () => {
    if (!orgId || !orgPlan.plan) return;
    const { error } = await supabase.rpc("platform_set_subscription", { org: orgId, plan: orgPlan.plan, new_status: orgPlan.status, trial_days: Number(orgPlan.days) || 14 });
    if (error) return toast({ variant: "destructive", title: "Não salvou", description: error.message });
    toast({ title: "Plano da empresa atualizado", description: "Os módulos foram ajustados ao plano." });
  };
  const reais = (v: string) => Math.round((Number(v.replace(",", ".")) || 0) * 100);

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Planos à venda</h2>
          <Button size="sm" onClick={() => setEdit({ ...EMPTY })}>Novo plano</Button>
        </div>
        <ul className="divide-y text-sm">
          {plans.map((p) => (
            <li key={p.key} className="flex flex-wrap items-center gap-3 py-2">
              <span className="flex-1 min-w-[12rem]"><b>{p.name}</b> <span className="text-muted-foreground">({p.key}) · {money(p.price_cents)}/mês · {p.trial_days} dias grátis</span></span>
              <span className="text-xs text-muted-foreground">{p.active ? (p.public ? "No site" : "Oculto") : "Desativado"}</span>
              <Button size="sm" variant="outline" onClick={() => setEdit({ ...p, features: p.features ?? [], limits: p.limits ?? {} })}>Editar</Button>
            </li>
          ))}
        </ul>
        {edit && (
          <div className="rounded-md border p-3 space-y-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="space-y-1"><span>Código</span><Input value={edit.key} disabled={plans.some((p) => p.key === edit.key)} onChange={(e) => setEdit({ ...edit, key: e.target.value.trim().toLowerCase() })} /></label>
              <label className="space-y-1"><span>Nome</span><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
              <label className="space-y-1"><span>Ordem</span><Input type="number" value={edit.sort} onChange={(e) => setEdit({ ...edit, sort: Number(e.target.value) || 0 })} /></label>
              <label className="space-y-1"><span>Mensalidade (R$)</span><Input defaultValue={(edit.price_cents / 100).toString()} onChange={(e) => setEdit({ ...edit, price_cents: reais(e.target.value) })} /></label>
              <label className="space-y-1"><span>Implantação (R$)</span><Input defaultValue={(edit.setup_cents / 100).toString()} onChange={(e) => setEdit({ ...edit, setup_cents: reais(e.target.value) })} /></label>
              <label className="space-y-1"><span>Dias de teste</span><Input type="number" value={edit.trial_days} onChange={(e) => setEdit({ ...edit, trial_days: Number(e.target.value) || 0 })} /></label>
            </div>
            <label className="block space-y-1"><span>Descrição</span><Input value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></label>
            <div className="space-y-1">
              <span>Módulos</span>
              <div className="flex flex-wrap gap-3">
                {(Object.keys(MODULE_INFO) as ModuleKey[]).map((m) => (
                  <label key={m} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={edit.modules.includes(m)}
                      onChange={(e) => setEdit({ ...edit, modules: e.target.checked ? [...edit.modules, m] : edit.modules.filter((x) => x !== m) })} />
                    {MODULE_INFO[m].label}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-5">
              {LIMITS.map(([k, l]) => (
                <label key={k} className="space-y-1"><span className="text-xs">{l}</span>
                  <Input type="number" value={edit.limits[k] ?? ""} onChange={(e) => {
                    const v = e.target.value; const limits = { ...edit.limits };
                    if (v === "") delete limits[k]; else limits[k] = Number(v);
                    setEdit({ ...edit, limits });
                  }} />
                </label>
              ))}
            </div>
            <label className="block space-y-1"><span>O que vem no plano (uma linha por item, aparece no site)</span>
              <Textarea rows={4} value={edit.features.join("\n")} onChange={(e) => setEdit({ ...edit, features: e.target.value.split("\n").slice(0, 20) })} /></label>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={edit.public} onChange={(e) => setEdit({ ...edit, public: e.target.checked })} /> Aparece no site</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Ativo</label>
            </div>
            <div className="flex gap-2"><Button onClick={() => void save()}>Salvar plano</Button><Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button></div>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <h2 className="font-semibold">Plano de uma empresa</h2>
        <p className="text-sm text-muted-foreground">Para venda fechada fora do site, cortesia ou correção. Os módulos da empresa passam a ser os do plano.</p>
        <div className="flex flex-wrap gap-2 items-end text-sm">
          <select className="h-9 rounded-md border bg-background px-2" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
            <option value="">Empresa…</option>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <select className="h-9 rounded-md border bg-background px-2" value={orgPlan.plan} onChange={(e) => setOrgPlan({ ...orgPlan, plan: e.target.value })}>
            <option value="">Plano…</option>
            {plans.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
          <select className="h-9 rounded-md border bg-background px-2" value={orgPlan.status} onChange={(e) => setOrgPlan({ ...orgPlan, status: e.target.value })}>
            {STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {orgPlan.status === "trial" && <Input className="h-9 w-24" type="number" value={orgPlan.days} onChange={(e) => setOrgPlan({ ...orgPlan, days: e.target.value })} title="Dias de teste" />}
          <Button disabled={!orgId || !orgPlan.plan} onClick={() => void setSub()}>Aplicar</Button>
        </div>
      </section>
    </div>
  );
}
