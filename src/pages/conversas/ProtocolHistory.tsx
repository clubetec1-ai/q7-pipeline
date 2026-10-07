import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { STATUS_LABEL, type Ticket } from "./useTickets";

interface Row {
  id: string; protocol: string; status: string; created_at: string; closed_at: string | null;
  assigned_to: string | null; department_id: string | null;
}

const fmt = (d: string) => new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** Todos os atendimentos (protocolos) do contato, em qualquer número. RLS decide o que cada um vê. */
export function ProtocolHistory({ orgId, contactId, nameOf }: {
  orgId: string; contactId: string; nameOf: (id: string) => string;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [depts, setDepts] = useState<Map<string, string>>(new Map());
  const [prefDepts, setPrefDepts] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      const [{ data: convs }, { data: d }] = await Promise.all([
        supabase.from("conversations").select("id").eq("organization_id", orgId).eq("contact_id", contactId),
        supabase.from("departments").select("id, name, preferred_agent").eq("organization_id", orgId),
      ]);
      setDepts(new Map((d ?? []).map((x) => [x.id, x.name])));
      setPrefDepts(new Set((d ?? []).filter((x) => x.preferred_agent).map((x) => x.id)));
      const ids = (convs ?? []).map((c) => c.id);
      if (!ids.length) return setRows([]);
      const { data } = await supabase.from("tickets")
        .select("id, protocol, status, created_at, closed_at, assigned_to, department_id")
        .eq("organization_id", orgId).in("conversation_id", ids).order("created_at", { ascending: false }).limit(100);
      setRows((data as Row[]) ?? []);
    })();
  }, [orgId, contactId]);

  const shown = rows.filter((r) => !q.trim() || r.protocol.includes(q.trim()));
  // Atendente preferencial: quem atendeu este cliente por último (é para essa pessoa que ele volta nos setores com a opção ligada).
  const last = rows.find((r) => r.assigned_to);
  return (
    <div className="space-y-2">
      {last && (
        <p className="rounded-md bg-muted/50 p-2 text-xs">
          <b>Atendente preferencial:</b> {nameOf(last.assigned_to!)} (atendeu por último em {fmt(last.created_at)}).{" "}
          {last.department_id && prefDepts.has(last.department_id)
            ? "Quando este cliente voltar, o atendimento vai direto para essa pessoa se ela estiver online."
            : "O setor não usa o atendente preferencial (liga em Equipe → Departamentos)."}
        </p>
      )}
      <Input className="h-8" placeholder="Buscar protocolo" value={q} onChange={(e) => setQ(e.target.value)} />
      {shown.length === 0 && <p className="text-xs text-muted-foreground">Nenhum atendimento encontrado.</p>}
      {shown.map((r) => (
        <div key={r.id} className="rounded-md border p-2 text-sm space-y-0.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono font-medium">#{r.protocol}</span>
            <Badge variant={r.status === "closed" ? "outline" : "secondary"} className="text-xs">
              {STATUS_LABEL[r.status as Ticket["status"]] ?? r.status}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground">
            Aberto {fmt(r.created_at)}{r.closed_at ? ` · finalizado ${fmt(r.closed_at)}` : ""}
          </div>
          <div className="text-xs text-muted-foreground">
            {r.department_id ? depts.get(r.department_id) ?? "Departamento" : "Fila geral"}
            {r.assigned_to ? ` · ${nameOf(r.assigned_to)}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}
