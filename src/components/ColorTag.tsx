import type { CSSProperties, ReactNode } from "react";
import { TagIcon } from "./TagIcon";

/**
 * Paleta única de setores, etiquetas e grupos (8 + cinza): matizes espaçados, todos ≥ 3:1
 * como bolinha nos dois temas (docs/design/01-visual-acabamento.md §2.4). Fonte única:
 * as outras telas importam daqui.
 */
export const PALETTE = ["#2563EB", "#0891B2", "#16A34A", "#65A30D", "#D97706", "#E11D48", "#C026D3", "#7C3AED", "#64748B"];
const FALLBACK = "#64748B";

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
export function ColorPill({ color, children, title, icon }: { color?: string | null; children: ReactNode; title?: string; icon?: string | null }) {
  const c = safe(color);
  return (
    <span className="tag-pill inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium shrink-0 max-w-[10rem] truncate"
      style={{ "--c": c } as CSSProperties} title={title}>
      {icon ? <TagIcon icon={icon} className="w-2.5 h-2.5" /> : <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c }} />}{children}
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
