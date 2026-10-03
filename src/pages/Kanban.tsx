import { NumberHealthBanner } from "@/components/NumberHealthBanner";
import { AppHeader } from "@/components/AppHeader";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { useOrg } from "@/contexts/OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ColorPill } from "@/components/ColorTag";
import { toast } from "@/hooks/use-toast";
import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import { Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Stage = { id: string; name: string; position: number; color: string | null };
type Conversation = {
  id: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email?: string | null;
  channel?: string | null;
  stage_id: string | null;
  ai_enabled: boolean;
  last_message_at: string;
  inactivity_followup_at: string | null;
  department_id?: string | null;
  dept?: { name: string; color: string | null } | null;
};

const DEFAULT_STAGES = [
  { name: "Novo lead", color: "#3FB8BE" },
  { name: "Em negociação", color: "#F5A623" },
  { name: "Fechado", color: "#2EB67D" },
];

const ago = (iso: string) => {
  try { return formatDistanceToNowStrict(new Date(iso), { locale: ptBR, addSuffix: true }); } catch { return ""; }
};

/** Card enxuto: quem é, há quanto tempo falou e o setor. Clique abre a conversa; arraste muda a etapa. */
function Card({ c }: { c: Conversation }) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: c.id });
  const who = c.contact_name || c.contact_phone || c.contact_email || "Sem nome";
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => navigate(`/?open=${c.id}`)}
      className={`bg-background border rounded-md px-3 py-2 cursor-grab active:cursor-grabbing hover:border-primary transition ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <div className="font-medium text-sm truncate">{who}</div>
      <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">{ago(c.last_message_at)}{c.ai_enabled ? " · IA atendendo" : ""}</span>
        {c.dept && <ColorPill color={c.dept.color} title="Setor">{c.dept.name}</ColorPill>}
      </div>
      {c.inactivity_followup_at && <div className="mt-1 text-[11px] text-primary">Retorno agendado</div>}
    </div>
  );
}

function Column({
  stage,
  cards,
  editing,
  onRename,
  onDelete,
}: {
  stage: Stage;
  cards: Conversation[];
  editing: boolean;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage-${stage.id}` });
  const [name, setName] = useState(stage.name);
  useEffect(() => setName(stage.name), [stage.name]);
  return (
    <div className="w-64 shrink-0 flex flex-col bg-muted/40 rounded-lg border max-h-full">
      <div className="px-3 py-2 border-b flex items-center gap-2 min-h-[2.75rem]" style={{ borderTop: `3px solid ${stage.color ?? "hsl(var(--primary))"}`, borderTopLeftRadius: 8, borderTopRightRadius: 8 }}>
        {editing ? (
          <>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => { if (name.trim() && name.trim() !== stage.name) onRename(stage.id, name.trim()); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className="h-7 text-sm"
              aria-label="Nome da etapa"
            />
            <button onClick={() => onDelete(stage.id)} className="text-muted-foreground hover:text-destructive p-1 shrink-0" title="Apagar etapa">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        ) : (
          <>
            <span className="font-medium text-sm truncate flex-1">{stage.name}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{cards.length}</span>
          </>
        )}
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 p-2 space-y-2 min-h-[120px] overflow-y-auto transition ${isOver ? "bg-primary/5" : ""}`}
      >
        {cards.map((c) => <Card key={c.id} c={c} />)}
      </div>
    </div>
  );
}

export default function Kanban() {
  const { user } = useAuth();
  const { org, can } = useOrg();
  const [stages, setStages] = useState<Stage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeCard, setActiveCard] = useState<Conversation | null>(null);
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState<"all" | "whatsapp" | "email">("all");
  const [addStageOpen, setAddStageOpen] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [stageToDelete, setStageToDelete] = useState<Stage | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const manage = can("pipeline.manage");

  // Só a empresa selecionada: quem participa de várias não mistura os quadros.
  const loadStages = async () => {
    if (!user || !org) return;
    const { data } = await supabase
      .from("pipeline_stages")
      .select("*")
      .eq("organization_id", org.id)
      .order("position", { ascending: true });
    setStages((data as Stage[]) || []);
  };
  const loadConvs = async () => {
    if (!org) return;
    const [{ data }, { data: depts }] = await Promise.all([
      supabase
        .from("conversations")
        .select("id, contact_name, contact_phone, contact_email, channel, stage_id, ai_enabled, last_message_at, inactivity_followup_at, department_id")
        .eq("organization_id", org.id)
        .order("last_message_at", { ascending: false }),
      supabase.from("departments").select("id, name, color").eq("organization_id", org.id),
    ]);
    const byId = new Map((depts ?? []).map((d) => [d.id, { name: d.name, color: d.color }]));
    setConversations(((data as Conversation[]) || []).map((c) => ({ ...c, dept: c.department_id ? byId.get(c.department_id) ?? null : null })));
  };

  useEffect(() => {
    if (!user || !org) return;
    loadStages();
    loadConvs();
    const filter = `organization_id=eq.${org.id}`;
    const ch = supabase
      .channel(`kanban-live-${org.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter }, loadConvs)
      .on("postgres_changes", { event: "*", schema: "public", table: "pipeline_stages", filter }, loadStages)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user, org?.id]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (channel !== "all" && (c.channel ?? "whatsapp") !== channel) return false;
      if (!q) return true;
      return [c.contact_name, c.contact_phone, c.contact_email].some((v) => v?.toLowerCase().includes(q));
    });
  }, [conversations, search, channel]);
  const hasEmail = conversations.some((c) => c.channel === "email");

  const onDragStart = (e: DragStartEvent) => {
    const c = conversations.find((x) => x.id === e.active.id);
    setActiveCard(c || null);
  };

  const onDragEnd = async (e: DragEndEvent) => {
    setActiveCard(null);
    if (!e.over) return;
    const overId = String(e.over.id);
    if (!overId.startsWith("stage-")) return;
    const newStageId = overId.replace("stage-", "");
    const convId = String(e.active.id);
    const conv = conversations.find((c) => c.id === convId);
    if (!conv || conv.stage_id === newStageId) return;

    // optimistic
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, stage_id: newStageId } : c)),
    );
    const { error } = await supabase
      .from("conversations")
      .update({ stage_id: newStageId })
      .eq("id", convId);
    if (error) {
      toast({ variant: "destructive", title: "Não foi possível mover", description: error.message });
      loadConvs();
    }
  };

  const openAddStage = () => {
    setNewStageName("");
    setAddStageOpen(true);
  };

  const addStage = async () => {
    if (!user || !org) return;
    const name = newStageName.trim();
    if (!name) return;
    const pos = (stages[stages.length - 1]?.position ?? -1) + 1;
    const { data, error } = await supabase
      .from("pipeline_stages")
      .insert({ user_id: user.id, organization_id: org.id, name, position: pos })
      .select()
      .single();
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
      return;
    }
    if (data) {
      setStages((prev) => [...prev, data as Stage]);
    }
    setAddStageOpen(false);
    setNewStageName("");
  };

  const seedDefaults = async () => {
    if (!user || !org) return;
    const { error } = await supabase.from("pipeline_stages").insert(
      DEFAULT_STAGES.map((s, i) => ({ user_id: user.id, organization_id: org.id, name: s.name, color: s.color, position: i })),
    );
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
      return;
    }
    await loadStages();
  };

  const renameStage = async (id: string, name: string) => {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
    const { error } = await supabase.from("pipeline_stages").update({ name }).eq("id", id);
    if (error) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
      loadStages();
    }
  };

  const requestDeleteStage = (id: string) => {
    if (stages.length <= 1) {
      toast({ variant: "destructive", title: "Precisa ter pelo menos 1 etapa" });
      return;
    }
    const s = stages.find((x) => x.id === id);
    if (s) setStageToDelete(s);
  };

  const confirmDeleteStage = async () => {
    if (!stageToDelete) return;
    const id = stageToDelete.id;
    const inThis = conversations.filter((c) => c.stage_id === id).length;
    const first = stages.find((s) => s.id !== id);
    if (first && inThis > 0) {
      await supabase.from("conversations").update({ stage_id: first.id }).eq("stage_id", id);
      setConversations((prev) =>
        prev.map((c) => (c.stage_id === id ? { ...c, stage_id: first.id } : c)),
      );
    }
    await supabase.from("pipeline_stages").delete().eq("id", id);
    setStages((prev) => prev.filter((s) => s.id !== id));
    setStageToDelete(null);
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      <AppHeader active="kanban" />
      <NumberHealthBanner />

      <Dialog open={addStageOpen} onOpenChange={setAddStageOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova etapa</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Nome da etapa"
            value={newStageName}
            onChange={(e) => setNewStageName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addStage();
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddStageOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={addStage} disabled={!newStageName.trim()}>
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {stages.length > 0 && (
        <div className="px-4 pt-3 flex flex-wrap items-center gap-2">
          <Input
            placeholder="Buscar contato"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-56"
            aria-label="Buscar contato"
          />
          {hasEmail && (
            <div className="flex rounded-md border overflow-hidden text-sm" role="group" aria-label="Canal">
              {([["all", "Todos"], ["whatsapp", "WhatsApp"], ["email", "E-mail"]] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setChannel(k)}
                  className={`px-3 h-8 ${channel === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <span className="text-xs text-muted-foreground">{visible.length} contato(s)</span>
          {manage && (
            <div className="ml-auto flex gap-2">
              {editing && (
                <Button size="sm" variant="outline" onClick={openAddStage}>
                  <Plus className="w-4 h-4 mr-1" /> Nova etapa
                </Button>
              )}
              <Button size="sm" variant={editing ? "default" : "outline"} onClick={() => setEditing((v) => !v)}>
                {editing ? "Concluir" : "Editar etapas"}
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden p-4">
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="flex gap-3 h-full">
            {stages.length === 0 && (
              <div className="w-full flex items-center justify-center">
                <div className="text-center max-w-sm border-2 border-dashed rounded-lg p-8">
                  <div className="font-medium mb-1">Seu Kanban está vazio</div>
                  <div className="text-sm text-muted-foreground mb-4">
                    {manage
                      ? "Comece com as etapas Novo lead → Em negociação → Fechado, ou instale o funil de vendas completo em Gestão → Funil de vendas."
                      : "Peça ao responsável pela empresa para criar as etapas do funil."}
                  </div>
                  {manage && (
                    <div className="flex gap-2 justify-center">
                      <Button size="sm" onClick={seedDefaults}>
                        <Plus className="w-4 h-4 mr-1" /> Criar etapas padrão
                      </Button>
                      <Button size="sm" variant="outline" onClick={openAddStage}>
                        Nova etapa
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
            {stages.map((s) => (
              <Column
                key={s.id}
                stage={s}
                cards={visible.filter((c) => c.stage_id === s.id)}
                editing={editing}
                onRename={renameStage}
                onDelete={requestDeleteStage}
              />
            ))}
          </div>
          <DragOverlay>
            {activeCard && <Card c={activeCard} />}
          </DragOverlay>
        </DndContext>
      </div>
      <AlertDialog open={!!stageToDelete} onOpenChange={(o) => !o && setStageToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar etapa?</AlertDialogTitle>
            <AlertDialogDescription>
              {stageToDelete
                ? (() => {
                    const n = conversations.filter((c) => c.stage_id === stageToDelete.id).length;
                    return n > 0
                      ? `Esta etapa tem ${n} contato(s). Eles vão para a primeira etapa.`
                      : "Esta etapa está vazia.";
                  })()
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteStage}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
