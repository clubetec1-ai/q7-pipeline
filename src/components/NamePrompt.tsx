import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

/**
 * Quem ainda não tem nome nesta organização informa uma vez. Depois disso,
 * só o dono ou um admin altera (regra no servidor: set_member_name).
 */
export function NamePrompt() {
  const { user } = useAuth();
  const { org } = useOrg();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!org || !user) return;
    supabase.from("organization_members").select("display_name")
      .eq("organization_id", org.id).eq("user_id", user.id).maybeSingle()
      .then(({ data }) => setOpen(!!data && !data.display_name));
  }, [org, user]);

  const save = async () => {
    if (!org || !user) return;
    setBusy(true);
    const { error } = await supabase.rpc("set_member_name", { org: org.id, member: user.id, name });
    setBusy(false);
    if (error) return toast({ variant: "destructive", title: "Nome não salvo", description: error.message });
    setOpen(false);
    toast({ title: "Pronto!", description: "Para mudar depois, fale com o dono ou um admin da empresa." });
  };

  return (
    <Dialog open={open} onOpenChange={() => { /* obrigatório: só fecha salvando */ }}>
      <DialogContent className="[&>button]:hidden" onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Como você quer ser chamado?</DialogTitle>
          <DialogDescription>
            Esse nome aparece para a equipe e na mensagem que o cliente recebe quando você assume um atendimento.
            Depois de salvo, só o dono ou um admin pode alterar.
          </DialogDescription>
        </DialogHeader>
        <Input value={name} maxLength={80} placeholder="Nome e sobrenome" autoFocus
          onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim().length >= 2 && save()} />
        <DialogFooter>
          <Button onClick={save} disabled={busy || name.trim().length < 2}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
