import type { ReactNode } from "react";
import { Clock, FlaskConical, Mic, Send, ShieldCheck, Sparkles } from "lucide-react";

function B({ d, children, primary }: { d: string; children: ReactNode; primary?: boolean }) {
  return <span data-demo={d} className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-medium ${primary ? "bg-primary text-primary-foreground" : "bg-background"}`}>{children}</span>;
}
const Toggle = ({ on, d }: { on: boolean; d: string }) => (
  <span data-demo={d} className={`inline-flex h-3 w-6 items-center rounded-full px-0.5 ${on ? "justify-end bg-primary" : "bg-muted-foreground/40"}`}><span className="h-2.5 w-2.5 rounded-full bg-white" /></span>
);

/** Miniatura da tela Assistente de IA para as demonstrações. Dados fictícios. */
export function AgenteMock({ state }: { state: string }) {
  const on = state !== "inicio";
  const texto = ["sugerido", "teste", "resposta", "followup", "salvo"].includes(state);
  return (
    <div className="h-full p-2 space-y-1.5">
      <p className="font-semibold">Assistente de IA</p>
      <p data-demo="regras" className="rounded border bg-muted/40 p-1"><ShieldCheck className="inline h-2.5 w-2.5" /> <b>O que a IA nunca faz</b>: dar desconto, prometer prazo, pedir dados de cartão…</p>
      <div className="flex items-center justify-between rounded border p-1.5">
        <span><b>Agente {on ? "ligado" : "desligado"}</b> · IA da Clubetec (incluída)</span>
        <Toggle on={on} d="toggle" />
      </div>
      <div className="rounded border p-1.5 space-y-0.5">
        <p className="font-medium">Como o agente se comporta</p>
        <p data-demo="caixa" className="min-h-[1.5rem] rounded border bg-background p-1">{texto ? "Você é o atendente da loja: responde com simpatia, tira dúvidas e passa para uma pessoa quando…" : ""}</p>
        <p className="flex gap-1"><B d="btn-sugerido"><Sparkles className="h-2.5 w-2.5" /> Usar texto sugerido</B> <B d="btn-falar"><Mic className="h-2.5 w-2.5" /> Falar</B></p>
      </div>
      {(state === "followup" || state === "salvo") && (
        <p className="flex items-center justify-between rounded border p-1"><span><Clock className="inline h-2.5 w-2.5" /> Follow-up automático: depois de 60 min</span><Toggle on d="toggle-follow" /></p>
      )}
      <p className="flex gap-1"><B d="btn-salvar" primary>Salvar</B> {state === "salvo" && <span className="text-success-text">✓ Salvo</span>}</p>
      {state === "degraus" && (
        <div data-demo="degraus" className="rounded border p-1.5 space-y-0.5">
          <p className="font-medium">Como a IA publica as respostas</p>
          <p data-demo="modo-sombra" className="rounded border border-primary bg-primary/5 px-1"><b>1. Sombra</b> — a IA sugere, você envia <span className="text-primary-text">(em uso)</span></p>
          <p data-demo="modo-assistido" className="rounded border px-1"><b>2. Assistido</b> — a IA envia o simples</p>
          <p className="rounded border px-1"><b>3. Automático</b> — depois de 14 dias sem tropeço</p>
          <p data-demo="disjuntor" className="rounded bg-muted px-1">Disjuntor: 3 tropeços em 24 h → volta um degrau sozinha</p>
        </div>
      )}
      {(state === "teste" || state === "resposta") && (
        <div className="rounded border p-1.5 space-y-0.5">
          <p className="font-medium"><FlaskConical className="inline h-2.5 w-2.5" /> Testar o agente</p>
          <p className="ml-auto w-fit rounded-xl bg-primary px-1.5 py-0.5 text-primary-foreground">Vocês abrem sábado?</p>
          {state === "resposta" && <p data-demo="resposta" className="w-fit rounded-xl bg-muted px-1.5 py-0.5">Abrimos sim, das 8h às 12h! Posso ajudar em mais alguma coisa?</p>}
          <p className="flex gap-1"><span className="flex-1 rounded border px-1">Mensagem do cliente…</span><B d="btn-enviar"><Send className="h-2.5 w-2.5" /></B></p>
        </div>
      )}
    </div>
  );
}
