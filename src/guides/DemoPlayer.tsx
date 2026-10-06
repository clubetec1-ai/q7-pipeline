import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MousePointer2, Pause, Play, RotateCcw } from "lucide-react";
import type { Scene } from "./types";

/**
 * "Vídeo" curto do caminho: uma miniatura da tela com um cursor que vai até o botão,
 * clica e mostra o resultado, com legenda. Feito com a própria interface (não envelhece
 * como um vídeo gravado) e sem baixar nada. Repete sozinho; dá para pausar e recomeçar.
 */
export function DemoPlayer({ scenes, render }: { scenes: Scene[]; render: (state: string) => ReactNode }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [pos, setPos] = useState({ x: 88, y: 88 });
  const [click, setClick] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, "");
  const s = scenes[i] ?? scenes[0];

  // O cursor vai até o centro do elemento marcado com data-demo="<alvo>".
  useLayoutEffect(() => {
    const el = s?.target ? box.current?.querySelector<HTMLElement>(`[data-demo="${s.target}"]`) : null;
    if (!el || !box.current) return;
    const b = box.current.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    setPos({ x: ((r.left + r.width / 2 - b.left) / b.width) * 100, y: ((r.top + r.height / 2 - b.top) / b.height) * 100 });
  }, [i, s?.target]);

  useEffect(() => {
    if (!playing || !s) return;
    setClick(false);
    const c = s.target ? window.setTimeout(() => setClick(true), 1100) : 0;
    const t = window.setTimeout(() => setI((k) => (k + 1) % scenes.length), s.ms ?? 3000);
    return () => { window.clearTimeout(c); window.clearTimeout(t); };
  }, [i, playing, s, scenes.length]);

  if (!s) return null;
  return (
    <div className="space-y-1.5">
      <div ref={box} data-demo-box={id} className="relative aspect-video w-full overflow-hidden rounded-lg border bg-background text-[10px] leading-tight select-none" aria-hidden>
        {s.target && <style>{`[data-demo-box="${id}"] [data-demo="${s.target}"]{box-shadow:0 0 0 2px hsl(var(--primary));border-radius:6px}`}</style>}
        {render(s.state)}
        <span className="pointer-events-none absolute z-10 transition-all duration-700 ease-out motion-reduce:transition-none"
          style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
          {click && <span className="absolute -left-2 -top-2 h-5 w-5 rounded-full bg-primary/40 animate-ping" />}
          <MousePointer2 className="h-5 w-5 fill-foreground text-background drop-shadow" />
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className="rounded-md border p-1 hover:bg-muted" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pausar" : "Continuar"}>
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
        <button type="button" className="rounded-md border p-1 hover:bg-muted" onClick={() => { setI(0); setPlaying(true); }} aria-label="Ver de novo">
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
        <p className="flex-1 text-sm font-medium" aria-live="polite">{s.caption}</p>
        <span className="text-xs text-muted-foreground">{i + 1}/{scenes.length}</span>
      </div>
    </div>
  );
}
