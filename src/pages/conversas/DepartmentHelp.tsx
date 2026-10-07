import { useCallback, useEffect, useState } from "react";
import { HeartHandshake, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MicTextarea } from "@/components/MicTextarea";

interface Helper { id: string; department_id: string; note: string | null }

/**
 * Outro setor ajudando sem transferir (Etapa B, item 6): o setor convidado vê a conversa e escreve nota interna; quem
 * responde ao cliente continua sendo o responsável. A ajuda acaba ao finalizar o atendimento ou no "x".
 */
export function HelpersBadges({ orgId, conversationId, refresh }: { orgId: string; conversationId: string; refresh: number }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Helper[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const load = useCallback(async () => {
    const [{ data }, { data: d }] = await Promise.all([
      supabase.from("conversation_helpers").select("id, department_id, note").eq("conversation_id", conversationId).eq("active", true),
      supabase.from("departments").select("id, name").eq("organization_id", orgId),
    ]);
    setRows((data as Helper[]) ?? []);
    setNames(new Map((d ?? []).map((x) => [x.id, x.name])));
  }, [orgId, conversationId]);
  useEffect(() => { void load(); }, [load, refresh]);
  if (!rows.length) return null;
  const end = async (h: Helper) => {
    const { error } = await supabase.rpc("end_department_help", { p_id: h.id });
    if (error) return toast({ variant: "destructive", title: "Não foi possível", description: error.message });
    void load();
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {rows.map((h) => (
        <span key={h.id} title={h.note ?? "Ajudando nesta conversa"} className="inline-flex items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-xs text-info-text">
          <HeartHandshake className="h-3 w-3" /> {names.get(h.department_id) ?? "Setor"} ajudando
          <button type="button" aria-label="Encerrar a ajuda" className="opacity-70 hover:opacity-100" onClick={() => void end(h)}><X className="h-3 w-3" /></button>
        </span>
      ))}
    </span>
  );
}

export function HelpInviteDialog({ orgId, conversationId, currentDept, open, onClose, onDone }: {
  orgId: string; conversationId: string; currentDept: string | null; open: boolean; onClose: () => void; onDone: () => void;
}) {
  const { toast } = useToast();
  const [depts, setDepts] = useState<{ id: string; name: string }[]>([]);
  const [dept, setDept] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setDept(""); setNote("");
    void supabase.from("departments").select("id, name").eq("organization_id", orgId).order("name")
      .then(({ data }) => setDepts((data ?? []).filter((d) => d.id !== currentDept)));
  }, [open, orgId, currentDept]);
  const invite = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("invite_department_help", { p_conv: conversationId, p_dept: dept, p_note: note || null });
    setBusy(false);
    if (error) return toast({ variant: "destructive", title: "Não convidado", description: error.message });
    toast({ title: "Setor convidado", description: "Quem é do setor foi avisado no sino e já vê a conversa. Você continua responsável." });
    onDone(); onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pedir ajuda de outro setor</DialogTitle>
          <DialogDescription>O setor passa a ver esta conversa e pode deixar notas internas para você. O atendimento continua com você — nada é transferido.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label>Setor</Label>
            <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">Escolha o setor</option>
              {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select></div>
          <div className="space-y-1.5"><Label>Do que você precisa (opcional)</Label>
            <MicTextarea orgId={orgId} rows={2} maxLength={500} value={note} onChange={setNote} placeholder="Ex.: o cliente quer saber se o boleto já caiu; podem conferir?" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={busy || !dept} onClick={() => void invite()}>Convidar setor</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
