import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface Ticket {
  id: string;
  conversation_id: string;
  protocol: string;
  status: "bot" | "queued" | "open" | "closed";
  assigned_to: string | null;
  department_id: string | null;
  external_reply: boolean;
  overflow_at?: string | null;
}

export type TicketTab = "meus" | "fila" | "ia" | "todos";

export const STATUS_LABEL: Record<Ticket["status"], string> = {
  bot: "IA",
  queued: "Na fila",
  open: "Em atendimento",
  closed: "Finalizado",
};

/** Atendimentos abertos visíveis ao usuário (a RLS filtra), ao vivo. */
export function useTickets(orgId: string | undefined, userId: string | undefined) {
  const [tickets, setTickets] = useState<Ticket[]>([]);

  const reload = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase
      .from("tickets")
      .select("id, conversation_id, protocol, status, assigned_to, department_id, external_reply, overflow_at")
      .eq("organization_id", orgId)
      .neq("status", "closed");
    setTickets((data as Ticket[]) ?? []);
  }, [orgId]);

  useEffect(() => {
    reload();
    if (!orgId) return;
    const ch = supabase
      .channel("tickets-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, () => reload())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [orgId, reload]);

  const byConversation = useMemo(() => new Map(tickets.map((t) => [t.conversation_id, t])), [tickets]);

  /** Em qual aba a conversa aparece. Sem atendimento aberto → só em "todos". */
  const inTab = useCallback(
    (conversationId: string, tab: TicketTab) => {
      if (tab === "todos") return true;
      const t = byConversation.get(conversationId);
      if (!t) return false;
      if (tab === "meus") return t.assigned_to === userId;
      if (tab === "ia") return t.status === "bot";
      return t.status !== "bot" && !t.assigned_to; // fila: sem responsável
    },
    [byConversation, userId],
  );

  return { tickets, byConversation, inTab, reload };
}
