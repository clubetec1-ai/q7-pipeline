import { useEffect, useState } from "react";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

/**
 * Rascunho de proposta pela IA (ficha do cliente + conversa + documentos da empresa).
 * Nada sai sozinho: a pessoa revisa, troca os [valor a confirmar] e decide enviar.
 */
export function ProposalDialog({ conversationId, open, onClose, onSent }: { conversationId: string; open: boolean; onClose: () => void; onSent: () => void }) {
  const { org } = useOrg();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const generate = async () => {
    if (!org) return;
    setLoading(true);
    const r = await callFunction<{ text: string }>("proposal", { organization_id: org.id, conversation_id: conversationId });
    setLoading(false);
    if (!r.ok) return toast({ variant: "destructive", title: "Não foi possível gerar", description: r.message });
    setText(r.data?.text ?? "");
  };
  useEffect(() => { if (open && !text) void generate(); /* gera ao abrir */ }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pending = /\[(valor|prazo)[^\]]*\]/i.test(text);
  const send = async () => {
    setSending(true);
    const r = await callFunction("send-message", { conversation_id: conversationId, text: text.trim() });
    setSending(false);
    if (!r.ok) return toast({ variant: "destructive", title: "Não enviou", description: r.message });
    toast({ title: "Proposta enviada" });
    onSent();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Proposta (rascunho da IA)</DialogTitle>
          <DialogDescription>
            Feita com a ficha do cliente, a conversa e os documentos da empresa. Revise antes de enviar: preço e prazo só
            aparecem se estiverem nos documentos; o resto fica como [a confirmar].
          </DialogDescription>
        </DialogHeader>
        {loading ? <p className="text-sm text-muted-foreground py-8 text-center">Escrevendo a proposta…</p> : (
          <Textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} className="text-sm" />
        )}
        {pending && !loading && <p className="text-xs text-warning-text bg-warning-soft rounded-md px-3 py-2">Ainda há campos [a confirmar]. Preencha antes de enviar.</p>}
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={loading} onClick={() => void generate()}>Gerar de novo</Button>
          <Button variant="outline" disabled={!text} onClick={() => void navigator.clipboard?.writeText(text).then(() => toast({ title: "Copiado" }))}>Copiar</Button>
          <Button disabled={!text.trim() || loading || sending || pending} onClick={() => void send()}>{sending ? "Enviando…" : "Enviar ao cliente"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
