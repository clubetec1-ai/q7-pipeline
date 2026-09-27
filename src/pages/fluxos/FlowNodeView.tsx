import { useContext } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { BLOCK, type BlockData } from "./blocks";
import { OverlayContext } from "./overlay";

/** Um bloco no canvas: título colorido, resumo e uma saída por resultado. */
export function FlowNodeView({ id, type, data, selected }: NodeProps) {
  const { stats, active } = useContext(OverlayContext);
  const def = BLOCK[type];
  if (!def) return null;
  const d = data as BlockData;
  const outputs = def.outputs(d);
  const count = stats?.[id];
  const ring = active === id ? "ring-4 ring-amber-400" : selected ? "ring-2 ring-primary" : "";
  return (
    <div className={`w-56 rounded-lg border bg-card text-card-foreground shadow-sm ${ring}`}>
      {type !== "start" && <Handle type="target" position={Position.Left} className="!w-3 !h-3" />}
      <div className="px-3 py-1.5 rounded-t-lg text-xs font-semibold text-white" style={{ background: def.color }}>
        {def.label}
      </div>
      <p className="px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap break-words">{def.summary(d) || "—"}</p>
      {outputs.map((o) => (
        <div key={o.id} className="relative border-t px-3 py-1 text-[11px] text-right pr-4">
          {stats && <span className="float-left font-mono text-muted-foreground">{count?.[o.id] ?? 0}</span>}
          {o.label}
          <Handle id={o.id} type="source" position={Position.Right} className="!w-3 !h-3" style={{ background: def.color }} />
        </div>
      ))}
    </div>
  );
}
