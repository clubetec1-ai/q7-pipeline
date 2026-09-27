import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RecordForm } from "../registros/RecordForm";
import { formatValue, type RecordType, type Values } from "../registros/fields";

interface Row { id: string; type_id: string; data: Values; updated_at: string }

/** Registros ligados ao contato (pedidos, contas…), só dos tipos que a pessoa pode ver (RLS). */
export function ContactRecords({ orgId, contactId }: { orgId: string; contactId: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [types, setTypes] = useState<RecordType[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [editing, setEditing] = useState<{ id?: string; type: RecordType; data: Values } | null>(null);

  const load = useCallback(async () => {
    const [t, r] = await Promise.all([
      supabase.from("record_types").select("id, key, name, description, access, link_contact, fields")
        .eq("organization_id", orgId).eq("link_contact", true).neq("key", "contato").order("name"),
      supabase.from("records").select("id, type_id, data, updated_at").eq("organization_id", orgId)
        .eq("contact_id", contactId).order("updated_at", { ascending: false }).limit(100),
    ]);
    setTypes((t.data as unknown as RecordType[]) ?? []);
    setRows((r.data as unknown as Row[]) ?? []);
  }, [orgId, contactId]);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!editing) return;
    const { error } = editing.id
      ? await supabase.from("records").update({ data: editing.data as never }).eq("id", editing.id)
      : await supabase.from("records").insert({
          organization_id: orgId, type_id: editing.type.id, contact_id: contactId, data: editing.data as never, created_by: user?.id,
        });
    if (error) return toast({ variant: "destructive", title: "Registro não salvo", description: error.message });
    setEditing(null);
    void load();
  };

  if (!types.length) return <p className="text-xs text-muted-foreground">Nenhum tipo de registro disponível. Crie em Registros.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {types.map((t) => (
          <Button key={t.id} size="sm" variant="outline" onClick={() => setEditing({ type: t, data: {} })}>
            <Plus className="w-3 h-3 mr-1" />{t.name}
          </Button>
        ))}
      </div>
      {rows.length === 0 && <p className="text-xs text-muted-foreground">Nenhum registro deste contato.</p>}
      {rows.map((r) => {
        const t = types.find((x) => x.id === r.type_id);
        if (!t) return null;
        return (
          <button key={r.id} type="button" className="w-full text-left rounded-md border p-2 text-sm hover:bg-muted"
            onClick={() => setEditing({ id: r.id, type: t, data: r.data ?? {} })}>
            <div className="text-xs text-muted-foreground">{t.name} · {new Date(r.updated_at).toLocaleDateString("pt-BR")}</div>
            {t.fields.slice(0, 3).map((f) => (
              <div key={f.key} className="truncate"><span className="text-muted-foreground">{f.label}:</span> {formatValue(f, r.data?.[f.key])}</div>
            ))}
          </button>
        );
      })}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar" : "Novo"} — {editing?.type.name}</DialogTitle></DialogHeader>
          {editing && <RecordForm fields={editing.type.fields} values={editing.data} onChange={(data) => setEditing({ ...editing, data })} />}
          <DialogFooter><Button onClick={save}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
