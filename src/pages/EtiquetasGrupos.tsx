import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Lock, LogOut, Plus, Sparkles, Tags, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { Logo } from "@/components/Logo";
import { MainNav } from "@/components/MainNav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ColorPicker, nextColor } from "@/components/ColorTag";
import { TAG_ICONS, TagIcon } from "@/components/TagIcon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Item { id: string; name: string; color: string | null; icon: string | null; sensitive?: boolean; is_default?: boolean }
type Table = "tags" | "contact_groups";

/** Gestão de etiquetas e grupos de clientes: nome, cor, ícone, juntar duplicados e excluir. */
export default function EtiquetasGrupos() {
  const { signOut } = useAuth();
  const { org, can } = useOrg();
  const { toast } = useToast();
  const navigate = useNavigate();
  const canTags = can("library.manage");
  const canGroups = can("contacts.groups_manage");
  const [tags, setTags] = useState<Item[]>([]);
  const [groups, setGroups] = useState<Item[]>([]);
  const [counts, setCounts] = useState<{ tags: Record<string, number>; groups: Record<string, number> }>({ tags: {}, groups: {} });
  const [open, setOpen] = useState<string | null>(null);
  const [depts, setDepts] = useState<{ id: string; name: string; color: string | null }[]>([]);
  const [tagDepts, setTagDepts] = useState<Map<string, string[]>>(new Map());

  const load = useCallback(async () => {
    if (!org) return;
    const [t, g, c, d, td] = await Promise.all([
      supabase.from("tags").select("id, name, color, icon, is_default").eq("organization_id", org.id).order("name"),
      supabase.from("contact_groups").select("id, name, color, icon, sensitive").eq("organization_id", org.id).order("name"),
      supabase.rpc("tag_group_counts", { org: org.id } as never),
      supabase.from("departments").select("id, name, color").eq("organization_id", org.id).order("name"),
      supabase.from("tag_departments").select("tag_id, department_id").eq("organization_id", org.id),
    ]);
    setDepts(d.data ?? []);
    const m = new Map<string, string[]>();
    for (const r of td.data ?? []) m.set(r.tag_id, [...(m.get(r.tag_id) ?? []), r.department_id]);
    setTagDepts(m);
    setTags((t.data as Item[]) ?? []);
    setGroups((g.data as Item[]) ?? []);
    setCounts((c.data as never) ?? { tags: {}, groups: {} });
  }, [org]);
  useEffect(() => { void load(); }, [load]);

  if (!org) return null;
  if (!canTags && !canGroups) return <Navigate to="/" replace />;

  const fail = (t: string, d?: string) => toast({ variant: "destructive", title: t, description: d });
  const save = async (table: Table, id: string, patch: Record<string, unknown>) => {
    const { error } = await supabase.from(table).update(patch as never).eq("id", id);
    if (error) return fail(error.code === "23505" ? "Já existe outro com esse nome" : "Não salvo", error.message);
    await load();
  };
  const create = async (table: Table, list: Item[], sensitive = false) => {
    const name = window.prompt(table === "tags" ? "Nome da nova etiqueta:" : "Nome do novo grupo de clientes:");
    if (!name?.trim()) return;
    const { error } = await supabase.from(table).insert({
      organization_id: org.id, name: name.trim(), color: nextColor(list.map((x) => x.color)), ...(table === "contact_groups" ? { sensitive } : {}),
    } as never);
    if (error) return fail(error.code === "23505" ? "Já existe com esse nome" : "Não criado", error.message);
    await load();
  };
  const remove = async (table: Table, i: Item, n: number) => {
    if (!window.confirm(`Excluir "${i.name}"? ${n ? `Sai de ${n} cliente(s); ` : ""}os clientes continuam cadastrados.`)) return;
    const { error } = await supabase.from(table).delete().eq("id", i.id);
    if (error) return fail("Não excluído", error.message);
    await load();
  };
  // Setores da etiqueta: nenhum marcado = todos os setores.
  const toggleDept = async (tagId: string, deptId: string, on: boolean) => {
    const { error } = on
      ? await supabase.from("tag_departments").insert({ organization_id: org.id, tag_id: tagId, department_id: deptId })
      : await supabase.from("tag_departments").delete().eq("tag_id", tagId).eq("department_id", deptId);
    if (error) return fail("Não salvo", error.message);
    await load();
  };
  const addDefaults = async () => {
    const { data, error } = await supabase.rpc("add_default_tags", { org: org.id });
    if (error) return fail("Não foi possível", error.message);
    toast({ title: data ? `${data} etiqueta(s) padrão adicionada(s)` : "As etiquetas padrão já estão todas aqui" });
    await load();
  };
  const merge = async (table: Table, source: Item, targetId: string, list: Item[]) => {
    const target = list.find((x) => x.id === targetId);
    if (!target || !window.confirm(`Juntar "${source.name}" em "${target.name}"? Os clientes passam para "${target.name}" e "${source.name}" é apagado.`)) return;
    const { error } = await supabase.rpc(table === "tags" ? "merge_tags" : "merge_groups", { source: source.id, target: targetId } as never);
    if (error) return fail("Não foi possível juntar", error.message);
    toast({ title: "Juntados" });
    await load();
  };

  const section = (table: Table, title: string, list: Item[], cnt: Record<string, number>) => (
    <section className="rounded-lg border p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-semibold">{title}</p>
        <div className="flex gap-1">
          {table === "tags" && <Button size="sm" variant="ghost" onClick={addDefaults} title="Recria as que faltarem (VIP, Urgente, Retornar contato…)"><Sparkles className="w-4 h-4 mr-1" /> Padrão</Button>}
          <Button size="sm" variant="outline" onClick={() => create(table, list)}><Plus className="w-4 h-4 mr-1" /> Novo</Button>
          {table === "contact_groups" && <Button size="sm" variant="ghost" onClick={() => create(table, list, true)} title="Grupo sensível: atendentes não veem (ex.: inadimplentes)"><Lock className="w-4 h-4 mr-1" /> Sensível</Button>}
        </div>
      </div>
      {!list.length && <p className="text-sm text-muted-foreground">Nenhum ainda.</p>}
      {list.map((i) => {
        const n = cnt[i.id] ?? 0;
        return (
          <div key={i.id} className="rounded-md border p-2 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-sm"
                style={{ background: `${i.color ?? "#94A3B8"}26`, color: i.color ?? "#94A3B8" }} onClick={() => setOpen(open === i.id ? null : i.id)} title="Cor e ícone">
                {i.icon ? <TagIcon icon={i.icon} className="w-3.5 h-3.5" /> : <span className="w-2 h-2 rounded-full" style={{ background: i.color ?? "#94A3B8" }} />}
                {i.name}
              </button>
              {i.sensitive && <Lock className="w-3.5 h-3.5 text-muted-foreground" aria-label="Sensível" />}
              {i.is_default && <span className="text-[10px] rounded border px-1 text-muted-foreground" title="Etiqueta padrão do sistema: pode editar à vontade">padrão</span>}
              <Input className="h-8 w-48" defaultValue={i.name} key={i.name}
                onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== i.name && save(table, i.id, { name: e.target.value.trim() })} />
              <span className="text-xs text-muted-foreground">{n} cliente(s)</span>
              <select className="h-8 rounded-md border bg-background px-2 text-xs ml-auto" value="" onChange={(e) => e.target.value && merge(table, i, e.target.value, list)}>
                <option value="">Juntar com…</option>
                {list.filter((x) => x.id !== i.id && !!x.sensitive === !!i.sensitive).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <Button size="icon" variant="ghost" title="Excluir" onClick={() => remove(table, i, n)}><Trash2 className="w-4 h-4" /></Button>
            </div>
            {table === "tags" && depts.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 text-xs">
                <span className="text-muted-foreground mr-1">Setores:</span>
                {depts.map((d) => {
                  const on = (tagDepts.get(i.id) ?? []).includes(d.id);
                  return (
                    <button key={d.id} type="button" onClick={() => toggleDept(i.id, d.id, !on)}
                      className={`rounded-full border px-2 py-0.5 ${on ? "font-medium" : "text-muted-foreground hover:bg-muted"}`}
                      style={on ? { background: `${d.color ?? "#94A3B8"}26`, borderColor: d.color ?? "#94A3B8", color: d.color ?? undefined } : undefined}>
                      {on ? "✓ " : ""}{d.name}
                    </button>
                  );
                })}
                {!(tagDepts.get(i.id) ?? []).length && <span className="text-muted-foreground">(nenhum marcado = todos os setores)</span>}
              </div>
            )}
            {open === i.id && (
              <div className="space-y-2 pl-1">
                <ColorPicker value={i.color} onChange={(c) => save(table, i.id, { color: c })} />
                <div className="flex flex-wrap gap-1">
                  <button type="button" className={`rounded border px-2 text-xs ${!i.icon ? "bg-muted" : ""}`} onClick={() => save(table, i.id, { icon: null })}>sem ícone</button>
                  {Object.keys(TAG_ICONS).map((k) => (
                    <button key={k} type="button" title={k} onClick={() => save(table, i.id, { icon: k })}
                      className={`p-1.5 rounded border ${i.icon === k ? "ring-2 ring-ring" : "hover:bg-muted"}`}>
                      <TagIcon icon={k} className="w-4 h-4" color={i.color} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b px-4 h-14 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Logo horizontal width={26} height={26} />
          <MainNav active="etiquetas" />
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" size="icon" title="Sair" onClick={async () => { await signOut(); navigate("/login"); }}><LogOut className="w-4 h-4" /></Button>
        </div>
      </header>
      <main className="flex-1 w-full max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Tags className="w-6 h-6" /> Etiquetas e grupos</h1>
          <p className="text-sm text-muted-foreground">Clique no nome colorido para trocar cor e ícone. Em cada etiqueta, marque os setores que podem usá-la:
            o atendente só vê as gerais e as do seu setor. As etiquetas <b>padrão</b> são um ponto de partida — edite, troque os setores ou crie outras.
            Excluir só tira a marcação: o cliente continua cadastrado.</p>
        </div>
        {canTags && section("tags", "Etiquetas", tags, counts.tags ?? {})}
        {canGroups && section("contact_groups", "Grupos de clientes", groups, counts.groups ?? {})}
      </main>
    </div>
  );
}
