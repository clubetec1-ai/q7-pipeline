import type { ReactNode } from "react";
import { HelpCircle, LifeBuoy, PlayCircle, ThumbsDown, ThumbsUp } from "lucide-react";

function B({ d, children, primary }: { d: string; children: ReactNode; primary?: boolean }) {
  return <span data-demo={d} className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-medium ${primary ? "bg-primary text-primary-foreground" : "bg-background"}`}>{children}</span>;
}

/** Miniatura da Ajuda (?) e de Configurações → Suporte para a demonstração. */
export function SupportMock({ state }: { state: string }) {
  if (state === "lista") {
    return (
      <div className="h-full p-2 space-y-1.5">
        <p className="text-[12px] font-semibold flex items-center gap-1"><LifeBuoy className="h-3 w-3" /> Configurações → Suporte</p>
        <div data-demo="chamado" className="rounded border p-1.5 space-y-1">
          <p className="flex flex-wrap items-center gap-1"><b>Número do WhatsApp desconectou</b>
            <span className="rounded bg-danger-soft px-1 text-danger-text">Urgente</span>
            <span className="rounded bg-info-soft px-1 text-info-text">Em andamento</span></p>
          <p className="rounded bg-primary/10 p-1"><b>Resposta da equipe Clubetec:</b> já estamos verificando; reconecte pelo QR em Números.</p>
        </div>
        <div className="rounded border p-1.5"><b>Como mudar a saudação?</b> <span className="rounded bg-success-soft px-1 text-success-text">Resolvido</span></div>
      </div>
    );
  }
  return (
    <div className="flex h-full">
      <div className="flex-1 bg-muted/30 p-2">
        <p className="flex justify-end"><span data-demo="btn-ajuda" className="rounded border bg-background p-0.5"><HelpCircle className="h-3.5 w-3.5" /></span></p>
      </div>
      <div className="w-[58%] border-l bg-background p-1.5 space-y-1">
        <p className="font-semibold">Ajuda</p>
        <B d="btn-guia"><PlayCircle className="h-2.5 w-2.5" /> Passo a passo e vídeo desta tela</B>
        <p className="ml-auto w-fit rounded-xl bg-primary px-1.5 py-0.5 text-primary-foreground">Meu número parou de responder</p>
        <p className="w-fit rounded-xl bg-muted px-1.5 py-0.5">Veja em Números se ele está conectado… <span className="text-primary">Números →</span></p>
        {state === "ajuda" && (
          <p className="flex items-center gap-1">Resolveu? <B d="btn-sim"><ThumbsUp className="h-2.5 w-2.5" /> Sim</B> <B d="btn-nao"><ThumbsDown className="h-2.5 w-2.5" /> Não resolveu</B></p>
        )}
        {state === "nao" && (
          <div className="rounded border p-1 space-y-1">
            <p>Vou abrir um chamado com esta conversa. A IA avalia a urgência.</p>
            <B d="btn-abrir" primary><LifeBuoy className="h-2.5 w-2.5" /> Abrir chamado</B>
          </div>
        )}
        {state === "aberto" && (
          <p data-demo="aberto" className="rounded bg-primary/10 p-1"><b>Chamado aberto</b> (urgência urgente). Acompanhar em Configurações → Suporte</p>
        )}
      </div>
    </div>
  );
}
