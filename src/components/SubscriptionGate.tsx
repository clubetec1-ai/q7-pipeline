import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";
import { Button } from "@/components/ui/button";
import { daysLeft } from "@/pages/ConfigPlano";

/**
 * Assinatura: faixa de aviso (teste acabando, pagamento em atraso) e, se vencida ou
 * cancelada, bloqueio das telas — os dados ficam guardados; o dono assina e tudo volta.
 * A tela de plano e a de segurança continuam abertas para o dono resolver.
 */
export function SubscriptionGate({ children }: { children: ReactNode }) {
  const { org, can } = useOrg();
  const { pathname } = useLocation();
  const [st, setSt] = useState<{ status: string; trial_ends_at: string | null } | null>(null);
  useEffect(() => {
    if (!org) return;
    let alive = true;
    void supabase.rpc("org_access_state", { org: org.id }).then(({ data }) => { if (alive) setSt((data as never) ?? null); });
    return () => { alive = false; };
  }, [org]);

  const owner = can("org.billing");
  const open = pathname.startsWith("/configuracoes/plano") || pathname.startsWith("/seguranca") || pathname.startsWith("/plataforma");
  if (st && (st.status === "expired" || st.status === "canceled") && !open) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md text-center space-y-4 rounded-xl border bg-card p-6">
          <h1 className="font-brand text-2xl leading-tight">Assinatura {st.status === "expired" ? "vencida" : "cancelada"}</h1>
          <p className="text-sm text-muted-foreground">
            Os atendimentos automáticos estão parados, mas nenhum dado foi apagado.
            {owner ? " Assine para voltar a usar tudo na hora." : " Peça ao dono da empresa para regularizar a assinatura."}
          </p>
          {owner && <Button asChild><Link to="/configuracoes/plano">Ver plano e assinar</Link></Button>}
        </div>
      </div>
    );
  }
  const left = st?.status === "trial" ? daysLeft(st.trial_ends_at) : null;
  const banner = st?.status === "past_due"
    ? "O pagamento da assinatura está em atraso."
    : left !== null && left <= 7 ? `O teste grátis termina em ${left} dia(s).` : null;
  return (
    <>
      {banner && owner && (
        <div className="bg-warning-soft text-warning-text text-sm px-4 py-2 flex flex-wrap items-center gap-2 justify-center">
          <span>{banner}</span>
          <Link to="/configuracoes/plano" className="underline font-medium">Assinar agora</Link>
        </div>
      )}
      {children}
    </>
  );
}
