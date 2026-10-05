import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const ACTION: Record<string, string> = {
  "brain.proposed": "Cérebro sugeriu", "improvement.approved": "Aprovada", "improvement.live": "Foi ao ar",
  "improvement.result": "Resultado medido", "improvement.discarded": "Descartada", "improvement.nudged": "Cobrada pelo dono",
  "brain.reminder": "Lembrete automático", "brain.escalated": "Escalada ao dono", "improvement.due": "Prazo definido",
  "improvement.area": "Área definida", "improvement.process": "Ligada a processo", "goal.saved": "Meta definida",
  "goal.ativa": "Meta aprovada", "goal.encerrada": "Meta encerrada", "goal.atingida": "Meta atingida",
  "area.created": "Área criada", "area.saved": "Área alterada", "area.seeded": "Áreas sugeridas",
};

interface Item { action: string; at: string; title: string; who: string }

/** "O que a área fez" (últimos 60 dias): da auditoria, só ação, data, título e quem. */
export function AreaActivity({ orgId, areaId }: { orgId: string; areaId: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  useEffect(() => {
    void supabase.rpc("area_activity", { org: orgId, area: areaId, since: null }).then(({ data }) => setItems((data as unknown as Item[]) ?? []));
  }, [orgId, areaId]);
  if (!items) return <p className="text-xs text-muted-foreground">Carregando…</p>;
  if (!items.length) return <p className="text-xs text-muted-foreground">Nada registrado nos últimos 60 dias.</p>;
  return (
    <ul className="space-y-1 text-xs max-h-56 overflow-y-auto">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2">
          <span className="w-20 shrink-0 text-muted-foreground tabular-nums">{new Date(it.at).toLocaleDateString("pt-BR")}</span>
          <span className="flex-1 min-w-0"><span className="font-medium">{ACTION[it.action] ?? it.action}</span>{it.title ? ` · ${it.title}` : ""}</span>
          <span className="text-muted-foreground shrink-0">{it.who}</span>
        </li>
      ))}
    </ul>
  );
}

/** Só busca o histórico quando a pessoa abre. */
export function AreaActivityDetails({ orgId, areaId }: { orgId: string; areaId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="text-sm" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-xs text-muted-foreground">O que a área fez</summary>
      {open && <div className="mt-2"><AreaActivity orgId={orgId} areaId={areaId} /></div>}
    </details>
  );
}
