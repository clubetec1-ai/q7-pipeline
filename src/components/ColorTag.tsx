import type { ReactNode } from "react";

/** Cores para setores, etiquetas e grupos de clientes (legíveis no claro e no escuro). */
export const PALETTE = ["#3FB8BE", "#6C8EF5", "#F59E0B", "#EF4444", "#10B981", "#8B5CF6", "#EC4899", "#64748B"];
const FALLBACK = "#94A3B8";

const safe = (c?: string | null) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : FALLBACK);

/** Primeira cor ainda não usada (ou a próxima da roda). */
export const nextColor = (used: (string | null | undefined)[]) =>
  PALETTE.find((c) => !used.includes(c)) ?? PALETTE[used.length % PALETTE.length];

/** Próxima cor da paleta (clique na bolinha troca a cor). */
export const cycleColor = (c?: string | null) => PALETTE[(PALETTE.indexOf(c ?? "") + 1) % PALETTE.length];

export function ColorDot({ color, title, onClick }: { color?: string | null; title?: string; onClick?: () => void }) {
  const dot = <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: safe(color) }} title={title} />;
  return onClick
    ? <button type="button" onClick={onClick} className="inline-flex p-0.5 rounded-full hover:ring-2 hover:ring-ring" title="Trocar cor" aria-label="Trocar cor">{dot}</button>
    : dot;
}

/** Etiqueta colorida pequena (setor na fila, na conversa e no Kanban). */
export function ColorPill({ color, children, title }: { color?: string | null; children: ReactNode; title?: string }) {
  const c = safe(color);
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-1.5 text-[10px] font-medium leading-4 shrink-0 max-w-[9rem] truncate"
      style={{ background: `${c}26`, color: c }} title={title}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c }} />{children}
    </span>
  );
}

export function ColorPicker({ value, onChange }: { value?: string | null; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Cor">
      {PALETTE.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={`Cor ${c}`}
          onClick={() => onChange(c)}
          className={`w-5 h-5 rounded-full border transition ${value === c ? "ring-2 ring-offset-1 ring-ring" : "hover:scale-110"}`}
          style={{ background: c }} />
      ))}
    </div>
  );
}
