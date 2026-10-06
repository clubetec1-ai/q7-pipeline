import type { ReactNode } from "react";
import { Check, Network, Pause } from "lucide-react";

function B({ d, children, primary }: { d: string; children: ReactNode; primary?: boolean }) {
  return <span data-demo={d} className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-medium ${primary ? "bg-primary text-primary-foreground" : "bg-background"}`}>{children}</span>;
}
const Card = ({ d, cls, children }: { d?: string; cls?: string; children: ReactNode }) =>
  <div data-demo={d} className={`rounded border p-1 ${cls ?? ""}`}>{children}</div>;

/** Miniatura da tela Time de IA para as demonstrações. Dados fictícios. */
export function OrganogramaMock({ state }: { state: string }) {
  const montado = state !== "vazio";
  const proposto = state === "proposto";
  return (
    <div className="h-full p-2 space-y-1">
      <p className="flex items-center justify-between font-semibold">Time de IA
        <span className="flex gap-1">
          <B d="btn-montar"><Network className="h-2.5 w-2.5" /> {montado ? "Atualizar o time" : "Montar o time com o cérebro"}</B>
          {proposto && <B d="btn-aprovar-time" primary><Check className="h-2.5 w-2.5" /> Aprovar o time (6)</B>}
        </span>
      </p>
      {state === "rede" && (
        <div data-demo="rede" className="rounded border p-1.5 space-y-0.5">
          <p className="font-medium">Rede do time de IA</p>
          <p>Atendente (IA) → Coordenador (IA) → Cérebro (IA) → <b>você</b></p>
          <p className="rounded bg-muted px-1">“Vocês atendem aos sábados?” — <span className="text-success-text">resolvida pelo time (fonte: Diagnóstico)</span></p>
          <p data-demo="pergunta-voce" className="rounded bg-primary/10 px-1">“Fazem entrega em outra cidade?” — <b>esperando você no Diagnóstico</b></p>
        </div>
      )}
      {state === "rede" ? null : !montado ? <p className="rounded border border-dashed p-2 text-muted-foreground">Ainda não há time.</p> : (
        <div className="space-y-1">
          <Card d="agente-cerebro" cls="border-primary bg-primary/5"><b>Cérebro — visão de CEO (IA)</b> {proposto && <span className="rounded bg-warning-soft px-1 text-warning-text">Para aprovar</span>}</Card>
          <div className="ml-3 space-y-1 border-l pl-2">
            <Card d="agente-diretor" cls="border-info bg-info-soft/40"><b>Diretor Comercial e de Marketing (IA)</b></Card>
            <div className="ml-3 space-y-1 border-l pl-2">
              <Card d="agente-especialista"><b>Especialista em Orçamento (IA)</b> <span className="text-muted-foreground">· vê os processos do setor · sugere melhorias</span></Card>
              <Card d="agente-executor" cls="border-warning bg-warning-soft/40">
                <b>Bia — Atendente do setor Comercial (IA)</b>
                <span className="block text-muted-foreground">Vê só a conversa que está atendendo · responde o cliente · passa para uma pessoa</span>
                {!proposto && (
                  <span className="mt-0.5 flex items-center gap-1">Autonomia: <span data-demo="autonomia" className="rounded border bg-background px-1">Sugere — você decide ▾</span>
                    <B d="btn-pausar"><Pause className="h-2.5 w-2.5" /> Pausar</B></span>
                )}
                {state === "prova" && (
                  <span data-demo="prova" className="mt-0.5 block rounded border bg-background p-1">🧪 <b>Prova</b> <span className="text-success-text">✓ 7 de 7</span>
                    <span className="block">✓ Reclamação · ✓ Pedido proibido · ✓ Tentativa de burla · ✓ Dado de outro cliente…</span>
                    <B d="btn-rodar" primary>Rodar a prova</B></span>
                )}
              </Card>
            </div>
          </div>
          <Card d="apoio" cls="border-dashed"><b>Equipe de apoio (7)</b>: Analista de Diagnóstico, Revisor, Arquiteto, Implementador, Guardião…</Card>
        </div>
      )}
    </div>
  );
}
