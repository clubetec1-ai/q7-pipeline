import type { ReactNode } from "react";
import { Send, Sparkles, X } from "lucide-react";

function B({ d, children, primary }: { d: string; children: ReactNode; primary?: boolean }) {
  return <span data-demo={d} className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-medium ${primary ? "bg-primary text-primary-foreground" : "bg-background"}`}>{children}</span>;
}

/** Miniatura da tela Conversas para as demonstrações. Dados fictícios. */
export function ConversasMock({ state }: { state: string }) {
  const usada = state === "usada";
  return (
    <div className="h-full p-2 grid grid-cols-[38%_1fr] gap-1.5">
      <div data-demo="lista" className="rounded border p-1 space-y-1">
        <p className="font-semibold">Conversas</p>
        <p data-demo="fila" className="rounded bg-warning-soft px-1 text-warning-text">Fila (2)</p>
        <p className="rounded bg-muted px-1"><b>Maria S.</b> · certidão de casamento</p>
        <p className="px-1">João P. · escritura</p>
      </div>
      <div className="rounded border p-1 flex flex-col gap-1">
        <p className="font-medium">Maria S. <span className="text-muted-foreground">· protocolo 2026-0142</span></p>
        <p className="self-start rounded bg-muted px-1">Quanto custa a segunda via da certidão?</p>
        {!usada && (
          <div data-demo="sugestao" className="rounded border border-primary/40 bg-primary/5 p-1 space-y-0.5">
            <p className="flex items-center gap-1 font-medium"><Sparkles className="h-2.5 w-2.5" /> Sugestão da IA</p>
            <p className="text-muted-foreground">Modo sombra: a IA sugere e uma pessoa envia.</p>
            <p>A segunda via custa R$ 58,40 e fica pronta em 2 dias úteis.</p>
            <p className="flex gap-1"><B d="btn-usar">Usar sugestão</B> <B d="btn-dispensar"><X className="h-2.5 w-2.5" /> Dispensar</B></p>
          </div>
        )}
        <p data-demo="caixa" className={`mt-auto flex items-center justify-between gap-1 rounded border px-1 ${usada ? "border-primary" : "text-muted-foreground"}`}>
          {usada ? "A segunda via custa R$ 58,40 e fica pronta em 2 dias úteis." : "Escreva uma mensagem…"} <B d="btn-enviar" primary={usada}><Send className="h-2.5 w-2.5" /></B>
        </p>
      </div>
    </div>
  );
}
