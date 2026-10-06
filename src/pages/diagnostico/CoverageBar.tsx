import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleDashed, CircleDot, MinusCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export type CoverageStatus = "completo" | "incompleto" | "faltando" | "nao_tem";
export interface CoverageItem { n: number; item: string; porque: string; status: CoverageStatus; nota: string; por: "ia" | "dono" }
export interface Coverage { items: CoverageItem[]; complete: number; total: number }

const ICON: Record<CoverageStatus, JSX.Element> = {
  completo: <CheckCircle2 className="h-4 w-4 shrink-0 text-success-text" />,
  incompleto: <CircleDot className="h-4 w-4 shrink-0 text-warning-text" />,
  faltando: <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" />,
  nao_tem: <MinusCircle className="h-4 w-4 shrink-0 text-muted-foreground" />,
};
const LABEL: Record<CoverageStatus, string> = { completo: "completo", incompleto: "incompleto", faltando: "falta", nao_tem: "não temos" };

/** Lê a cobertura da etapa (gravada só pelo servidor ao organizar). */
export async function loadCoverage(orgId: string, stepKey: string): Promise<Coverage | null> {
  const { data } = await supabase.from("diag_coverage").select("items, complete, total")
    .eq("organization_id", orgId).eq("step_key", stepKey).maybeSingle();
  return data ? (data as unknown as Coverage) : null;
}

/** O que ainda falta (para o aviso ao aprovar). */
export const pendingOf = (c: Coverage | null) => (c?.items ?? []).filter((x) => x.status === "faltando" || x.status === "incompleto");

/**
 * "Informação completa: X de Y" da etapa — o que os agentes precisam saber, com o porquê.
 * O dono pode marcar "Não temos isso" (conta como resolvido e a IA não pergunta mais).
 */
export function CoverageBar({ orgId, stepKey, refresh }: { orgId: string; stepKey: string; refresh: number }) {
  const { toast } = useToast();
  const [cov, setCov] = useState<Coverage | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const load = useCallback(async () => setCov(await loadCoverage(orgId, stepKey)), [orgId, stepKey]);
  useEffect(() => { void load(); }, [load, refresh]);

  const mark = async (n: number, naoTem: boolean) => {
    setBusy(n);
    const { data, error } = await supabase.rpc("set_coverage_item", { org: orgId, p_key: stepKey, p_n: n, p_nao_tem: naoTem });
    setBusy(null);
    if (error) return toast({ variant: "destructive", title: "Não consegui marcar", description: error.message });
    if (data) void load();
  };

  if (!cov || !cov.total) {
    return (
      <p data-demo="cobertura" className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
        📊 <b>Informação completa:</b> clique em <b>Organizar com IA</b> para ver o que já está completo e o que ainda falta para os agentes atenderem bem.
      </p>
    );
  }
  const pct = Math.round((cov.complete / cov.total) * 100);
  return (
    <details data-demo="cobertura" className="rounded-md border p-2 text-sm" open={pct < 100}>
      <summary className="cursor-pointer list-none space-y-1">
        <span className="flex items-center justify-between gap-2 text-xs">
          <b>📊 Informação completa: {cov.complete} de {cov.total}</b>
          <span className="text-muted-foreground">{pct === 100 ? "tudo certo ✓" : "toque para ver o que falta"}</span>
        </span>
        <span className="block h-2 overflow-hidden rounded-full bg-muted">
          <span className={`block h-full ${pct === 100 ? "bg-success" : "bg-primary"}`} style={{ width: `${pct}%` }} />
        </span>
      </summary>
      <ul className="mt-2 space-y-2">
        {cov.items.map((x) => (
          <li key={x.n} className="flex gap-2">
            {ICON[x.status]}
            <span className="min-w-0 flex-1">
              <span className="block"><b>{x.item}</b> <span className="text-xs text-muted-foreground">({LABEL[x.status]})</span></span>
              {x.nota && <span className="block text-xs text-muted-foreground">{x.nota}</span>}
              {x.status !== "completo" && <span className="block text-xs">💡 Por que importa: {x.porque}</span>}
            </span>
            {(x.status === "faltando" || x.status === "incompleto") && (
              <Button type="button" size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-xs" disabled={busy === x.n}
                title="A empresa não tem isso: conta como resolvido e a IA não pergunta mais" onClick={() => void mark(x.n, true)}>
                Não temos isso
              </Button>
            )}
            {x.status === "nao_tem" && (
              <Button type="button" size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-xs" disabled={busy === x.n} onClick={() => void mark(x.n, false)}>
                Desfazer
              </Button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
