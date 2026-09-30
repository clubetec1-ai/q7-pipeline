import { useCallback, useEffect, useState } from "react";
import { MailX, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

/** Remetentes marcados como "Não é atendimento" (e-mail exato ou @domínio). O dono/admin pode desfazer. */
export function IgnoredSenders({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<{ pattern: string }[]>([]);
  const load = useCallback(async () => {
    const { data } = await supabase.from("email_ignore").select("pattern").eq("organization_id", orgId).order("pattern");
    setRows(data ?? []);
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);
  if (!rows.length) return null;
  const remove = async (pattern: string) => {
    const { error } = await supabase.rpc("unignore_email", { org: orgId, p_pattern: pattern });
    if (error) return toast({ variant: "destructive", title: "Não foi possível", description: error.message });
    toast({ title: "Remetente liberado", description: `${pattern} volta a abrir atendimento.` });
    void load();
  };
  return (
    <div className="rounded-lg border p-3 space-y-2">
      <p className="text-sm font-medium flex items-center gap-2"><MailX className="w-4 h-4" /> Não viram atendimento ({rows.length})</p>
      <p className="text-xs text-muted-foreground">E-mails destes remetentes continuam na caixa, mas não abrem atendimento. Marque pelo botão “Não é atendimento” na conversa.</p>
      <div className="flex flex-wrap gap-1.5">
        {rows.map((r) => (
          <span key={r.pattern} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
            {r.pattern}
            {canManage && <button type="button" title="Liberar" onClick={() => remove(r.pattern)}><X className="w-3 h-3" /></button>}
          </span>
        ))}
      </div>
    </div>
  );
}
