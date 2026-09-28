import { Lock, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ColorPill } from "@/components/ColorTag";
import { TagIcon } from "@/components/TagIcon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface Mark { id: string; name: string; color: string | null; icon?: string | null; sensitive?: boolean }

/**
 * Etiquetas e grupos do cliente no topo da conversa: o atendente vê, ao retomar,
 * o que é preciso para aquele cliente. Várias etiquetas por cliente; grupos só
 * por quem gerencia grupos (a RLS confere de novo no banco).
 */
export function ContactMarksBar({
  orgId, contactId, tags, groups, myTags, myGroups, canTag, canGroups, onChanged,
}: {
  orgId: string; contactId: string; tags: Mark[]; groups: Mark[]; myTags: string[]; myGroups: string[];
  canTag: boolean; canGroups: boolean; onChanged: () => void;
}) {
  const { toast } = useToast();
  const toggle = async (kind: "tag" | "group", id: string, on: boolean) => {
    const { error } = kind === "tag"
      ? on ? await supabase.from("contact_tags").insert({ organization_id: orgId, contact_id: contactId, tag_id: id })
           : await supabase.from("contact_tags").delete().eq("contact_id", contactId).eq("tag_id", id)
      : on ? await supabase.from("contact_group_members").insert({ organization_id: orgId, contact_id: contactId, group_id: id })
           : await supabase.from("contact_group_members").delete().eq("contact_id", contactId).eq("group_id", id);
    if (error) toast({ variant: "destructive", title: "Sem permissão para alterar" });
    onChanged();
  };
  const shownTags = tags.filter((t) => myTags.includes(t.id));
  const shownGroups = groups.filter((g) => myGroups.includes(g.id));
  const item = (kind: "tag" | "group", m: Mark, on: boolean, enabled: boolean) => (
    <button key={m.id} type="button" disabled={!enabled} onClick={() => toggle(kind, m.id, !on)}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition disabled:opacity-50 ${on ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}>
      {m.icon ? <TagIcon icon={m.icon} color={on ? undefined : m.color} /> : <span className="w-2 h-2 rounded-full" style={{ background: m.color ?? "#94A3B8" }} />}
      {m.name}{m.sensitive && <Lock className="w-3 h-3" />}
    </button>
  );

  return (
    <div className="px-3 py-1.5 border-b flex flex-wrap items-center gap-1.5 text-xs">
      {shownGroups.map((g) => <ColorPill key={g.id} color={g.color} icon={g.icon} title="Grupo do cliente">{g.name}</ColorPill>)}
      {shownTags.map((t) => <ColorPill key={t.id} color={t.color} icon={t.icon} title="Etiqueta">{t.name}</ColorPill>)}
      {!shownGroups.length && !shownTags.length && <span className="text-muted-foreground">Sem etiquetas nem grupos</span>}
      {(canTag || canGroups) && (
        <Popover>
          <PopoverTrigger className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-muted-foreground hover:bg-muted">
            <Plus className="w-3 h-3" /> Etiquetas e grupos
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs font-medium">Etiquetas (pode marcar várias)</p>
              <div className="flex flex-wrap gap-1.5">
                {tags.length === 0 && <span className="text-xs text-muted-foreground">Nenhuma etiqueta criada (Clientes → Etiquetas e grupos).</span>}
                {tags.map((t) => item("tag", t, myTags.includes(t.id), canTag))}
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium">Grupos do cliente</p>
              <div className="flex flex-wrap gap-1.5">
                {groups.length === 0 && <span className="text-xs text-muted-foreground">Nenhum grupo criado.</span>}
                {groups.map((g) => item("group", g, myGroups.includes(g.id), canGroups))}
              </div>
              {!canGroups && groups.length > 0 && <p className="text-[11px] text-muted-foreground">Só supervisor, admin ou dono muda o grupo.</p>}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
