import type { ReactNode } from "react";
import { Check, PencilRuler, ShieldAlert } from "lucide-react";

function B({ d, children, primary }: { d: string; children: ReactNode; primary?: boolean }) {
  return <span data-demo={d} className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-medium ${primary ? "bg-primary text-primary-foreground" : "bg-background"}`}>{children}</span>;
}
const Chip = ({ c, children }: { c: string; children: ReactNode }) => <span className={`rounded px-1 ${c}`}>{children}</span>;

/** Miniatura da tela Processos para as demonstrações. Dados fictícios. */
export function ProcessosMock({ state }: { state: string }) {
  const desenhado = state !== "lista";
  return (
    <div className="h-full p-2 space-y-1.5">
      <p className="font-semibold">Processos da empresa</p>
      <div className="rounded border p-1.5 space-y-1">
        <p className="font-medium">Comercial</p>
        <div data-demo="processo" className="rounded border p-1 space-y-1">
          <p className="flex items-center justify-between gap-1"><b>Orçamento</b>
            {!desenhado ? <B d="btn-desenhar" primary><PencilRuler className="h-2.5 w-2.5" /> Desenhar com o Arquiteto</B>
              : state === "aprovado" ? <Chip c="bg-success-soft text-success-text">Aprovado · v1</Chip> : <Chip c="bg-warning-soft text-warning-text">Para aprovar</Chip>}
            {desenhado && <span data-demo="guardiao-selo" className="rounded bg-success-soft px-1 text-success-text">🛡️ Guardião: aprovado</span>}
          </p>
          {desenhado && (
            <>
              <ol data-demo="passos" className="space-y-0.5">
                <li>1. Responder com a tabela de preços <Chip c="bg-info-soft text-info-text">Modelo pronto</Chip></li>
                <li>2. Tirar dúvidas sobre os serviços <Chip c="bg-primary/15 text-primary-text">IA</Chip></li>
                <li data-demo="trava">3. Dar desconto para cliente antigo <Chip c="bg-warning-soft text-warning-text">Pessoa</Chip> <span className="text-muted-foreground">regra fixa</span></li>
                <li>4. Lembrar o cliente em 2 dias <Chip c="bg-info-soft text-info-text">Fluxo automático</Chip></li>
              </ol>
              <p data-demo="dados"><ShieldAlert className="inline h-2.5 w-2.5 text-danger-text" /> Dados: Nome · <span className="text-danger-text">CPF (sensível)</span></p>
              {state !== "aprovado" && <p className="flex gap-1"><B d="btn-aprovar" primary><Check className="h-2.5 w-2.5" /> Aprovar processo</B> <B d="btn-ajuste">Pedir ajuste e redesenhar</B></p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
