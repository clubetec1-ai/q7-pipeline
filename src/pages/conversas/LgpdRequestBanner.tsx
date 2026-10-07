import { useCallback, useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { MicTextarea } from "@/components/MicTextarea";

interface Req { id: string; created_at: string; canal: string }

/**
 * Pedido do titular para apagar os dados (LGPD art. 18), feito pelo próprio cliente no WhatsApp. Só dono/admin vê
 * (RLS). Atender = "Excluir dados pessoais deste cliente" logo abaixo (fecha o pedido sozinho). Recusar exige o motivo.
 */
export function LgpdRequestBanner({ orgId, contactId }: { orgId: string; contactId: string }) {
  const { toast } = useToast();
  const [req, setReq] = useState<Req | null>(null);
  const [motivo, setMotivo] = useState("");
  const [recusar, setRecusar] = useState(false);
  const load = useCallback(async () => {
    const { data } = await supabase.from("lgpd_requests").select("id, created_at, canal")
      .eq("organization_id", orgId).eq("contact_id", contactId).eq("status", "aberto").maybeSingle();
    setReq((data as Req | null) ?? null);
  }, [orgId, contactId]);
  useEffect(() => { void load(); }, [load]);
  if (!req) return null;
  const prazo = new Date(new Date(req.created_at).getTime() + 15 * 86_400_000).toLocaleDateString("pt-BR");
  const decline = async () => {
    const { error } = await supabase.rpc("decline_lgpd_request", { p_id: req.id, p_motivo: motivo });
    if (error) return toast({ variant: "destructive", title: "Não salvo", description: error.message });
    toast({ title: "Pedido recusado", description: "Responda ao cliente explicando o motivo." });
    setRecusar(false); setMotivo(""); void load();
  };
  return (
    <div className="mt-6 rounded-md border border-warning/50 bg-warning-soft/40 p-3 space-y-2 text-sm">
      <p className="flex items-start gap-2 font-medium"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        Este cliente pediu para apagar os dados dele (LGPD) em {new Date(req.created_at).toLocaleDateString("pt-BR")}. Responda até {prazo}.</p>
      <p className="text-xs text-muted-foreground">
        Para atender, use "Excluir dados pessoais deste cliente" abaixo — o pedido fecha sozinho. Se algum dado precisa ficar
        guardado por lei (ex.: registros obrigatórios), recuse explicando o motivo e avise o cliente.
      </p>
      {!recusar ? (
        <Button size="sm" variant="outline" onClick={() => setRecusar(true)}>Recusar com motivo</Button>
      ) : (
        <div className="space-y-1">
          <MicTextarea orgId={orgId} rows={2} maxLength={1000} value={motivo} onChange={setMotivo}
            placeholder="Ex.: os registros de atos do cartório precisam ser guardados por obrigação legal." />
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" disabled={motivo.trim().length < 10} onClick={() => void decline()}>Recusar</Button>
            <Button size="sm" variant="ghost" onClick={() => setRecusar(false)}>Cancelar</Button>
          </div>
        </div>
      )}
    </div>
  );
}
