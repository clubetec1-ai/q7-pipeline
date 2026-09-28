import { useEffect, useState } from "react";
import { Banknote } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

const inDays = (n: number) => new Date(Date.now() - 3 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);

/** "Cobrar" na conversa: cria a cobrança no Asaas e envia link + PIX copia e cola. */
export function ChargeButton({ conversationId }: { conversationId: string }) {
  const { org, can } = useOrg();
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState("");
  const [due, setDue] = useState(inDays(3));
  const [desc, setDesc] = useState("");

  useEffect(() => {
    if (!org) return;
    supabase.from("organizations").select("settings").eq("id", org.id).maybeSingle().then(({ data }) => {
      const p = ((data?.settings ?? {}) as Record<string, any>).payments ?? {};
      const allowed = can("org.settings") || can("reports.view") || (p.allow_agents === true && can("conversations.attend"));
      setEnabled(p.provider === "asaas" && allowed);
    });
  }, [org, can]);
  if (!enabled || !org) return null;

  const submit = async () => {
    setBusy(true);
    const r = await callFunction<{ sent: boolean; send_error: string | null; invoice_url: string | null }>("payments", {
      action: "create", organization_id: org.id, conversation_id: conversationId, value, due_date: due, description: desc, send: true,
    });
    setBusy(false);
    if (!r.ok) return toast({ variant: "destructive", title: "Cobrança não criada", description: r.message });
    toast(r.data.sent
      ? { title: "Cobrança enviada", description: "O cliente recebeu o link e o PIX copia e cola." }
      : { variant: "destructive", title: "Cobrança criada, mas a mensagem não saiu", description: r.data.send_error ?? "" });
    setOpen(false); setValue(""); setDesc(""); setDue(inDays(3));
  };

  return (
    <>
      <Button size="sm" variant="ghost" className="h-8" onClick={() => setOpen(true)} title="Enviar cobrança por PIX/boleto">
        <Banknote className="w-3.5 h-3.5 mr-1" /> Cobrar
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova cobrança</DialogTitle>
            <DialogDescription>O cliente recebe nesta conversa o link de pagamento (PIX, boleto ou cartão) e o PIX copia e cola. O CPF/CNPJ precisa estar na ficha.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label className="text-xs">Valor (R$)</Label>
                <Input inputMode="decimal" placeholder="0,00" value={value} onChange={(e) => setValue(e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Vencimento</Label>
                <Input type="date" min={inDays(0)} value={due} onChange={(e) => setDue(e.target.value)} /></div>
            </div>
            <div className="space-y-1"><Label className="text-xs">Descrição (opcional)</Label>
              <Input maxLength={300} placeholder="ex.: mensalidade de outubro" value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
          </div>
          <DialogFooter><Button onClick={submit} disabled={busy || !value}>{busy ? "Criando..." : "Criar e enviar"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
