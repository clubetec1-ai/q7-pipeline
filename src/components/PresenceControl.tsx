import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Reason { id: string; name: string }

const DOT: Record<string, string> = { online: "bg-emerald-500", paused: "bg-amber-500", offline: "bg-slate-400" };

/**
 * Presença do atendente (spec atendimento §5.1): online, pausa (com motivo) ou
 * offline. Enquanto a tela está aberta manda um sinal por minuto; sem sinal
 * há 3 min, a distribuição automática deixa de enviar atendimentos.
 */
export function PresenceControl() {
  const { user } = useAuth();
  const { org, can } = useOrg();
  const { toast } = useToast();
  const [status, setStatus] = useState("offline");
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Reason[]>([]);
  const canAttend = can("conversations.attend");

  useEffect(() => {
    if (!org || !user || !canAttend) return;
    Promise.all([
      supabase.from("agent_presence").select("status, pause_reason_id")
        .eq("organization_id", org.id).eq("user_id", user.id).maybeSingle(),
      supabase.from("pause_reasons").select("id, name").eq("organization_id", org.id).eq("active", true).order("position"),
    ]).then(([p, r]) => {
      setStatus(p.data?.status ?? "offline");
      setReasonId(p.data?.pause_reason_id ?? null);
      setReasons((r.data as Reason[]) ?? []);
    });
    supabase.rpc("heartbeat", { org: org.id });
    const id = window.setInterval(() => supabase.rpc("heartbeat", { org: org.id }), 60_000);
    return () => window.clearInterval(id);
  }, [org, user, canAttend]);

  if (!org || !canAttend) return null;

  const change = async (value: string) => {
    const [next, reason] = value.startsWith("paused:") ? ["paused", value.slice(7)] : [value, null];
    const { error } = await supabase.rpc("set_presence", { org: org.id, new_status: next, reason });
    if (error) return toast({ variant: "destructive", title: error.message });
    setStatus(next);
    setReasonId(reason);
  };

  const value = status === "paused" && reasonId ? `paused:${reasonId}` : status;
  return (
    <Select value={value} onValueChange={change}>
      <SelectTrigger className="h-8 w-[150px] text-xs" aria-label="Minha presença">
        <span className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${DOT[status] ?? DOT.offline}`} />
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="online">Online</SelectItem>
        <SelectSeparator />
        {reasons.map((r) => <SelectItem key={r.id} value={`paused:${r.id}`}>Pausa · {r.name}</SelectItem>)}
        <SelectSeparator />
        <SelectItem value="offline">Offline</SelectItem>
      </SelectContent>
    </Select>
  );
}
