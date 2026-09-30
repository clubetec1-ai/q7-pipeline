import { useState } from "react";
import { MailX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * E-mail automático (newsletter, aviso, boleto de fornecedor) que virou atendimento:
 * "Não é atendimento" fecha o atendimento e, daqui para frente, ignora o
 * remetente ou o domínio inteiro. O dono desfaz em Configurações → E-mail.
 */
export function EmailIgnoreButton({ conversationId, email, onDone }: { conversationId: string; email: string; onDone: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const domain = email.split("@")[1] ?? "";
  const run = async (whole: boolean) => {
    setBusy(true);
    const { data, error } = await supabase.rpc("ignore_email_sender", { conv: conversationId, whole_domain: whole });
    setBusy(false);
    setOpen(false);
    if (error) return toast({ variant: "destructive", title: "Não foi possível", description: error.message });
    toast({ title: "Não é atendimento", description: `Atendimento fechado. E-mails de ${data} não abrem mais atendimento.` });
    onDone();
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-8" title="E-mail automático, propaganda ou aviso"><MailX className="w-4 h-4 mr-1" /> Não é atendimento</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-2 text-sm">
        <p>Fecha este atendimento e deixa de abrir atendimento para:</p>
        <Button size="sm" variant="outline" className="w-full justify-start" disabled={busy} onClick={() => run(false)}>Só este remetente ({email})</Button>
        {domain && <Button size="sm" variant="outline" className="w-full justify-start" disabled={busy} onClick={() => run(true)}>Todo o domínio @{domain}</Button>}
        <p className="text-xs text-muted-foreground">Os e-mails continuam na sua caixa; só não viram atendimento. Dá para desfazer em Configurações → E-mail.</p>
      </PopoverContent>
    </Popover>
  );
}
