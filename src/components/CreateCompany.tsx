import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/Logo";
import { type Plan, PLAN_KEY, money } from "@/pages/Planos";

interface Template { key: string; name: string; description: string | null }

/**
 * Quem tem conta mas ainda não tem empresa: cria a própria (teste grátis com o plano
 * escolhido) ou espera o convite de alguém. O banco confere e-mail confirmado, plano
 * público e o limite de 1 teste por pessoa (self_signup_org).
 */
export function CreateCompany({ onSignOut }: { onSignOut: () => void }) {
  const { toast } = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("generico");
  const [plan, setPlan] = useState(() => { try { return localStorage.getItem(PLAN_KEY) ?? ""; } catch { return ""; } });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabase.from("plans").select("key, name, description, price_cents, setup_cents, features, trial_days, modules, sort")
      .eq("public", true).eq("active", true).order("sort").then(({ data }) => {
        const list = (data as Plan[]) ?? [];
        setPlans(list);
        setPlan((p) => (list.some((x) => x.key === p) ? p : list[Math.floor(list.length / 2)]?.key ?? ""));
      });
    void supabase.rpc("signup_templates").then(({ data }) => setTemplates((data as unknown as Template[]) ?? []));
  }, []);

  const create = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("self_signup_org", { org_name: name.trim(), template, plan });
    setBusy(false);
    if (error) return toast({ variant: "destructive", title: "Não foi possível criar", description: error.message });
    try { localStorage.removeItem(PLAN_KEY); } catch { /* ok */ }
    window.location.assign("/inicio");
  };
  const chosen = plans.find((p) => p.key === plan);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-lg space-y-6">
        <div className="flex justify-center"><Logo width={110} height={46} /></div>
        <section className="rounded-xl border bg-card p-6 space-y-5">
          <div>
            <h1 className="font-brand text-2xl leading-tight">Criar a sua empresa</h1>
            <p className="text-sm text-muted-foreground">
              Comece o teste grátis. Você vira o dono e depois convida a sua equipe. Se alguém já te convidou para uma
              empresa, entre pelo link do convite que chegou no e-mail.
            </p>
          </div>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Nome da empresa</span>
            <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Ex.: 2º Tabelionato de Notas" autoFocus />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Tipo de empresa</span>
            <select className="h-10 w-full rounded-md border bg-background px-2 text-sm" value={template} onChange={(e) => setTemplate(e.target.value)}>
              {templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
            </select>
            <span className="text-xs text-muted-foreground">Já vem com setores, etapas do funil e mensagens do seu tipo de empresa. Tudo editável.</span>
          </label>
          <fieldset className="space-y-2 text-sm">
            <legend className="font-medium mb-1.5">Plano</legend>
            {plans.map((p) => (
              <label key={p.key} className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer ${plan === p.key ? "border-primary bg-primary/5" : ""}`}>
                <input type="radio" name="plano" className="mt-1" checked={plan === p.key} onChange={() => setPlan(p.key)} />
                <span className="flex-1">
                  <span className="font-medium">{p.name}</span> <span className="text-muted-foreground">· {money(p.price_cents)}/mês</span>
                  {p.description && <span className="block text-xs text-muted-foreground">{p.description}</span>}
                </span>
              </label>
            ))}
            <Link to="/planos" className="text-xs underline text-muted-foreground">Comparar os planos</Link>
          </fieldset>
          <Button className="w-full" disabled={busy || name.trim().length < 2 || !plan} onClick={() => void create()}>
            {busy ? "Criando…" : chosen?.trial_days ? `Começar ${chosen.trial_days} dias grátis` : "Criar empresa"}
          </Button>
          <p className="text-xs text-muted-foreground text-center">Sem cartão agora. No fim do teste, você escolhe pagar por PIX, boleto ou cartão.</p>
        </section>
        <div className="text-center"><Button variant="ghost" size="sm" onClick={onSignOut}>Sair</Button></div>
      </div>
    </div>
  );
}
