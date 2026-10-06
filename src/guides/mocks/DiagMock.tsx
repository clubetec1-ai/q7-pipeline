import type { ReactNode } from "react";
import { Check, Mic, MicVocal, Paperclip, Sparkles, Square } from "lucide-react";

/** Botão em miniatura (marcado com data-demo para o cursor achar). */
function B({ d, children, primary, danger }: { d: string; children: ReactNode; primary?: boolean; danger?: boolean }) {
  return (
    <span data-demo={d} className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-medium ${
      danger ? "bg-danger text-white" : primary ? "bg-primary text-primary-foreground" : "bg-background"}`}>{children}</span>
  );
}

const STEPS_NAV = ["Empresa", "Clientes e jornada", "Pós-venda", "Marca", "Cultura"];

/** Miniatura da tela do Diagnóstico para as demonstrações do passo a passo. */
export function DiagMock({ state }: { state: string }) {
  const next = state === "proxima" || state === "aprovado";
  const page = next ? "Clientes e jornada" : "Empresa";
  const text = state === "pagina" ? "" : state === "falando" ? "Somos uma loja de móveis planejados em Campinas e atendemos…"
    : "Somos uma loja de móveis planejados em Campinas. Atendemos pelo WhatsApp de segunda a sábado, das 8h às 18h. Fazemos orçamento em até 2 dias.";
  const voice = ["entrevista", "ouvindo", "pergunta2", "anexado"].includes(state);
  return (
    <div className="flex h-full">
      <div className="w-1/4 border-r bg-muted/40 p-1.5 space-y-0.5">
        <p className="font-semibold">Diagnóstico</p>
        {STEPS_NAV.map((s, k) => {
          const done = (s === "Empresa" && state === "aprovado");
          return (
            <p key={s} data-demo={k === 0 ? "nav-empresa" : undefined}
              className={`flex items-center gap-0.5 rounded px-1 py-0.5 ${s === page ? "bg-primary text-primary-foreground" : ""}`}>
              {done ? <Check className="h-2.5 w-2.5" /> : <span className="h-2 w-2 rounded-full border" />}{s}
            </p>
          );
        })}
      </div>
      <div className="flex-1 p-2 space-y-1.5">
        <p data-demo="titulo" className="text-[12px] font-semibold">{page} {next && state === "proxima" && <span className="ml-1 rounded bg-success-soft px-1 text-[9px] font-normal text-success-text">Etapa salva</span>}</p>
        <p className="text-muted-foreground">• O que a empresa faz, para quem e onde • Canais e horários • Produtos e preços</p>
        {voice ? (
          <div className="rounded border border-primary/40 bg-primary/5 p-1.5 space-y-1">
            <p className="flex items-center gap-1 font-medium"><MicVocal className="h-3 w-3" /> Entrevista por voz</p>
            <p className="rounded border bg-background p-1">
              <span className="block text-muted-foreground">Pergunta {state === "entrevista" || state === "ouvindo" ? 1 : 2}</span>
              {state === "entrevista" || state === "ouvindo" ? "Olá! Vamos falar da sua empresa. O que vocês vendem e para quem?"
                : "Legal! Vocês fazem orçamento? Se tiver o modelo, pode anexar aqui embaixo."}
            </p>
            <div className="flex flex-wrap items-center gap-1">
              {state === "ouvindo"
                ? <><span className="text-danger-text">● Ouvindo… 0:12</span><B d="btn-terminei"><Square className="h-2.5 w-2.5" /> Terminei de responder</B><B d="btn-pausar">Pausar</B><B d="btn-recomecar">Recomeçar esta resposta</B></>
                : <><B d="btn-responder" primary><Mic className="h-2.5 w-2.5" /> Responder</B>
                  {state !== "entrevista" && <B d="btn-anexar-material" primary><Paperclip className="h-2.5 w-2.5" /> Anexar: modelo de orçamento</B>}</>}
              {state === "anexado" && <span className="rounded-full border px-1"><Paperclip className="inline h-2.5 w-2.5" /> orcamento-modelo.pdf</span>}
            </div>
            <p className="flex items-center gap-1">Voz: <span data-demo="voz" className="rounded border bg-background px-1">Voz 1 (feminina) ▾</span>
              {state !== "entrevista" && <span className="text-muted-foreground">· Respostas até agora (1) — salvas automaticamente</span>}</p>
          </div>
        ) : state === "organizado" ? (
          <div className="rounded border bg-muted/40 p-1.5 space-y-1">
            <div data-demo="cobertura" className="rounded border bg-background p-1 space-y-0.5">
              <p><b>📊 Informação completa: 5 de 7</b></p>
              <span className="block h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full w-[70%] bg-primary" /></span>
              <p className="flex flex-wrap items-center gap-1">○ <b>Trocas e garantia</b> <span className="text-muted-foreground">— sem isso o agente pode prometer errado</span>
                <B d="btn-nao-temos">Não temos isso</B></p>
            </div>
            <div data-demo="revisao" className="rounded border bg-background p-1 space-y-0.5">
              <p>🧐 <b>Revisão do Diretor Comercial (IA)</b>: 1 ponto</p>
              <p><span className="rounded bg-danger-soft px-1 text-danger-text">importante</span> Aqui diz atendimento até 18h, mas no Pós-venda diz suporte 24h.</p>
              <p className="flex gap-1"><B d="btn-corrigi">Corrigi</B> <B d="btn-certo">Está certo assim</B></p>
            </div>
            <p className="font-medium">Organizado pela IA — confira:</p>
            <p><b>Empresa:</b> loja de móveis planejados em Campinas.</p>
            <p><b>Atendimento:</b> WhatsApp, seg. a sáb., 8h–18h.</p>
            <p><b>Orçamento:</b> em até 2 dias.</p>
            <B d="btn-aprovar" primary><Check className="h-2.5 w-2.5" /> Aprovar e seguir</B>
          </div>
        ) : (
          <div data-demo="caixa" className="h-[38%] rounded border bg-background p-1 text-foreground">
            {text || <span className="text-muted-foreground">Escreva aqui ou clique em Falar…</span>}
          </div>
        )}
        {!voice && state !== "organizado" && (
          <>
            {(state === "salvo" || state === "escrevendo") && <p data-demo="salvo" className="text-success-text">✓ Salvo às 14:32</p>}
            <div className="flex flex-wrap gap-1">
              <B d="btn-falar" danger={state === "falando"}>{state === "falando" ? <><Square className="h-2.5 w-2.5" /> Parar ditado 0:07</> : <><Mic className="h-2.5 w-2.5" /> Falar</>}</B>
              <B d="btn-anexar"><Paperclip className="h-2.5 w-2.5" /> Anexar materiais</B>
              <B d="btn-entrevista"><MicVocal className="h-2.5 w-2.5" /> Entrevista por voz</B>
            </div>
            <div className="flex flex-wrap gap-1">
              <B d="btn-pular">Não sei / pular</B>
              <B d="btn-salvar-proxima">Salvar e próxima etapa →</B>
              <B d="btn-organizar" primary><Sparkles className="h-2.5 w-2.5" /> Organizar com IA</B>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
