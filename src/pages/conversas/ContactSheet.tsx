import { firstName, memberNames } from "@/lib/memberNames";
import { useCallback, useEffect, useState } from "react";
import { Lock, Phone, Plus } from "lucide-react";
import { requestCall } from "@/lib/requestCall";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProtocolHistory } from "./ProtocolHistory";
import { ContactRecords } from "./ContactRecords";
import { RecordForm } from "../registros/RecordForm";
import type { FieldDef, Values } from "../registros/fields";
import { ColorDot, cycleColor, nextColor } from "@/components/ColorTag";
import { TagIcon } from "@/components/TagIcon";
import { callFunction } from "@/lib/callFunction";

interface Contact {
  id: string; phone: string; name: string | null; email: string | null; document: string | null; notes: string | null;
  opted_out_at: string | null;
  custom: Values | null;
}
interface Tag { id: string; name: string; color: string | null; icon?: string | null }
interface Group { id: string; name: string; sensitive: boolean; color: string | null; icon?: string | null }
interface Note { id: string; content: string; author_id: string; created_at: string; mentions: string[] }
interface Person { id: string; name: string }

/**
 * Ficha do contato: dados, etiquetas, grupos de clientes e notas internas.
 * Tudo passa pela RLS: grupo sensível nem chega para quem não pode ver, e as
 * notas ficam fora da tabela de mensagens (nunca vão para o cliente).
 */
export function ContactSheet({
  open, onClose, contactId, conversationId, ticketId,
}: { open: boolean; onClose: () => void; contactId: string | null; conversationId: string; ticketId?: string }) {
  const { org, can } = useOrg();
  const { toast } = useToast();
  const [c, setC] = useState<Contact | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [myTags, setMyTags] = useState<string[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [myGroups, setMyGroups] = useState<string[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [newTag, setNewTag] = useState("");
  const [newGroup, setNewGroup] = useState("");
  const [newGroupSensitive, setNewGroupSensitive] = useState(false);
  const [note, setNote] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [anon, setAnon] = useState<{ open: boolean; reason: string; confirm: string; busy: boolean }>({ open: false, reason: "", confirm: "", busy: false });

  const load = useCallback(async () => {
    if (!org || !contactId) return;
    const [ct, t, tg, g, gm, n, m] = await Promise.all([
      supabase.from("contacts").select("id, phone, name, email, document, notes, opted_out_at, custom").eq("id", contactId).maybeSingle(),
      supabase.from("tags").select("id, name, color, icon").eq("organization_id", org.id).order("name"),
      supabase.from("contact_tags").select("tag_id").eq("contact_id", contactId),
      supabase.from("contact_groups").select("id, name, sensitive, color, icon").eq("organization_id", org.id).order("name"),
      supabase.from("contact_group_members").select("group_id").eq("contact_id", contactId),
      supabase.from("internal_notes").select("id, content, author_id, created_at, mentions")
        .eq("conversation_id", conversationId).order("created_at"),
      supabase.from("organization_members").select("user_id").eq("organization_id", org.id).eq("status", "active"),
    ]);
    setC(ct.data as Contact | null);
    setTags((t.data as Tag[]) ?? []);
    setMyTags((tg.data ?? []).map((r) => r.tag_id));
    setGroups((g.data as Group[]) ?? []);
    setMyGroups((gm.data ?? []).map((r) => r.group_id));
    setNotes((n.data as Note[]) ?? []);
    const names = await memberNames(org.id, (m.data ?? []).map((r) => r.user_id));
    setPeople([...names].map(([id, n]) => ({ id, name: n.name })));
  }, [org, contactId, conversationId]);

  useEffect(() => { if (open) load(); }, [open, load]);
  // Campos personalizados do contato (tipo 'contato' em Registros).
  const [customFields, setCustomFields] = useState<FieldDef[]>([]);
  useEffect(() => {
    if (!org || !open) return;
    supabase.from("record_types").select("fields").eq("organization_id", org.id).eq("key", "contato").maybeSingle()
      .then(({ data }) => setCustomFields((data?.fields as unknown as FieldDef[]) ?? []));
  }, [org, open]);

  if (!org) return null;
  const fail = (title: string) => { toast({ variant: "destructive", title }); };
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "Alguém";

  // LGPD: anonimizar a pedido do titular (dono/admin). Confirmação digitada + motivo.
  const anonymize = async () => {
    if (!contactId) return;
    setAnon((a) => ({ ...a, busy: true }));
    const r = await callFunction<{ conversations: number; files: number }>("anonymize-contact", { contact_id: contactId, reason: anon.reason });
    setAnon({ open: false, reason: "", confirm: "", busy: false });
    if (!r.ok) return fail(r.message);
    toast({ title: "Contato anonimizado", description: `${r.data.conversations} conversa(s) e ${r.data.files} arquivo(s) sem dados pessoais. Registrado na auditoria.` });
    load();
  };

  const saveContact = async () => {
    if (!c) return;
    const { error } = await supabase.from("contacts")
      .update({ name: c.name, email: c.email, document: c.document, notes: c.notes, custom: (c.custom ?? {}) as never }).eq("id", c.id);
    if (error) return toast({ variant: "destructive", title: "Não foi possível salvar", description: error.message });
    else toast({ title: "Contato salvo" });
  };

  const toggleTag = async (tagId: string, on: boolean) => {
    if (!contactId) return;
    const { error } = on
      ? await supabase.from("contact_tags").insert({ contact_id: contactId, tag_id: tagId, organization_id: org.id })
      : await supabase.from("contact_tags").delete().eq("contact_id", contactId).eq("tag_id", tagId);
    if (error) return fail("Não foi possível alterar a etiqueta");
    load();
  };
  const createTag = async () => {
    if (!newTag.trim()) return;
    const { error } = await supabase.from("tags").insert({ organization_id: org.id, name: newTag.trim(), color: nextColor(tags.map((t) => t.color)) });
    if (error) return fail(error.code === "23505" ? "Etiqueta já existe" : "Sem permissão para criar etiqueta");
    setNewTag("");
    load();
  };

  // Clique na bolinha troca a cor (quem gerencia etiquetas / grupos).
  const recolor = async (table: "tags" | "contact_groups", id: string, current: string | null) => {
    const { error } = await supabase.from(table).update({ color: cycleColor(current) }).eq("id", id);
    if (error) return fail("Sem permissão para trocar a cor");
    load();
  };

  const toggleGroup = async (groupId: string, on: boolean) => {
    if (!contactId) return;
    const { error } = on
      ? await supabase.from("contact_group_members").insert({ group_id: groupId, contact_id: contactId, organization_id: org.id })
      : await supabase.from("contact_group_members").delete().eq("group_id", groupId).eq("contact_id", contactId);
    if (error) return fail("Sem permissão para alterar grupos");
    load();
  };
  const createGroup = async () => {
    if (!newGroup.trim()) return;
    const { error } = await supabase.from("contact_groups")
      .insert({ organization_id: org.id, name: newGroup.trim(), sensitive: newGroupSensitive, color: nextColor(groups.map((g) => g.color)) });
    if (error) return fail(error.code === "23505" ? "Grupo já existe" : "Sem permissão para criar grupo");
    setNewGroup("");
    setNewGroupSensitive(false);
    load();
  };

  const addNote = async () => {
    if (!note.trim()) return;
    if (!conversationId) return fail("Este cliente ainda não tem conversa: as notas ficam guardadas na conversa.");
    const { error } = await supabase.from("internal_notes").insert({
      conversation_id: conversationId, ticket_id: ticketId ?? null, content: note.trim(), mentions,
      organization_id: org.id,
    });
    if (error) return fail("Não foi possível salvar a nota");
    setNote("");
    setMentions([]);
    load();
  };

  const canGroups = can("contacts.groups_manage");
  const canLibrary = can("library.manage");

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader><SheetTitle>{c?.name || c?.phone || "Contato"}</SheetTitle></SheetHeader>
        {c?.opted_out_at && (
          <div className="mt-3 rounded-md border border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-2 text-xs flex items-center justify-between gap-2">
            <span>Não quer receber mensagens automáticas (desde {new Date(c.opted_out_at).toLocaleDateString("pt-BR")}).</span>
            {can("conversations.attend") && (
              <Button size="sm" variant="outline" onClick={async () => {
                const { error } = await supabase.rpc("clear_opt_out", { contact: c.id });
                if (error) return toast({ variant: "destructive", title: "Sem permissão" });
                toast({ title: "Mensagens automáticas liberadas", description: "Fica registrado quem desfez." });
                load();
              }}>Desfazer a pedido do cliente</Button>
            )}
          </div>
        )}
        {!contactId ? <p className="text-sm text-muted-foreground mt-4">Contato ainda não identificado.</p> : (
          <Tabs defaultValue="dados" className="mt-4">
            <TabsList className="w-full">
              <TabsTrigger value="dados" className="flex-1">Dados</TabsTrigger>
              <TabsTrigger value="marcas" className="flex-1">Etiquetas e grupos</TabsTrigger>
              <TabsTrigger value="notas" className="flex-1">Notas ({notes.length})</TabsTrigger>
              <TabsTrigger value="protocolos" className="flex-1">Protocolos</TabsTrigger>
              <TabsTrigger value="registros" className="flex-1">Registros</TabsTrigger>
            </TabsList>

            <TabsContent value="dados" className="space-y-3 pt-3">
              {c && (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">Telefone: {c.phone}</p>
                    {can("conversations.attend") && !c.name?.startsWith("Anonimizado") && (
                      <Button size="sm" variant="outline" onClick={() => requestCall(c.phone)} title="Ligar pelo seu ramal"><Phone className="w-4 h-4 mr-1" /> Ligar</Button>
                    )}
                  </div>
                  {(["name", "email", "document"] as const).map((k) => (
                    <div key={k} className="space-y-1.5">
                      <Label>{{ name: "Nome", email: "E-mail", document: "CPF/CNPJ" }[k]}</Label>
                      <Input value={c[k] ?? ""} onChange={(e) => setC({ ...c, [k]: e.target.value })} />
                    </div>
                  ))}
                  {customFields.length > 0 && (
                    <RecordForm fields={customFields} values={c.custom ?? {}} onChange={(custom) => setC({ ...c, custom })} />
                  )}
                  <div className="space-y-1.5"><Label>Observações</Label>
                    <Textarea rows={3} value={c.notes ?? ""} onChange={(e) => setC({ ...c, notes: e.target.value })} /></div>
                  <Button size="sm" onClick={saveContact}>Salvar</Button>
                  {can("org.settings") && !c.name?.startsWith("Anonimizado") && (
                    <div className="mt-6 rounded-md border border-destructive/40 p-3 space-y-2">
                      {!anon.open ? (
                        <button type="button" className="text-xs text-destructive underline" onClick={() => setAnon({ ...anon, open: true })}>
                          Excluir dados pessoais deste cliente (LGPD)
                        </button>
                      ) : (
                        <>
                          <p className="text-xs">
                            Use só a pedido do próprio cliente. Nome, telefone, e-mail, documento, anotações, texto e arquivos das
                            conversas são apagados para sempre; protocolos e números dos relatórios continuam. Não dá para desfazer.
                          </p>
                          <Input className="h-8" placeholder="Motivo (ex.: pedido do titular por WhatsApp em 29/09)" value={anon.reason}
                            onChange={(e) => setAnon({ ...anon, reason: e.target.value })} />
                          <Input className="h-8" placeholder="Digite ANONIMIZAR para confirmar" value={anon.confirm}
                            onChange={(e) => setAnon({ ...anon, confirm: e.target.value })} />
                          <div className="flex gap-2">
                            <Button size="sm" variant="destructive" disabled={anon.busy || anon.confirm !== "ANONIMIZAR" || anon.reason.trim().length < 5} onClick={anonymize}>
                              {anon.busy ? "Anonimizando..." : "Anonimizar agora"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setAnon({ open: false, reason: "", confirm: "", busy: false })}>Cancelar</Button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="marcas" className="space-y-5 pt-3">
              <div className="space-y-2">
                <Label>Etiquetas</Label>
                <div className="flex flex-wrap gap-2">
                  {tags.length === 0 && <span className="text-xs text-muted-foreground">Nenhuma etiqueta criada.</span>}
                  {tags.map((t) => {
                    const on = myTags.includes(t.id);
                    return (
                      <button key={t.id} type="button" onClick={() => toggleTag(t.id, !on)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition ${on ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}>
                        {t.icon ? <TagIcon icon={t.icon} color={on ? undefined : t.color} /> : <span className="w-2 h-2 rounded-full" style={{ background: t.color ?? "#94A3B8" }} />}{t.name}
                      </button>
                    );
                  })}
                </div>
                {canLibrary && (
                  <div className="flex gap-2">
                    <Input className="h-8" placeholder="Nova etiqueta" value={newTag} onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && createTag()} />
                    <Button size="sm" variant="outline" onClick={createTag}><Plus className="w-4 h-4" /></Button>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>Grupos de clientes</Label>
                {groups.length === 0 && <p className="text-xs text-muted-foreground">Nenhum grupo criado.</p>}
                {groups.map((g) => (
                  <label key={g.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={myGroups.includes(g.id)} disabled={!canGroups}
                      onCheckedChange={(v) => toggleGroup(g.id, !!v)} />
                    <ColorDot color={g.color} onClick={canGroups ? () => recolor("contact_groups", g.id, g.color) : undefined} />
                    <TagIcon icon={g.icon} color={g.color} />
                    {g.name}
                    {g.sensitive && <Lock className="w-3.5 h-3.5 text-muted-foreground" aria-label="Grupo sensível" />}
                  </label>
                ))}
                {canGroups && (
                  <div className="space-y-2 rounded-md border p-2">
                    <div className="flex gap-2">
                      <Input className="h-8" placeholder="Novo grupo (ex.: Alto valor)" value={newGroup}
                        onChange={(e) => setNewGroup(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createGroup()} />
                      <Button size="sm" variant="outline" onClick={createGroup}><Plus className="w-4 h-4" /></Button>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox checked={newGroupSensitive} onCheckedChange={(v) => setNewGroupSensitive(!!v)} />
                      Sensível (ex.: inadimplentes): atendentes não veem
                    </label>
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="notas" className="space-y-3 pt-3">
              <p className="text-xs text-muted-foreground">Só a equipe vê. Notas nunca são enviadas ao cliente.</p>
              {notes.map((n) => (
                <div key={n.id} className="rounded-md border bg-amber-500/5 p-2 text-sm">
                  <div className="text-[11px] text-muted-foreground mb-1">
                    {nameOf(n.author_id)} · {new Date(n.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                    {n.mentions.length > 0 && ` · para ${n.mentions.map(nameOf).join(", ")}`}
                  </div>
                  <div className="whitespace-pre-wrap">{n.content}</div>
                </div>
              ))}
              <Textarea rows={3} placeholder="Escreva uma nota para a equipe..." value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex flex-wrap gap-1.5">
                <span className="text-xs text-muted-foreground self-center">Avisar:</span>
                {people.map((p) => {
                  const on = mentions.includes(p.id);
                  return (
                    <button key={p.id} type="button"
                      onClick={() => setMentions((cur) => (on ? cur.filter((x) => x !== p.id) : [...cur, p.id]))}
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}>
                      @{p.name.split(" ")[0]}
                    </button>
                  );
                })}
              </div>
              <Button size="sm" onClick={addNote} disabled={!note.trim()}>Salvar nota</Button>
            </TabsContent>

            <TabsContent value="registros" className="pt-3">
              {org && contactId && <ContactRecords orgId={org.id} contactId={contactId} />}
            </TabsContent>
            <TabsContent value="protocolos" className="pt-3">
              {org && contactId && <ProtocolHistory orgId={org.id} contactId={contactId} nameOf={nameOf} />}
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}
