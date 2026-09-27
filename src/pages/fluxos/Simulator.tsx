import { useEffect, useRef, useState } from "react";
import { RotateCcw, Send, TimerReset } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
// O MESMO motor que roda no webhook (função pura): o simulador não envia nada
// ao WhatsApp nem grava no banco; a IA aparece como marcador.
import { advance, type FlowAction, type FlowCtx, type FlowGraph, type FlowResult } from "../../../supabase/functions/_shared/flow/engine";
import { fmtMinutes } from "./blocks";
import type { Lookups } from "./NodeProperties";

interface Line { from: "bot" | "user" | "sys"; text: string }
interface SimState { node: string | null; vars: Record<string, string>; attempts: number; aiTurns: number; wait?: number; ended: boolean }

const ALL_DAY = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), [{ start: "00:00", end: "23:59" }]]));

/** Chat de teste do fluxo em edição (spec fluxo §10). */
export function Simulator({ graph, lookups, onActive }: {
  graph: FlowGraph; lookups: Lookups; onActive: (nodeId: string | null) => void;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [sim, setSim] = useState<SimState | null>(null);
  const [text, setText] = useState("");
  const [first, setFirst] = useState(true);
  const [open, setOpen] = useState(true);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [lines]);
  useEffect(() => () => onActive(null), [onActive]);

  const name = (list: { id: string; name: string }[], id: string | null) => list.find((x) => x.id === id)?.name;
  const describe = (a: FlowAction): Line => {
    switch (a.type) {
      case "send": return { from: "bot", text: a.text };
      case "set_field": return { from: "sys", text: `Guarda na ficha (${a.field}): ${a.value}` };
      case "tag": return { from: "sys", text: `${a.remove ? "Remove" : "Adiciona"} etiqueta ${name(lookups.tags, a.tagId) ?? ""}` };
      case "ai": return { from: "sys", text: "A IA responderia aqui (não é chamada no simulador)." };
      case "transfer": return { from: "sys", text: `Transferido para ${name(lookups.departments, a.departmentId) ?? "a fila geral"}.` };
      case "close": return { from: "sys", text: "Atendimento finalizado." };
      case "rating": return { from: "sys", text: `Nota registrada: ${a.value}` };
      case "rating_comment": return { from: "sys", text: "Comentário registrado." };
      case "queue": return { from: "sys", text: "Vai para a fila de atendimento." };
    }
  };

  const step = (node: string, input: string | null, base: SimState | null, timerFired = false) => {
    const ctx: FlowCtx = {
      firstContact: first, weekday: 1, minutes: 600, tagIds: [], groupIds: [], contactName: "Cliente Teste",
      protocol: "20260101-0001", vars: base?.vars ?? {}, attempts: base?.attempts ?? 0, aiTurns: base?.aiTurns ?? 0,
      timerFired, businessHours: open ? ALL_DAY : {},
    };
    const r: FlowResult = advance(graph, node, input, ctx);
    const out = r.actions.map(describe);
    if (r.passthrough) out.push({ from: "sys", text: "Não é uma nota: a pesquisa termina e a mensagem segue para o atendimento normal." });
    if (r.error) out.push({ from: "sys", text: `Erro: ${r.error}` });
    const ended = r.state === "done" || r.state === "error";
    if (ended) out.push({ from: "sys", text: "Fim do fluxo." });
    if (r.waitMinutes && !ended) out.push({ from: "sys", text: `Esperando até ${fmtMinutes(r.waitMinutes)}.` });
    setLines((ls) => [...ls, ...out]);
    setSim({ node: r.currentNodeId, vars: r.vars, attempts: r.attempts, aiTurns: r.aiTurns, wait: r.waitMinutes, ended });
    onActive(ended ? null : r.currentNodeId);
  };

  const start = () => {
    const s = graph.nodes.find((n) => n.type === "start");
    setLines([]);
    if (!s) return setLines([{ from: "sys", text: "O fluxo não tem bloco Início." }]);
    step(s.id, null, null);
  };

  const send = () => {
    const t = text.trim();
    if (!t || !sim?.node || sim.ended) return;
    setLines((ls) => [...ls, { from: "user", text: t }]);
    setText("");
    step(sim.node, t, sim);
  };

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold">Simulador</p>
        <Button size="sm" variant="outline" onClick={start}><RotateCcw className="w-4 h-4 mr-1" /> {sim ? "Recomeçar" : "Começar"}</Button>
      </div>
      <div className="space-y-1.5 text-sm">
        <div className="flex items-center gap-2"><Switch id="sim-first" checked={first} onCheckedChange={setFirst} /><Label htmlFor="sim-first">Primeiro contato</Label></div>
        <div className="flex items-center gap-2"><Switch id="sim-open" checked={open} onCheckedChange={setOpen} /><Label htmlFor="sim-open">Dentro do horário</Label></div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto rounded-md border p-2 space-y-1.5 bg-muted/30">
        {lines.length === 0 && <p className="text-xs text-muted-foreground">Clique em Começar. Nada é enviado ao WhatsApp nem gravado.</p>}
        {lines.map((l, i) => (
          <div key={i} className={l.from === "user" ? "text-right" : ""}>
            <span className={`inline-block max-w-[90%] rounded-md px-2 py-1 text-xs whitespace-pre-wrap text-left ${
              l.from === "user" ? "bg-primary text-primary-foreground" : l.from === "bot" ? "bg-card border" : "text-muted-foreground italic"}`}>
              {l.text}
            </span>
          </div>
        ))}
        <div ref={end} />
      </div>
      {sim?.wait && !sim.ended && (
        <Button size="sm" variant="outline" onClick={() => sim.node && step(sim.node, null, sim, true)}>
          <TimerReset className="w-4 h-4 mr-1" /> Passar o tempo
        </Button>
      )}
      <div className="flex gap-2">
        <Input value={text} placeholder="Mensagem do cliente" disabled={!sim || sim.ended} maxLength={500}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
        <Button size="icon" disabled={!sim || sim.ended} onClick={send} title="Enviar"><Send className="w-4 h-4" /></Button>
      </div>
    </div>
  );
}
