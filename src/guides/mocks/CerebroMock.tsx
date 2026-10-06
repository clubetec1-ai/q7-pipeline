import type { ReactNode } from "react";
import { Network, Sparkles } from "lucide-react";

function B({ d, children, primary }: { d: string; children: ReactNode; primary?: boolean }) {
  return <span data-demo={d} className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-medium ${primary ? "bg-primary text-primary-foreground" : "bg-background"}`}>{children}</span>;
}

/** Miniatura da tela Cérebro para as demonstrações. Dados fictícios. */
export function CerebroMock({ state }: { state: string }) {
  const analisado = state !== "inicio";
  return (
    <div className="h-full p-2 space-y-1.5">
      <p className="flex items-center justify-between font-semibold">Cérebro
        <span className="flex gap-1">
          <B d="btn-time">Time de IA</B>
          <B d="btn-processos">Processos</B>
          <B d="btn-analisar" primary><Sparkles className="h-2.5 w-2.5" /> Analisar agora</B>
        </span>
      </p>
      <div data-demo="rede" className="rounded border p-1">
        <p className="flex items-center gap-1 font-medium"><Network className="h-2.5 w-2.5" /> Rede do time de IA (30 dias)</p>
        <p>12 dúvidas · 9 o time resolveu · 3 chegaram a você</p>
      </div>
      {analisado && (
        <div data-demo="resumo" className="rounded border p-1 space-y-0.5">
          <p className="flex justify-between font-medium">Resumo da semana <span className="rounded bg-status-ia-soft px-1 text-status-ia-text">Sugestão da IA — a decisão é sua</span></p>
          <p>Atendimento: tempo de resposta caiu de 12 para 4 min.</p>
        </div>
      )}
      {analisado && (
        <div data-demo="pendencias" className="rounded border p-1">
          <p className="font-medium">Pendências</p>
          <p>Proposta: lembrete automático para quem pediu certidão · <b>Aprovar</b> · Recusar</p>
        </div>
      )}
      <div data-demo="area" className="rounded border p-1">
        <p className="font-medium">Atendimento <span className="text-muted-foreground">· meta: responder em até 5 min</span></p>
        <p>Esta semana: 4 min <span className="text-success-text">no rumo</span></p>
      </div>
    </div>
  );
}
