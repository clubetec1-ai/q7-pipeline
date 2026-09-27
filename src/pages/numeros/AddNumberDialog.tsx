import { useEffect, useRef, useState } from "react";
import { ShieldCheck, QrCode, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { callFunction } from "@/lib/callFunction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type Step = "choose" | "meta" | "uazapi-name" | "uazapi-qr";

/**
 * Assistente "Adicionar número": Meta oficial (manual, com conferência de
 * posse no servidor) ou Uazapi por QR Code (webhook configurado sozinho).
 * Também reabre só o passo do QR para reconectar um número existente.
 */
export function AddNumberDialog({
  open, orgId, reconnectId, onClose, onDone,
}: {
  open: boolean;
  orgId: string;
  reconnectId?: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("choose");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [pnid, setPnid] = useState("");
  const [waba, setWaba] = useState("");
  const [token, setToken] = useState("");
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const poll = useRef<number | null>(null);

  const stopPoll = () => {
    if (poll.current) window.clearInterval(poll.current);
    poll.current = null;
  };

  useEffect(() => {
    if (!open) {
      stopPoll();
      setStep("choose");
      setName(""); setPnid(""); setWaba(""); setToken("");
      setInstanceId(null); setQr(null);
    } else if (reconnectId) {
      setInstanceId(reconnectId);
      setStep("uazapi-qr");
      void showQr(reconnectId);
    }
    return stopPoll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reconnectId]);

  const fail = (message: string) => toast({ variant: "destructive", title: message });

  const connectMeta = async () => {
    setBusy(true);
    const r = await callFunction("meta-onboard", {
      action: "manual", organization_id: orgId, phone_number_id: pnid, waba_id: waba, access_token: token, name,
    });
    setBusy(false);
    if (!r.ok) return fail(r.message);
    toast({ title: "Número conectado!", description: "Já pode receber e enviar pela API oficial da Meta." });
    onDone();
  };

  const showQr = async (id: string) => {
    setBusy(true);
    const r = await callFunction<{ qrcode?: string; already_connected?: boolean }>("manage-instance", {
      action: "connect", instance_id: id,
    });
    setBusy(false);
    if (!r.ok) return fail(r.message);
    if (r.data.already_connected) return finish(id);
    setQr(r.data.qrcode ?? null);
    stopPoll();
    poll.current = window.setInterval(async () => {
      const s = await callFunction<{ connected?: boolean; name?: string; phone?: string }>("manage-instance", {
        action: "status", instance_id: id,
      });
      if (s.ok && s.data.connected) {
        stopPoll();
        await supabase.from("whatsapp_instances")
          .update({ status: "connected", ...(s.data.phone ? { phone: String(s.data.phone).replace(/\D/g, "") } : {}) })
          .eq("id", id);
        finish(id);
      }
    }, 4000);
  };

  const createUazapi = async () => {
    setBusy(true);
    const r = await callFunction<{ instance_id: string }>("manage-instance", {
      action: "create", organization_id: orgId, name: name.trim(),
    });
    setBusy(false);
    if (!r.ok) return fail(r.message);
    setInstanceId(r.data.instance_id);
    setStep("uazapi-qr");
    await showQr(r.data.instance_id);
  };

  const finish = (_id: string) => {
    toast({ title: "WhatsApp conectado!" });
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{reconnectId ? "Reconectar número" : "Adicionar número"}</DialogTitle>
          <DialogDescription>
            {step === "choose" && "Escolha como o número vai se conectar."}
            {step === "meta" && "Dados do WhatsApp Manager da Meta. Conferimos com a Meta antes de salvar."}
            {step === "uazapi-name" && "Dê um nome para identificar este número na equipe."}
            {step === "uazapi-qr" && "No celular: WhatsApp → Aparelhos conectados → Conectar aparelho, e leia o código."}
          </DialogDescription>
        </DialogHeader>

        {step === "choose" && (
          <div className="grid gap-3">
            <button type="button" onClick={() => setStep("meta")}
              className="text-left rounded-lg border p-4 hover:bg-muted transition">
              <div className="flex items-center gap-2 font-medium"><ShieldCheck className="w-4 h-4 text-primary" /> WhatsApp oficial (Meta) — recomendado</div>
              <p className="text-sm text-muted-foreground mt-1">API oficial, sem risco de bloqueio. Precisa de conta no WhatsApp Business Platform.</p>
            </button>
            <button type="button" onClick={() => setStep("uazapi-name")}
              className="text-left rounded-lg border p-4 hover:bg-muted transition">
              <div className="flex items-center gap-2 font-medium"><QrCode className="w-4 h-4" /> Por QR Code (Uazapi)</div>
              <p className="text-sm text-muted-foreground mt-1">Conecta um WhatsApp comum lendo o código. API não oficial: o número pode ser bloqueado — use para números secundários.</p>
            </button>
          </div>
        )}

        {step === "meta" && (
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Nome na equipe (opcional)</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Comercial" /></div>
            <div className="space-y-1.5"><Label>Phone Number ID</Label>
              <Input value={pnid} onChange={(e) => setPnid(e.target.value.trim())} inputMode="numeric" /></div>
            <div className="space-y-1.5"><Label>WABA ID</Label>
              <Input value={waba} onChange={(e) => setWaba(e.target.value.trim())} inputMode="numeric" /></div>
            <div className="space-y-1.5"><Label>Access Token permanente</Label>
              <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
              <p className="text-xs text-muted-foreground">Fica guardado cifrado no cofre; ninguém da equipe consegue ver depois.</p></div>
          </div>
        )}

        {step === "uazapi-name" && (
          <div className="space-y-3">
            <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
              API não oficial: o WhatsApp pode bloquear o número. Recomendado para números secundários.
            </div>
            <div className="space-y-1.5"><Label>Nome na equipe</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Suporte" /></div>
          </div>
        )}

        {step === "uazapi-qr" && (
          <div className="flex flex-col items-center gap-3 py-2">
            {qr ? <img src={qr} alt="QR Code para conectar o WhatsApp" className="w-64 h-64 rounded-md bg-white p-2" />
              : <div className="w-64 h-64 rounded-md border flex items-center justify-center text-sm text-muted-foreground">
                  {busy ? "Gerando código..." : "Código indisponível"}</div>}
            <p className="text-xs text-muted-foreground">Esperando a leitura… a tela fecha sozinha quando conectar.</p>
            <Button variant="outline" size="sm" disabled={busy || !instanceId} onClick={() => instanceId && showQr(instanceId)}>
              Gerar novo código
            </Button>
          </div>
        )}

        <DialogFooter>
          {step !== "choose" && step !== "uazapi-qr" && !reconnectId && (
            <Button variant="ghost" onClick={() => setStep("choose")}>Voltar</Button>
          )}
          {step === "meta" && (
            <Button onClick={connectMeta} disabled={busy || !pnid || !waba || !token}>
              {busy ? "Conferindo com a Meta..." : "Conectar"}</Button>
          )}
          {step === "uazapi-name" && (
            <Button onClick={createUazapi} disabled={busy || !name.trim()}>{busy ? "Criando..." : "Continuar"}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
