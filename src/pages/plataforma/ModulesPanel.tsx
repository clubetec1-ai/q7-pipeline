import { useCallback, useEffect, useState } from "react";
import { Boxes } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { MODULE_INFO } from "@/components/ModuleGate";
import type { ModuleKey } from "@/contexts/OrgContext";
import { Switch } from "@/components/ui/switch";

const KEYS = Object.keys(MODULE_INFO) as ModuleKey[];

/**
 * Módulos por empresa (só a Clubetec): liga/desliga cada módulo. A base
 * "Atendimento" é sempre ativa. Desligar trava no banco e no servidor; nada é apagado.
 */
export function ModulesPanel({ orgs }: { orgs: { id: string; name: string }[] }) {
  const { toast } = useToast();
  const [orgId, setOrgId] = useState("");
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) { setOn({}); return; }
    const { data } = await supabase.from("org_modules").select("module, enabled").eq("organization_id", orgId);
    setOn(Object.fromEntries((data ?? []).map((r) => [r.module, r.enabled])));
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (orgs.length === 1 && !orgId) setOrgId(orgs[0].id); }, [orgs, orgId]);

  const toggle = async (m: ModuleKey, v: boolean) => {
    if (!v && !window.confirm(`Desligar "${MODULE_INFO[m].label}"? A empresa deixa de usar o módulo na hora (nada é apagado; religar volta como estava).`)) return;
    setBusy(m);
    const { error } = await supabase.rpc("platform_set_module", { org: orgId, m, on_off: v });
    setBusy(null);
    if (error) return toast({ variant: "destructive", title: "Não salvou", description: error.message });
    setOn((o) => ({ ...o, [m]: v }));
  };

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="font-semibold flex items-center gap-2"><Boxes className="w-4 h-4" /> Módulos por empresa</h2>
      <p className="text-sm text-muted-foreground">A base <b>Atendimento</b> (Conversas, Kanban, contatos, etiquetas, equipe, chat, 1 número e relatórios básicos) é sempre ativa.
        Os módulos abaixo são ligados por empresa; desligar bloqueia no banco e no servidor, sem apagar nada.</p>
      <select className="h-9 rounded-md border bg-background px-2 text-sm" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
        <option value="">Escolha a empresa…</option>
        {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      {orgId && (
        <div className="grid gap-2 sm:grid-cols-2">
          {KEYS.map((m) => (
            <label key={m} className="flex items-start gap-3 rounded-md border p-3 cursor-pointer">
              <Switch checked={!!on[m]} disabled={busy === m} onCheckedChange={(v) => void toggle(m, v)} />
              <span className="text-sm">
                <span className="font-medium block">{MODULE_INFO[m].label}</span>
                <span className="text-xs text-muted-foreground">{MODULE_INFO[m].desc}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
