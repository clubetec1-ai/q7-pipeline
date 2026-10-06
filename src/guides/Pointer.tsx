import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

/** Imitação de um botão da tela com uma seta apontando: "é aqui que você clica". */
export function Pointer({ icon, label, note }: { icon: ReactNode; label: string; note: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
      <span className="inline-flex shrink-0 items-center gap-1 rounded-md border bg-background px-2.5 py-1 font-medium shadow-sm">{icon}{label}</span>
      <ArrowLeft className="w-4 h-4 shrink-0 text-primary" />
      <span className="min-w-[9rem] flex-1 text-muted-foreground">{note}</span>
    </div>
  );
}
