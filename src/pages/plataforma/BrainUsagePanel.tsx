import { useCallback, useEffect, useState } from "react";
import { Brain } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Row {
  org_id: string; name: string; limits: { analises_mes?: number; manual_dia?: number };
  ok: number; erro: number; pulado: number; chamadas: number; tokens_in: number; tokens_out: number; ultima: string | null; areas: number;
}

/**
 * Plataforma → Cérebro (só a Clubetec): consumo do mês por empresa e a franquia de
 * cada uma (análises por mês e manuais por dia). O dono da empresa não muda isso.
 */
export function BrainUsagePanel() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Record<string, { mes: string; dia: string }>>({});
  const since = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("platform_brain_usage", { since });
    if (error) return toast({ variant: "destructive", title: "Não carregou", description: error.message });
    setRows((data as unknown as Row[]) ?? []);
  }, [since, toast]);
  useEffect(() => { void load(); }, [load]);

  const save = async (r: Row) => {
    const e = edit[r.org_id];
    const mes = Number(e?.mes ?? r.limits.analises_mes ?? 8), dia = Number(e?.dia ?? r.limits.manual_dia ?? 1);
    if (!(mes >= 0 && mes <= 200 && dia >= 0 && dia <= 20)) return toast({ variant: "destructive", title: "Use de 0 a 200 por mês e 0 a 20 por dia" });
    const { error } = await supabase.rpc("platform_set_module_limits", { org: r.org_id, m: "gestao", lim: { ...r.limits, analises_mes: mes, manual_dia: dia } });
    if (error) return toast({ variant: "destructive", title: "Não salvou", description: error.message });
    toast({ title: `Franquia de ${r.name} atualizada` });
    setEdit((x) => { const n = { ...x }; delete n[r.org_id]; return n; });
    void load();
  };
  const total = rows.reduce((n, r) => n + r.tokens_in + r.tokens_out, 0);

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="font-semibold flex items-center gap-2"><Brain className="w-4 h-4" /> Cérebro — consumo e franquia</h2>
      <p className="text-sm text-muted-foreground">
        Empresas com o módulo Qualidade e Gestão. Padrão: 8 análises por mês e 1 manual por dia. Mês atual: {total.toLocaleString("pt-BR")} tokens no total.
      </p>
      {!rows.length ? <p className="text-sm text-muted-foreground">Nenhuma empresa com o módulo.</p> : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Empresa</th>
                <th className="px-3 py-2 font-medium text-right">Áreas</th>
                <th className="px-3 py-2 font-medium text-right">Análises (ok · erro · sem mudança)</th>
                <th className="px-3 py-2 font-medium text-right">Tokens</th>
                <th className="px-3 py-2 font-medium">Por mês</th>
                <th className="px-3 py-2 font-medium">Manual/dia</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.org_id}>
                  <td className="px-3 py-2">
                    <p className="font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{r.ultima ? `Última: ${new Date(r.ultima).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}` : "Nunca analisou"}</p>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.areas}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.ok} · {r.erro} · {r.pulado}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{(r.tokens_in + r.tokens_out).toLocaleString("pt-BR")}</td>
                  <td className="px-3 py-2">
                    <Input className="h-8 w-20" type="number" min={0} max={200} value={edit[r.org_id]?.mes ?? String(r.limits.analises_mes ?? 8)}
                      onChange={(e) => setEdit((x) => ({ ...x, [r.org_id]: { mes: e.target.value, dia: x[r.org_id]?.dia ?? String(r.limits.manual_dia ?? 1) } }))} />
                  </td>
                  <td className="px-3 py-2">
                    <Input className="h-8 w-20" type="number" min={0} max={20} value={edit[r.org_id]?.dia ?? String(r.limits.manual_dia ?? 1)}
                      onChange={(e) => setEdit((x) => ({ ...x, [r.org_id]: { mes: x[r.org_id]?.mes ?? String(r.limits.analises_mes ?? 8), dia: e.target.value } }))} />
                  </td>
                  <td className="px-3 py-2"><Button size="sm" variant="outline" disabled={!edit[r.org_id]} onClick={() => void save(r)}>Salvar</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
