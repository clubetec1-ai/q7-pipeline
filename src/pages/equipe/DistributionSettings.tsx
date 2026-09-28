import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Department } from "./useEquipeData";

/**
 * Como a fila do departamento é distribuída: manual (quem quiser assume) ou
 * automática (vai para quem está online, com menos atendimentos, até o limite).
 */
export function DistributionSettings({
  dept, all, canManage, onSaved,
}: { dept: Department | undefined; all: Department[]; canManage: boolean; onSaved: () => void }) {
  const { toast } = useToast();
  if (!dept) return null;
  const others = all.filter((d) => d.id !== dept.id);

  const save = async (patch: Partial<Pick<Department, "distribution_mode" | "max_concurrent" | "overflow_to" | "overflow_after_minutes">>) => {
    const { error } = await supabase.from("departments").update(patch).eq("id", dept.id);
    if (error) return toast({ variant: "destructive", title: "Não foi possível salvar" });
    onSaved();
  };

  // Transbordo: marcar setor ajudante liga (5 min por padrão); desmarcar todos desliga.
  const toggleHelper = (id: string) => {
    const next = dept.overflow_to.includes(id) ? dept.overflow_to.filter((x) => x !== id) : [...dept.overflow_to, id];
    save({ overflow_to: next, overflow_after_minutes: next.length ? dept.overflow_after_minutes ?? 5 : null });
  };

  return (
    <div className="space-y-2">
    <div className="flex items-center gap-2 text-xs">
      <Select value={dept.distribution_mode} disabled={!canManage}
        onValueChange={(v) => save({ distribution_mode: v })}>
        <SelectTrigger className="h-8 flex-1"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="manual">Fila manual</SelectItem>
          <SelectItem value="auto">Distribuição automática</SelectItem>
        </SelectContent>
      </Select>
      {dept.distribution_mode === "auto" && (
        <label className="flex items-center gap-1 shrink-0" title="Atendimentos simultâneos por pessoa">
          até
          <Input type="number" min={1} max={100} defaultValue={dept.max_concurrent} disabled={!canManage}
            className="h-8 w-16"
            onBlur={(e) => {
              const n = Math.min(100, Math.max(1, Number(e.target.value) || 5));
              if (n !== dept.max_concurrent) save({ max_concurrent: n });
            }} />
          por pessoa
        </label>
      )}
    </div>
    {others.length > 0 && (canManage || dept.overflow_to.length > 0) && (
      <div className="rounded-md bg-muted/50 p-2 space-y-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-1">
          <span>Se a fila esperar mais de</span>
          <Input type="number" min={1} max={240} key={dept.overflow_after_minutes ?? 0}
            defaultValue={dept.overflow_after_minutes ?? 5} disabled={!canManage || !dept.overflow_to.length}
            className="h-7 w-14"
            onBlur={(e) => {
              const n = Math.min(240, Math.max(1, Number(e.target.value) || 5));
              if (dept.overflow_to.length && n !== dept.overflow_after_minutes) save({ overflow_after_minutes: n });
            }} />
          <span>min, pedir ajuda de:</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {others.map((o) => {
            const on = dept.overflow_to.includes(o.id);
            return (
              <button key={o.id} type="button" disabled={!canManage} onClick={() => toggleHelper(o.id)}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition ${on ? "bg-primary text-primary-foreground border-primary" : "hover:bg-background"}`}>
                <span className="w-2 h-2 rounded-full" style={{ background: o.color ?? "#94A3B8" }} />{o.name}
              </button>
            );
          })}
        </div>
        <p className="text-muted-foreground">
          {dept.overflow_to.length
            ? "Quem é desses setores vê e pode assumir os atendimentos parados na fila. Na distribuição automática, eles recebem quando ninguém daqui está livre."
            : "Desligado: só este setor atende a própria fila."}
        </p>
      </div>
    )}
    </div>
  );
}
