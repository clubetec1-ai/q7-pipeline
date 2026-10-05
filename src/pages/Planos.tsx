import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";

export interface Plan {
  key: string; name: string; description: string | null; price_cents: number; setup_cents: number;
  features: string[]; trial_days: number; modules: string[]; sort: number;
}
export const PLAN_KEY = "clubecrm:plano";
export const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: cents % 100 ? 2 : 0 });

/**
 * Planos (página pública, sem login): preço, o que vem em cada plano e "Começar teste
 * grátis". Os planos e preços vêm do banco (Clubetec edita em Plataforma → Planos).
 */
export default function Planos() {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  useEffect(() => {
    void supabase.from("plans").select("key, name, description, price_cents, setup_cents, features, trial_days, modules, sort")
      .eq("public", true).eq("active", true).order("sort").then(({ data }) => setPlans((data as Plan[]) ?? []));
  }, []);
  const pick = (k: string) => { try { localStorage.setItem(PLAN_KEY, k); } catch { /* sem armazenamento: escolhe de novo depois */ } };
  const featured = plans && plans.length >= 3 ? plans[Math.floor(plans.length / 2)].key : null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Logo horizontal width={28} height={28} />
          <Button asChild variant="outline" size="sm"><Link to="/login">Entrar</Link></Button>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        <div className="text-center space-y-2 max-w-2xl mx-auto">
          <h1 className="font-brand text-3xl sm:text-4xl leading-tight">Deixa com a IA</h1>
          <p className="text-muted-foreground">
            A IA atende seus clientes no WhatsApp e no e-mail na hora, usando só as informações da sua empresa, e passa para
            a sua equipe quando precisa. Comece com um teste grátis — sem cartão.
          </p>
        </div>

        {!plans ? <p className="text-center text-sm text-muted-foreground">Carregando os planos…</p> : !plans.length ? (
          <p className="text-center text-sm text-muted-foreground">Os planos estão sendo atualizados. Fale com a Clubetec.</p>
        ) : (
          <div className={`grid gap-4 ${plans.length >= 3 ? "lg:grid-cols-3" : "md:grid-cols-2"}`}>
            {plans.map((p) => (
              <section key={p.key} className={`rounded-xl border bg-card p-6 flex flex-col gap-4 ${p.key === featured ? "ring-2 ring-primary" : ""}`}>
                <div className="space-y-1">
                  {p.key === featured && <span className="inline-block rounded-md bg-primary/10 text-primary-text px-2 py-0.5 text-xs font-medium">Mais escolhido</span>}
                  <h2 className="text-lg font-semibold">{p.name}</h2>
                  {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
                </div>
                <div>
                  <p><span className="font-brand text-3xl tabular-nums">{money(p.price_cents)}</span><span className="text-sm text-muted-foreground"> /mês</span></p>
                  {p.setup_cents > 0 && <p className="text-xs text-muted-foreground">Implantação: {money(p.setup_cents)} (uma vez)</p>}
                </div>
                <ul className="space-y-1.5 text-sm flex-1">
                  {p.features.map((f) => <li key={f} className="flex gap-2"><Check className="w-4 h-4 text-success shrink-0 mt-0.5" />{f}</li>)}
                </ul>
                <Button asChild variant={p.key === featured ? "default" : "outline"} onClick={() => pick(p.key)}>
                  <Link to={`/login?modo=cadastro&plano=${encodeURIComponent(p.key)}`}>
                    {p.trial_days > 0 ? `Começar ${p.trial_days} dias grátis` : "Assinar"}
                  </Link>
                </Button>
              </section>
            ))}
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Teste grátis sem cartão. Ao fim do teste, escolha pagar por PIX, boleto ou cartão. Uma solução Clubetec.
        </p>
      </main>
    </div>
  );
}
