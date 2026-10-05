import { useCallback, useEffect, useState } from "react";
import { TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

type M = { conversas_novas: number; finalizados: number; resposta_min: number | null; avaliacoes: number; nota_media: number | null };
const ROWS: [keyof M, string, boolean][] = [
  ["conversas_novas", "Conversas novas", false], ["finalizados", "Atendimentos finalizados", false],
  ["resposta_min", "1ª resposta (min)", true], ["nota_media", "Nota média", false], ["avaliacoes", "Avaliações", false],
];
const fmt = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR"));

/**
 * Implantação como pacote: guarda os números dos 30 dias antes de começar e compara
 * com os 30 dias mais recentes ("antes × depois", em linguagem de dono).
 */
export function ImplantationCard({ orgId }: { orgId: string }) {
  const { toast } = useToast();
  const [data, setData] = useState<{ started_at: string; antes: M; depois: M } | null | undefined>(undefined);
  const load = useCallback(async () => {
    const { data: d } = await supabase.rpc("implantation_compare", { org: orgId });
    setData((d as unknown as { started_at: string; antes: M; depois: M }) ?? null);
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);
  if (data === undefined) return null;

  const start = async () => {
    if (!window.confirm("Marcar hoje como o início da implantação? Os números dos últimos 30 dias ficam guardados como ponto de partida.")) return;
    const { error } = await supabase.rpc("start_implantation", { org: orgId });
    if (error) return toast({ variant: "destructive", title: "Não deu certo", description: error.message });
    void load();
  };

  if (!data) {
    return (
      <section className="rounded-xl border bg-card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium inline-flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Antes × depois</p>
          <p className="text-xs text-muted-foreground">Ao começar a implantação, guardamos os números de hoje para mostrar a melhora depois.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void start()}>Começar a medir</Button>
      </section>
    );
  }
  const days = Math.floor((Date.now() - Date.parse(data.started_at)) / 86_400_000);
  return (
    <section className="rounded-xl border bg-card p-4 space-y-2">
      <p className="font-medium inline-flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Antes × depois da implantação</p>
      <p className="text-xs text-muted-foreground">
        Antes = 30 dias até {new Date(data.started_at).toLocaleDateString("pt-BR")}. Depois = últimos 30 dias{days < 30 ? ` (a implantação começou há ${days} dia(s): o "depois" ainda mistura os dois períodos)` : ""}.
      </p>
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-5">
        {ROWS.map(([k, label, lower]) => {
          const a = data.antes?.[k], b = data.depois?.[k];
          const better = a != null && b != null && a !== b && (lower ? b < a : b > a);
          return (
            <div key={k} className="rounded-lg border p-2">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-sm"><span className="text-muted-foreground">{fmt(a)}</span> → <b className={better ? "text-success-text" : ""}>{fmt(b)}</b></p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
