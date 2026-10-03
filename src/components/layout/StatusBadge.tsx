import type { ReactNode } from "react";

export type AttendanceStatus = "bot" | "queued" | "open" | "closed" | "help";

/** Cores fixas de status (não mudam com a cor da empresa): IA violeta, fila âmbar, em atendimento azul, finalizado cinza. */
const STYLE: Record<AttendanceStatus, [string, string]> = {
  bot: ["bg-status-ia-soft text-status-ia-text", "bg-status-ia"],
  queued: ["bg-warning-soft text-warning-text", "bg-warning"],
  open: ["bg-info-soft text-info-text", "bg-info"],
  help: ["bg-danger-soft text-danger-text", "bg-danger"],
  closed: ["bg-muted text-muted-foreground", "bg-muted-foreground"],
};

/** Selo de status do atendimento: forma retangular com bolinha (etiqueta de setor é redonda, sem bolinha). */
export function StatusBadge({ status, children }: { status: AttendanceStatus; children: ReactNode }) {
  const [box, dot] = STYLE[status] ?? STYLE.closed;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${box}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />{children}
    </span>
  );
}
