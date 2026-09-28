import { useEffect, useState } from "react";
import { PhoneIncoming, PhoneMissed, PhoneOutgoing } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Call { id: string; direction: string; status: string; started_at: string; duration_s: number | null; user_id: string | null }
const STATUS: Record<string, string> = { ringing: "tocando", answered: "em ligação", missed: "perdida", ended: "atendida", failed: "não completou" };
const dur = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "");

/** Ligações do cliente (só as que a pessoa pode ver: RLS). */
export function ContactCalls({ contactId, nameOf }: { contactId: string; nameOf: (id: string) => string }) {
  const [calls, setCalls] = useState<Call[]>([]);
  useEffect(() => {
    void supabase.from("calls").select("id, direction, status, started_at, duration_s, user_id")
      .eq("contact_id", contactId).order("started_at", { ascending: false }).limit(30)
      .then(({ data }) => setCalls((data as Call[]) ?? []));
  }, [contactId]);
  if (!calls.length) return null;
  return (
    <div className="mt-5 space-y-1.5">
      <p className="text-sm font-medium">Ligações</p>
      {calls.map((c) => {
        const Icon = c.status === "missed" ? PhoneMissed : c.direction === "in" ? PhoneIncoming : PhoneOutgoing;
        return (
          <div key={c.id} className="flex items-center gap-2 text-xs">
            <Icon className={`w-3.5 h-3.5 ${c.status === "missed" ? "text-red-500" : "text-muted-foreground"}`} />
            <span>{new Date(c.started_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
            <span className="text-muted-foreground">{c.direction === "in" ? "recebida" : "feita"} · {STATUS[c.status] ?? c.status} {dur(c.duration_s)}</span>
            {c.user_id && <span className="ml-auto truncate">{nameOf(c.user_id)}</span>}
          </div>
        );
      })}
    </div>
  );
}
