import { useCallback, useEffect, useState } from "react";
import { requestCall } from "@/lib/requestCall";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface Notification { id: string; kind: string; ref: Record<string, string>; read_at: string | null; created_at: string }

const TEXT: Record<string, (r: Record<string, string>) => string> = {
  mention: () => "Você foi mencionado numa nota interna",
  assigned: (r) => `Atendimento #${r.protocol ?? ""} atribuído a você`,
  transferred: (r) => `Atendimento #${r.protocol ?? ""} transferido para você${r.note ? ` — ${r.note}` : ""}`,
  taken_over: (r) => `Atendimento #${r.protocol ?? ""} foi assumido por outra pessoa`,
  charge_paid: (r) => `Pagamento recebido: R$ ${Number(r.value ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
  email_health: (r) => `Caixa de e-mail ${r.name ?? ""}: ${r.error ?? "precisa de atenção"}`,
  team_mention: (r) => `Você foi mencionado no chat da equipe: ${r.text ?? ""}`,
  process_reminder: (r) => `⏰ Lembrete: implementar "${r.nome ?? ""}"${r.setor ? ` (${r.setor})` : ""} — veja o plano no Diagnóstico`,
  missed_call: (r) => `📞 Ligação perdida de ${r.phone ?? ""} — clique para retornar`,
  improvement: (r) => `${r.source === "monitor" ? "Correção" : "Melhoria"} para aprovar: ${r.title ?? ""}`,
  security_alert: (r) => `⚠ Segurança: ${r.name ?? "alguém da equipe"} tentou exportar contatos sem permissão (bloqueado)`,
  number_health: (r) => `Número ${r.name ?? ""}: ${r.error ?? (r.status === "disconnected" ? "desconectado" : "precisa de atenção")}`,
};

/** Sino de notificações (menção, atribuição, transferência), ao vivo. */
export function NotificationsBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[]>([]);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from("notifications")
      .select("id, kind, ref, read_at, created_at").order("created_at", { ascending: false }).limit(20);
    setItems((data as Notification[]) ?? []);
  }, [user]);

  useEffect(() => {
    load();
    if (!user) return;
    const ch = supabase.channel("notifications-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, load]);

  const unread = items.filter((n) => !n.read_at).length;

  const open = async (n: Notification) => {
    if (!n.read_at) await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
    load();
    if (n.ref.conversation_id) navigate(`/?open=${n.ref.conversation_id}`);
    else if (n.kind === "number_health" || n.kind === "email_health") navigate("/numeros");
    else if (n.kind === "security_alert") navigate("/supervisor");
    else if (n.kind === "improvement") navigate("/melhorias");
    else if (n.kind === "team_mention") navigate("/chat");
    else if (n.kind === "process_reminder") navigate("/diagnostico");
    else if (n.kind === "missed_call" && n.ref.phone) requestCall(String(n.ref.phone));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" title="Notificações">
          <Bell className="w-4 h-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 rounded-full bg-destructive text-destructive-foreground text-[10px] leading-4 px-1">
              {unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="p-3 border-b text-sm font-medium">Notificações</div>
        <div className="max-h-80 overflow-y-auto">
          {items.length === 0 && <p className="p-3 text-sm text-muted-foreground">Nada por aqui.</p>}
          {items.map((n) => (
            <button key={n.id} type="button" onClick={() => open(n)}
              className={`w-full text-left px-3 py-2 text-sm border-b hover:bg-muted ${n.read_at ? "text-muted-foreground" : "font-medium"}`}>
              {(TEXT[n.kind] ?? (() => n.kind))(n.ref)}
              <div className="text-[11px] text-muted-foreground font-normal">
                {new Date(n.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
              </div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
