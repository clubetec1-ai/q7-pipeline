import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  addEdge, Background, Controls, ReactFlow, useEdgesState, useNodesState,
  type Connection, type Edge, type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BLOCK, BLOCKS, NEW_GRAPH, type BlockData } from "./fluxos/blocks";
import { FlowNodeView } from "./fluxos/FlowNodeView";
import { NodeProperties, type Lookups } from "./fluxos/NodeProperties";
import { OverlayContext } from "./fluxos/overlay";
import { Simulator } from "./fluxos/Simulator";
import type { FlowGraph } from "../../supabase/functions/_shared/flow/engine";

const nodeTypes = Object.fromEntries(BLOCKS.map((b) => [b.type, FlowNodeView]));

interface Graph { nodes: Node[]; edges: Edge[] }

/** Só o que o motor precisa (sem estado interno do canvas). */
function toGraph(nodes: Node[], edges: Edge[]) {
  return {
    nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle ?? null, target: e.target })),
  };
}

/** Editor visual de um fluxo (spec fluxo §5): rascunho → publicar. */
export default function FlowEditor() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { org, can } = useOrg();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [version, setVersion] = useState<number | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lookups, setLookups] = useState<Lookups>({ departments: [], tags: [], groups: [], closeReasons: [], stages: [], secrets: [], files: [] });
  const [simOpen, setSimOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [period, setPeriod] = useState(0);
  const [stats, setStats] = useState<Record<string, Record<string, number>> | null>(null);
  const canEdit = can("org.settings");

  // Estatísticas por bloco/saída (só contagens; RPC checa a permissão).
  useEffect(() => {
    if (!id || !period) return setStats(null);
    supabase.rpc("flow_stats", { flow: id, period }).then(({ data, error }) => {
      if (error) return toast({ variant: "destructive", title: "Estatísticas indisponíveis" });
      const map: Record<string, Record<string, number>> = {};
      for (const r of data ?? []) (map[r.node_id] ??= {})[r.outcome ?? ""] = Number(r.n);
      setStats(map);
    });
  }, [id, period, toast]);
  const overlay = useMemo(() => ({ stats, active }), [stats, active]);
  const simGraph = useMemo(() => (simOpen ? toGraph(nodes, edges) as unknown as FlowGraph : null), [simOpen, nodes, edges]);

  const load = useCallback(async () => {
    if (!id || !org) return;
    const [{ data: flow }, { data: versions }, d, t, g, cr, st, sc, lf] = await Promise.all([
      supabase.from("flows").select("name").eq("id", id).eq("organization_id", org.id).maybeSingle(),
      supabase.from("flow_versions").select("id, status, version, graph").eq("flow_id", id).in("status", ["draft", "published"]),
      supabase.from("departments").select("id, name").eq("organization_id", org.id).order("name"),
      supabase.from("tags").select("id, name").eq("organization_id", org.id).order("name"),
      supabase.from("contact_groups").select("id, name").eq("organization_id", org.id).order("name"),
      supabase.from("close_reasons").select("id, name").eq("organization_id", org.id).eq("active", true).order("name"),
      supabase.from("pipeline_stages").select("id, name").eq("organization_id", org.id).order("position"),
      supabase.rpc("list_http_secrets", { org: org.id }),
      supabase.from("library_files").select("id, name").eq("organization_id", org.id).order("name"),
    ]);
    if (!flow) return;
    setName(flow.name);
    setLookups({
      departments: d.data ?? [], tags: t.data ?? [], groups: g.data ?? [],
      closeReasons: cr.data ?? [], stages: st.data ?? [], secrets: (sc.data ?? []).map((x) => x.name), files: lf.data ?? [],
    });
    const draft = versions?.find((v) => v.status === "draft");
    const pub = versions?.find((v) => v.status === "published");
    setVersion(pub?.version ?? null);
    const graph = ((draft ?? pub)?.graph ?? NEW_GRAPH) as unknown as Graph;
    setNodes(graph.nodes ?? []);
    setEdges(graph.edges ?? []);
    setDirty(false);
  }, [id, org, setNodes, setEdges]);

  useEffect(() => { void load(); }, [load]);

  const onConnect = useCallback((c: Connection) => {
    // Cada saída leva a um só bloco: nova ligação substitui a anterior.
    setEdges((es) => addEdge({ ...c, id: crypto.randomUUID() },
      es.filter((e) => !(e.source === c.source && (e.sourceHandle ?? null) === (c.sourceHandle ?? null)))));
    setDirty(true);
  }, [setEdges]);

  const addBlock = (type: string) => {
    const nid = crypto.randomUUID().slice(0, 12);
    setNodes((ns) => [...ns, { id: nid, type, position: { x: 360 + (ns.length % 4) * 40, y: 80 + (ns.length % 6) * 60 }, data: BLOCK[type].defaults() }]);
    setSelected(nid);
    setDirty(true);
  };

  const current = useMemo(() => nodes.find((n) => n.id === selected) ?? null, [nodes, selected]);

  const updateData = (d: BlockData) => {
    setNodes((ns) => ns.map((n) => (n.id === selected ? { ...n, data: d } : n)));
    // Opção de menu removida leva junto a ligação dela.
    if (current?.type === "menu") {
      const ids = new Set(((d.options as { id: string }[]) ?? []).map((o) => `opt:${o.id}`));
      setEdges((es) => es.filter((e) => e.source !== selected || !e.sourceHandle?.startsWith("opt:") || ids.has(e.sourceHandle)));
    }
    setDirty(true);
  };

  const removeSelected = () => {
    setNodes((ns) => ns.filter((n) => n.id !== selected));
    setEdges((es) => es.filter((e) => e.source !== selected && e.target !== selected));
    setSelected(null);
    setDirty(true);
  };

  const saveDraft = async () => {
    if (!id || !org) return false;
    const graph = toGraph(nodes, edges) as unknown as Json;
    const { data: draft } = await supabase.from("flow_versions").select("id").eq("flow_id", id).eq("status", "draft").maybeSingle();
    const { error } = draft
      ? await supabase.from("flow_versions").update({ graph, updated_by: user?.id }).eq("id", draft.id)
      : await supabase.from("flow_versions").insert({ organization_id: org.id, flow_id: id, status: "draft", graph, updated_by: user?.id });
    if (error) { toast({ variant: "destructive", title: "Não foi possível salvar" }); return false; }
    setDirty(false);
    return true;
  };

  const publish = async () => {
    if (!id) return;
    setBusy(true);
    try {
      if (!(await saveDraft())) return;
      const { data, error } = await supabase.rpc("publish_flow", { flow: id });
      if (error) return toast({ variant: "destructive", title: "Não publicado", description: error.message });
      setVersion(data as number);
      toast({ title: `Versão ${data} publicada`, description: "Novos atendimentos já seguem este fluxo." });
    } finally { setBusy(false); }
  };

  if (!org) return null;
  if (!canEdit) return <Navigate to="/" replace />;

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="border-b px-4 h-14 flex items-center justify-between shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon" asChild title="Voltar"><Link to="/fluxos"><ArrowLeft className="w-4 h-4" /></Link></Button>
          <p className="font-semibold truncate">{name}</p>
          {version ? <Badge variant="secondary">Publicado v{version}</Badge> : <Badge variant="outline">Não publicado</Badge>}
          {dirty && <span className="text-xs text-muted-foreground">alterações não salvas</span>}
        </div>
        <div className="flex gap-2">
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={period} title="Estatísticas"
            onChange={(e) => setPeriod(Number(e.target.value))}>
            <option value={0}>Sem estatísticas</option>
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
          </select>
          <Button variant={simOpen ? "secondary" : "outline"} onClick={() => setSimOpen((v) => !v)}>Simular</Button>
          <Button variant="outline" disabled={busy || !dirty} onClick={async () => {
            setBusy(true);
            if (await saveDraft()) toast({ title: "Rascunho salvo" });
            setBusy(false);
          }}>Salvar rascunho</Button>
          <Button disabled={busy} onClick={publish}>Publicar</Button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <aside className="w-40 border-r p-2 space-y-1 overflow-y-auto shrink-0">
          <p className="text-xs text-muted-foreground px-1 pb-1">Adicionar bloco</p>
          {BLOCKS.filter((b) => b.type !== "start").map((b) => (
            <button key={b.type} onClick={() => addBlock(b.type)}
              className="w-full text-left text-sm rounded-md px-2 py-1.5 hover:bg-muted flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: b.color }} />{b.label}
            </button>
          ))}
        </aside>

        <div className="flex-1 min-w-0">
          <OverlayContext.Provider value={overlay}>
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={nodeTypes}
            onNodesChange={(c) => {
              // O bloco Início não pode ser apagado.
              const safe = c.filter((x) => !(x.type === "remove" && nodes.find((n) => n.id === x.id)?.type === "start"));
              onNodesChange(safe);
              if (safe.some((x) => x.type !== "select" && x.type !== "dimensions")) setDirty(true);
            }}
            onEdgesChange={(c) => { onEdgesChange(c); if (c.some((x) => x.type === "remove")) setDirty(true); }}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelected(n.id)}
            onPaneClick={() => setSelected(null)}
            deleteKeyCode={["Backspace", "Delete"]}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
          </OverlayContext.Provider>
        </div>

        <aside className="w-80 border-l p-4 overflow-y-auto shrink-0">
          {simGraph ? (
            <Simulator graph={simGraph} lookups={lookups} onActive={setActive} />
          ) : current ? (
            <NodeProperties type={current.type ?? ""} data={current.data as BlockData}
              onChange={updateData} onDelete={removeSelected} lookups={lookups} />
          ) : (
            <div className="text-sm text-muted-foreground space-y-2">
              <p>Clique num bloco para editar.</p>
              <p>Arraste da bolinha de uma saída até outro bloco para ligar. Selecione um bloco ou ligação e aperte Delete para apagar.</p>
              <p>Saída sem ligação manda o cliente para a fila de atendimento.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
