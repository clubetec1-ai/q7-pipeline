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
interface ChargeRow { id: string; value: number; due_date: string; status: string; invoice_url: string | null; description: string | null }
const CHARGE_STATUS: Record<string, string> = { pending: "em aberto", paid: "paga", overdue: "vencida", canceled: "cancelada", refunded: "estornada" };

/** Registros ligados ao contato (pedidos, contas…), só dos tipos que a pessoa pode ver (RLS). */
export function ContactRecords({ orgId, contactId }: { orgId: string; contactId: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [types, setTypes] = useState<RecordType[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [editing, setEditing] = useState<{ id?: string; type: RecordType; data: Values } | null>(null);

  const load = useCallback(async () => {
    const [t, r, ch] = await Promise.all([
      supabase.from("record_types").select("id, key, name, description, access, link_contact, fields")
        .eq("organization_id", orgId).eq("link_contact", true).neq("key", "contato").order("name"),
      supabase.from("records").select("id, type_id, data, updated_at").eq("organization_id", orgId)
        .eq("contact_id", contactId).order("updated_at", { ascending: false }).limit(100),
      supabase.from("charges").select("id, value, due_date, status, invoice_url, description").eq("organization_id", orgId)
        .eq("contact_id", contactId).order("created_at", { ascending: false }).limit(20),
    ]);
    setCharges((ch.data as ChargeRow[]) ?? []);
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

  const chargeList = charges.length > 0 && (
    <div className="space-y-1">
      <p className="text-xs font-medium">Cobranças</p>
      {charges.map((c) => (
        <div key={c.id} className="flex items-center justify-between rounded-md border p-2 text-xs">
          <span>{Number(c.value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} · vence {c.due_date.split("-").reverse().join("/")}{c.description ? ` · ${c.description}` : ""}</span>
          <span className={c.status === "paid" ? "text-green-600" : c.status === "overdue" ? "text-destructive" : "text-muted-foreground"}>{CHARGE_STATUS[c.status] ?? c.status}</span>
        </div>
      ))}
    </div>
  );
  if (!types.length) return <div className="space-y-3">{chargeList}<p className="text-xs text-muted-foreground">Nenhum tipo de registro disponível. Crie em Registros.</p></div>;
  return (
    <div className="space-y-3">
      {chargeList}
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
