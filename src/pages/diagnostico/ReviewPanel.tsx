import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export interface Finding {
  n: number; tipo: "incoerencia" | "risco" | "lacuna_critica"; gravidade: "critica" | "media" | "baixa";
  texto: string; etapas: string[]; sugestao: string; status: "aberta" | "resolvida" | "ignorada";
}
export interface Review { reviewer: string; items: Finding[]; open_critical: number }

const TIPO: Record<Finding["tipo"], string> = { incoerencia: "Não bate com outra etapa", risco: "Risco", lacuna_critica: "Falta algo importante" };
const COR: Record<Finding["gravidade"], string> = {
  critica: "bg-danger-soft text-danger-text", media: "bg-warning-soft text-warning-text", baixa: "bg-muted text-muted-foreground",
};
const GRAV: Record<Finding["gravidade"], string> = { critica: "importante", media: "atenção", baixa: "leve" };

/** Lê a revisão da etapa (gravada só pelo servidor ao organizar). */
export async function loadReview(orgId: string, stepKey: string): Promise<Review | null> {
  const { data } = await supabase.from("diag_findings").select("reviewer, items, open_critical")
    .eq("organization_id", orgId).eq("step_key", stepKey).maybeSingle();
  return data ? (data as unknown as Review) : null;
}
export const openCriticalOf = (r: Review | null) => (r?.items ?? []).filter((f) => f.gravidade === "critica" && f.status === "aberta");

/**
 * Segunda opinião do diretor da área (IA): o que não bate com as outras etapas, riscos e o que falta de
 * importante. O dono marca "Corrigi" ou "Está certo assim" (a IA não repete esse ponto).
 */
export function ReviewPanel({ orgId, stepKey, refresh, labelOf }: { orgId: string; stepKey: string; refresh: number; labelOf: (k: string) => string }) {
  const { toast } = useToast();
  const [rev, setRev] = useState<Review | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const load = useCallback(async () => setRev(await loadReview(orgId, stepKey)), [orgId, stepKey]);
  useEffect(() => { void load(); }, [load, refresh]);

  const mark = async (n: number, status: Finding["status"]) => {
    setBusy(n);
    const { error } = await supabase.rpc("set_finding_status", { org: orgId, p_key: stepKey, p_n: n, p_status: status });
    setBusy(null);
    if (error) return toast({ variant: "destructive", title: "Não consegui marcar", description: error.message });
    void load();
  };

  if (!rev) return null;
  const open = rev.items.filter((f) => f.status === "aberta");
  if (!rev.items.length) {
    return <p data-demo="revisao" className="rounded-md border p-2 text-xs text-success-text">🧐 <b>{rev.reviewer}</b> revisou: tudo coerente com as outras etapas ✓</p>;
  }
  return (
    <details data-demo="revisao" className="rounded-md border p-2 text-sm" open={open.length > 0}>
      <summary className="cursor-pointer list-none text-xs">
        🧐 <b>Revisão do {rev.reviewer}</b>: {open.length ? `${open.length} ponto${open.length > 1 ? "s" : ""} para olhar` : "tudo resolvido ✓"}
      </summary>
      <ul className="mt-2 space-y-2">
        {rev.items.map((f) => (
          <li key={f.n} className={`rounded border p-2 ${f.status !== "aberta" ? "opacity-60" : ""}`}>
            <span className="flex flex-wrap items-center gap-1 text-xs">
              <span className={`rounded px-1 ${COR[f.gravidade]}`}>{GRAV[f.gravidade]}</span>
              <b>{TIPO[f.tipo]}</b>
              {f.etapas.length > 0 && <span className="text-muted-foreground">· {f.etapas.map(labelOf).join(", ")}</span>}
              {f.status === "resolvida" && <span className="text-success-text">· corrigido</span>}
              {f.status === "ignorada" && <span className="text-muted-foreground">· está certo assim</span>}
            </span>
            <span className="mt-1 block">{f.texto}</span>
            {f.sugestao && <span className="block text-xs text-muted-foreground">💡 Como resolver: {f.sugestao}</span>}
            <span className="mt-1 flex flex-wrap gap-1">
              {f.status === "aberta" ? (
                <>
                  <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy === f.n}
                    title="Já ajustei o texto (aqui ou na outra etapa)" onClick={() => void mark(f.n, "resolvida")}>Corrigi</Button>
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy === f.n}
                    title="Não é um problema: a IA não aponta mais isso" onClick={() => void mark(f.n, "ignorada")}>Está certo assim</Button>
                </>
              ) : (
                <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy === f.n} onClick={() => void mark(f.n, "aberta")}>Reabrir</Button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
