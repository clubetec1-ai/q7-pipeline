import { SectionTabs } from "@/components/layout/SectionTabs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { useNavigate } from "react-router-dom";
import { LogOut, Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { Logo } from "@/components/Logo";
import { MainNav } from "@/components/MainNav";
import { NumberHealthBanner } from "@/components/NumberHealthBanner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FieldsEditor } from "./registros/FieldsEditor";
import { RecordForm } from "./registros/RecordForm";
import { type FieldDef, formatValue, type RecordType, slug, type Values } from "./registros/fields";

interface Row { id: string; title: string | null; data: Values; contact_id: string | null; updated_at: string }
interface ContactOpt { id: string; label: string }
type TypeDraft = Omit<RecordType, "id"> & { id?: string };

/** Modelos para o dono começar com um clique (tudo editável depois). */
const PRESETS: Record<string, Omit<TypeDraft, "key">> = {
  "Conta a receber": { name: "Conta a receber", description: "Valores a receber de clientes", access: "managers", link_contact: true, fields: [
    { key: "descricao", label: "Descrição", type: "text", required: true },
    { key: "valor", label: "Valor", type: "money", required: true },
    { key: "vencimento", label: "Vencimento", type: "date", required: true },
    { key: "situacao", label: "Situação", type: "select", options: ["aberta", "paga", "atrasada", "cancelada"], ai_readable: true },
  ] },
  Pedido: { name: "Pedido", description: "Pedidos de clientes", access: "team", link_contact: true, fields: [
    { key: "numero", label: "Número", type: "text", required: true, ai_readable: true },
    { key: "valor", label: "Valor", type: "money" },
    { key: "situacao", label: "Situação", type: "select", options: ["novo", "em separação", "enviado", "entregue", "cancelado"], ai_readable: true },
    { key: "observacoes", label: "Observações", type: "long_text" },
  ] },
  Contrato: { name: "Contrato", description: "Contratos e renovações", access: "managers", link_contact: true, fields: [
    { key: "plano", label: "Plano", type: "text", required: true },
    { key: "inicio", label: "Início", type: "date" },
    { key: "renovacao", label: "Renovação", type: "date" },
    { key: "valor_mensal", label: "Valor mensal", type: "money" },
  ] },
};
const EMPTY: TypeDraft = { key: "", name: "", description: "", access: "team", link_contact: true, fields: [] };

/** Registros personalizados da empresa (e campos do contato). O dono monta sozinho. */
export default function Registros() {
  const { signOut, user } = useAuth();
  const { org, can } = useOrg();
  const navigate = useNavigate();
  const { toast } = useToast();
  const manage = can("org.settings");
  const [types, setTypes] = useState<RecordType[]>([]);
  const [contactType, setContactType] = useState<RecordType | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [contacts, setContacts] = useState<Map<string, string>>(new Map());
  const [q, setQ] = useState("");
  const [typeDraft, setTypeDraft] = useState<TypeDraft | null>(null);
  const [contactFields, setContactFields] = useState<FieldDef[] | null>(null);
  const [editing, setEditing] = useState<{ id?: string; data: Values; contact: ContactOpt | null } | null>(null);
  const [contactQuery, setContactQuery] = useState("");
  const [contactHits, setContactHits] = useState<ContactOpt[]>([]);

  const loadTypes = useCallback(async () => {
    if (!org) return;
    const { data } = await supabase.from("record_types").select("id, key, name, description, access, link_contact, fields")
      .eq("organization_id", org.id).order("name");
    const all = (data as unknown as RecordType[]) ?? [];
    setContactType(all.find((t) => t.key === "contato") ?? null);
    const list = all.filter((t) => t.key !== "contato");
    setTypes(list);
    setCurrent((c) => (c && list.some((t) => t.id === c) ? c : list[0]?.id ?? null));
  }, [org]);
  useEffect(() => { void loadTypes(); }, [loadTypes]);

  const type = types.find((t) => t.id === current) ?? null;
  const loadRows = useCallback(async () => {
    if (!org || !current) return setRows([]);
    const { data } = await supabase.from("records").select("id, title, data, contact_id, updated_at")
      .eq("organization_id", org.id).eq("type_id", current).order("updated_at", { ascending: false }).limit(500);
    const list = (data as unknown as Row[]) ?? [];
    setRows(list);
    const ids = [...new Set(list.map((r) => r.contact_id).filter(Boolean))] as string[];
    if (ids.length) {
      const { data: cs } = await supabase.from("contacts").select("id, name, phone, email").in("id", ids);
      setContacts(new Map((cs ?? []).map((c) => [c.id, c.name || c.phone || c.email || "Contato"])));
    }
  }, [org, current]);
  useEffect(() => { void loadRows(); }, [loadRows]);

  // Busca de contato para ligar ao registro.
  useEffect(() => {
    const term = contactQuery.trim();
    if (!org || term.length < 2) return setContactHits([]);
    const h = window.setTimeout(async () => {
      const like = `%${term.replace(/[%_,()]/g, "")}%`;
      const { data } = await supabase.from("contacts").select("id, name, phone, email").eq("organization_id", org.id)
        .or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like}`).limit(8);
      setContactHits((data ?? []).map((c) => ({ id: c.id, label: c.name || c.phone || c.email || "Contato" })));
    }, 300);
    return () => window.clearTimeout(h);
  }, [contactQuery, org]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter((r) => [r.title, ...Object.values(r.data ?? {})].some((v) => String(v ?? "").toLowerCase().includes(t)));
  }, [rows, q]);

  if (!org) return null;
  const cols = (type?.fields ?? []).slice(0, 4);

  const saveType = async () => {
    if (!typeDraft) return;
    const name = typeDraft.name.trim();
    if (!name) return toast({ variant: "destructive", title: "Dê um nome ao tipo" });
    const row = { name, description: typeDraft.description?.trim() || null, access: typeDraft.access, link_contact: typeDraft.link_contact, fields: typeDraft.fields as never };
    const { error } = typeDraft.id
      ? await supabase.from("record_types").update(row).eq("id", typeDraft.id)
      : await supabase.from("record_types").insert({ ...row, organization_id: org.id, key: slug(name).replace(/^contato$/, "contato_1"), created_by: user?.id });
    if (error) return toast({ variant: "destructive", title: "Tipo não salvo", description: error.code === "23505" ? "Já existe um tipo com esse nome." : error.message });
    setTypeDraft(null);
    toast({ title: "Tipo salvo" });
    void loadTypes();
  };
  const deleteType = async () => {
    if (!typeDraft?.id || !window.confirm(`Apagar o tipo “${typeDraft.name}” e TODOS os registros dele?`)) return;
    const { error } = await supabase.from("record_types").delete().eq("id", typeDraft.id);
    if (error) return toast({ variant: "destructive", title: "Não foi possível apagar" });
    setTypeDraft(null);
    void loadTypes();
  };
  const saveContactFields = async () => {
    if (!contactFields) return;
    const { error } = contactType
      ? await supabase.from("record_types").update({ fields: contactFields as never }).eq("id", contactType.id)
      : await supabase.from("record_types").insert({ organization_id: org.id, key: "contato", name: "Campos do contato", fields: contactFields as never, created_by: user?.id });
    if (error) return toast({ variant: "destructive", title: "Campos não salvos", description: error.message });
    setContactFields(null);
    toast({ title: "Campos do contato salvos", description: "Aparecem na ficha do contato." });
    void loadTypes();
  };

  const saveRecord = async () => {
    if (!editing || !type) return;
    const payload = { data: editing.data as never, contact_id: type.link_contact ? editing.contact?.id ?? null : null };
    const { error } = editing.id
      ? await supabase.from("records").update(payload).eq("id", editing.id)
      : await supabase.from("records").insert({ ...payload, organization_id: org.id, type_id: type.id, created_by: user?.id });
    if (error) return toast({ variant: "destructive", title: "Registro não salvo", description: error.message });
    setEditing(null);
    void loadRows();
  };
  const deleteRecord = async (r: Row) => {
    if (!window.confirm("Apagar este registro?")) return;
    const { error } = await supabase.from("records").delete().eq("id", r.id);
    if (error) return toast({ variant: "destructive", title: "Sem permissão" });
    void loadRows();
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="registros" />
      <SectionTabs group="clientes" active="registros" />
      <NumberHealthBanner />

      <main className="flex-1 w-full max-w-6xl mx-auto p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Registros</h1>
            <p className="text-sm text-muted-foreground">Pedidos, contas, contratos… com os campos que a sua empresa precisa. A IA e os fluxos usam os campos que você liberar.</p>
          </div>
          {manage && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setContactFields(contactType?.fields ?? [])}>Campos do contato</Button>
              <Button onClick={() => setTypeDraft({ ...EMPTY })}><Plus className="w-4 h-4 mr-1" /> Novo tipo</Button>
            </div>
          )}
        </div>

        {types.length === 0 ? (
          manage ? (
            <div className="rounded-lg border p-4 space-y-2">
              <p className="text-sm">Crie o primeiro tipo de registro. Comece de um modelo pronto e ajuste os campos:</p>
              <div className="flex flex-wrap gap-2">
                {Object.keys(PRESETS).map((k) => (
                  <Button key={k} size="sm" variant="outline" onClick={() => setTypeDraft({ ...PRESETS[k], key: "" })}>{k}</Button>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setTypeDraft({ ...EMPTY })}>Em branco</Button>
              </div>
            </div>
          ) : <p className="text-sm text-muted-foreground">Nenhum tipo de registro disponível para você.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {types.map((t) => (
                <Button key={t.id} size="sm" variant={t.id === current ? "default" : "outline"} onClick={() => setCurrent(t.id)}>
                  {t.name}{t.access === "managers" && <span className="ml-1 opacity-70">🔒</span>}
                </Button>
              ))}
              {manage && type && (
                <Button size="sm" variant="ghost" title="Editar tipo" onClick={() => setTypeDraft({ ...type })}><Pencil className="w-4 h-4" /></Button>
              )}
            </div>
            {type && (
              <>
                <div className="flex gap-2">
                  <Input className="max-w-xs" placeholder="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />
                  <Button variant="outline" onClick={() => { setContactQuery(""); setEditing({ data: {}, contact: null }); }}><Plus className="w-4 h-4 mr-1" /> {type.name}</Button>
                </div>
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {cols.map((f) => <TableHead key={f.key}>{f.label}</TableHead>)}
                        {type.link_contact && <TableHead>Contato</TableHead>}
                        <TableHead>Atualizado</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {shown.map((r) => (
                        <TableRow key={r.id} className="cursor-pointer" onClick={() => {
                          setContactQuery("");
                          setEditing({ id: r.id, data: r.data ?? {}, contact: r.contact_id ? { id: r.contact_id, label: contacts.get(r.contact_id) ?? "Contato" } : null });
                        }}>
                          {cols.map((f) => <TableCell key={f.key}>{formatValue(f, r.data?.[f.key])}</TableCell>)}
                          {type.link_contact && <TableCell>{r.contact_id ? contacts.get(r.contact_id) ?? "—" : "—"}</TableCell>}
                          <TableCell className="text-xs text-muted-foreground">{new Date(r.updated_at).toLocaleDateString("pt-BR")}</TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Apagar" onClick={() => deleteRecord(r)}><Trash2 className="w-4 h-4" /></Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {shown.length === 0 && (
                        <TableRow><TableCell colSpan={cols.length + 3} className="text-sm text-muted-foreground">Nenhum registro.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </>
        )}
      </main>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? "Editar" : "Novo"} — {type?.name}</DialogTitle></DialogHeader>
          {editing && type && (
            <div className="space-y-3">
              {type.link_contact && (
                <div className="space-y-1">
                  {editing.contact ? (
                    <div className="flex items-center gap-2 text-sm">
                      <Badge variant="secondary">{editing.contact.label}</Badge>
                      <Button size="sm" variant="ghost" onClick={() => setEditing({ ...editing, contact: null })}>Trocar contato</Button>
                    </div>
                  ) : (
                    <>
                      <Input placeholder="Contato (buscar por nome, telefone ou e-mail)" value={contactQuery} onChange={(e) => setContactQuery(e.target.value)} />
                      {contactHits.map((c) => (
                        <button key={c.id} type="button" className="block w-full text-left text-sm rounded px-2 py-1 hover:bg-muted"
                          onClick={() => setEditing({ ...editing, contact: c })}>{c.label}</button>
                      ))}
                    </>
                  )}
                </div>
              )}
              <RecordForm fields={type.fields} values={editing.data} onChange={(data) => setEditing({ ...editing, data })} />
            </div>
          )}
          <DialogFooter><Button onClick={saveRecord}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!typeDraft} onOpenChange={(o) => !o && setTypeDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{typeDraft?.id ? "Editar tipo de registro" : "Novo tipo de registro"}</DialogTitle>
            <DialogDescription>Defina os campos. “Só gestores” esconde este tipo de quem só atende (bom para financeiro).</DialogDescription>
          </DialogHeader>
          {typeDraft && (
            <div className="space-y-3">
              {!typeDraft.id && (
                <div className="flex flex-wrap gap-2">
                  <span className="text-xs text-muted-foreground self-center">Começar de um modelo:</span>
                  {Object.keys(PRESETS).map((k) => (
                    <Button key={k} size="sm" variant="outline" onClick={() => setTypeDraft({ ...PRESETS[k], key: "" })}>{k}</Button>
                  ))}
                </div>
              )}
              <Input placeholder="Nome (ex.: Conta a receber)" maxLength={80} value={typeDraft.name} onChange={(e) => setTypeDraft({ ...typeDraft, name: e.target.value })} />
              <Input placeholder="Descrição (opcional)" maxLength={500} value={typeDraft.description ?? ""} onChange={(e) => setTypeDraft({ ...typeDraft, description: e.target.value })} />
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-1"><input type="radio" checked={typeDraft.access === "team"} onChange={() => setTypeDraft({ ...typeDraft, access: "team" })} /> Toda a equipe</label>
                <label className="flex items-center gap-1"><input type="radio" checked={typeDraft.access === "managers"} onChange={() => setTypeDraft({ ...typeDraft, access: "managers" })} /> Só gestores</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={typeDraft.link_contact} onChange={(e) => setTypeDraft({ ...typeDraft, link_contact: e.target.checked })} /> Ligado a um contato</label>
              </div>
              <FieldsEditor fields={typeDraft.fields} onChange={(fields) => setTypeDraft({ ...typeDraft, fields })} />
            </div>
          )}
          <DialogFooter className="gap-2">
            {typeDraft?.id && <Button variant="ghost" className="text-destructive mr-auto" onClick={deleteType}>Apagar tipo</Button>}
            <Button onClick={saveType}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!contactFields} onOpenChange={(o) => !o && setContactFields(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Campos do contato</DialogTitle>
            <DialogDescription>Aparecem na ficha de todo contato (ex.: plano, cidade, data de aniversário). O fluxo e a IA podem preencher os que você liberar.</DialogDescription>
          </DialogHeader>
          {contactFields && <FieldsEditor contact fields={contactFields} onChange={setContactFields} />}
          <DialogFooter><Button onClick={saveContactFields}>Salvar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
