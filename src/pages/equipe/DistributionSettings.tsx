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
  dept, canManage, onSaved,
}: { dept: Department | undefined; canManage: boolean; onSaved: () => void }) {
  const { toast } = useToast();
  if (!dept) return null;

  const save = async (patch: Partial<Pick<Department, "distribution_mode" | "max_concurrent">>) => {
    const { error } = await supabase.from("departments").update(patch).eq("id", dept.id);
    if (error) return toast({ variant: "destructive", title: "Não foi possível salvar" });
    onSaved();
  };

  return (
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
  );
}
