import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Brain } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

/** Início: "Cérebro desta semana" (dono) ou "Sua área: N para aprovar" (responsável). Some se a pessoa não tem área. */
export function BrainCard({ orgId }: { orgId: string }) {
  const [state, setState] = useState<{ scope: string; toApprove: number; pending: number; resumo: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    setState(null); // trocou de empresa: não mostra o resumo da anterior
    void (async () => {
      const { data, error } = await supabase.rpc("brain_overview", { org: orgId });
      if (error || !alive) return;
      const ov = data as unknown as { scope: string; areas: { pending: { sugeridas: number } }[] };
      if (!ov.areas.length) return;
      const { data: p } = await supabase.rpc("brain_pending", { org: orgId });
      let resumo: string | null = null;
      if (ov.scope === "dono") {
        const { data: r } = await supabase.from("brain_runs").select("summary").eq("organization_id", orgId).eq("status", "ok")
          .order("started_at", { ascending: false }).limit(1).maybeSingle();
        resumo = ((r?.summary as { resumo?: string } | null)?.resumo ?? null);
      }
      if (alive) setState({
        scope: ov.scope, toApprove: ov.areas.reduce((n, a) => n + (a.pending?.sugeridas ?? 0), 0),
        pending: Array.isArray(p) ? p.length : 0, resumo,
      });
    })();
    return () => { alive = false; };
  }, [orgId]);
  if (!state) return null;
  return (
    <section className="rounded-xl border bg-card p-5 flex flex-wrap items-center gap-4">
      <Brain className="w-6 h-6 text-status-ia shrink-0" />
      <div className="flex-1 min-w-[14rem] space-y-1">
        <p className="font-semibold">{state.scope === "dono" ? "Cérebro desta semana" : "Sua área"}</p>
        {state.resumo && <p className="text-sm text-muted-foreground line-clamp-2">{state.resumo}</p>}
        <p className="text-sm">
          <b>{state.toApprove}</b> sugestão(ões) para aprovar{state.pending ? <> · <b>{state.pending}</b> pendência(s) parada(s)</> : null}
        </p>
      </div>
      <Button asChild size="sm"><Link to="/cerebro">Abrir o cérebro</Link></Button>
    </section>
  );
}
