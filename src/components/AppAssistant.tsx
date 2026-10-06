import { Fragment, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { BookOpen, HelpCircle, LifeBuoy, PlayCircle, Send, ThumbsDown, ThumbsUp } from "lucide-react";
import { useOrg } from "@/contexts/OrgContext";
import { callFunction } from "@/lib/callFunction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { GUIDES, guidesFor } from "@/guides/registry";
import { openGuide } from "@/guides/types";

type Msg = { role: "user" | "assistant"; content: string };
const EXAMPLES = ["Como conecto o WhatsApp?", "Como convido um atendente?", "Como ligo o agente de IA?", "Onde vejo os resultados?"];
const URG: Record<string, string> = { baixa: "baixa", media: "média", alta: "alta", urgente: "urgente" };

/** Texto da resposta com [[Tela|/caminho]] virando botão que abre a tela (só caminhos internos). */
function Answer({ text, onGo }: { text: string; onGo: () => void }) {
  const parts = text.split(/(\[\[[^\]|]{1,60}\|\/[^\]\s]{0,80}\]\])/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^\[\[([^\]|]+)\|(\/[^\]\s]*)\]\]$/);
        return m
          ? <Link key={i} to={m[2]} onClick={onGo} className="inline-flex items-center rounded-full border border-primary/50 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary-text hover:bg-primary/20 mx-0.5">{m[1]} →</Link>
          : <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

/**
 * Ajuda (o "?" do cabeçalho): base de conhecimento do sistema.
 *  1. Passo a passo e vídeo da tela atual (e de todas as telas).
 *  2. "Como faço…?": a IA responde com o caminho; depois pergunta se resolveu.
 *  3. "Não resolveu" → a IA abre o chamado para o suporte com a conversa e a urgência.
 * O acompanhamento dos chamados fica em Configurações → Suporte (fora do caminho do dia a dia).
 */
export function AppAssistant() {
  const { org, can } = useOrg();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Depois da resposta: null = ainda não disse; "sim"; "nao" (mostra o chamado); "aberto" (chamado criado).
  const [solved, setSolved] = useState<null | "sim" | "nao" | "aberto">(null);
  const [note, setNote] = useState("");
  const [ticket, setTicket] = useState<{ urgency: string; topic: string; protocol?: string } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [msgs, busy, solved]);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("help:open", onOpen);
    return () => window.removeEventListener("help:open", onOpen);
  }, []);
  if (!org) return null;
  const manager = can("org.settings");
  const here = guidesFor(pathname);

  const send = async (t = text) => {
    const content = t.trim();
    if (!content || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content }];
    setMsgs(next); setText(""); setBusy(true); setErr(null); setSolved(null);
    const r = await callFunction<{ reply: string }>("app-assistant", { organization_id: org.id, messages: next, page: pathname });
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    setMsgs([...next, { role: "assistant", content: r.data.reply }]);
  };
  const escalate = async () => {
    setBusy(true); setErr(null);
    const r = await callFunction<{ urgency: string; topic: string; protocol?: string }>("app-assistant", {
      action: "escalate", organization_id: org.id, messages: msgs, page: pathname, note,
    });
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    setTicket(r.data); setSolved("aberto"); setNote("");
  };
  const showGuide = (id: string, route: string) => {
    setOpen(false);
    if (route !== pathname) navigate(route);
    window.setTimeout(() => openGuide(id), route !== pathname ? 600 : 150);
  };
  const lastIsAnswer = msgs.length > 0 && msgs[msgs.length - 1].role === "assistant";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className="h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-muted" title="Ajuda: passo a passo, vídeos e dúvidas" aria-label="Ajuda">
        <HelpCircle className="w-4 h-4" />
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md flex flex-col">
        <SheetHeader><SheetTitle className="flex items-center gap-2"><BookOpen className="w-4 h-4" /> Ajuda</SheetTitle></SheetHeader>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Nesta tela</p>
          {here.length ? here.map((g) => (
            <Button key={g.id} variant="outline" className="w-full justify-start" onClick={() => showGuide(g.id, g.routes[0])}>
              <PlayCircle className="w-4 h-4 mr-2" /> Passo a passo e vídeo: {g.title}
            </Button>
          )) : <p className="text-xs text-muted-foreground">Esta tela ainda não tem passo a passo. Pergunte abaixo que a IA mostra o caminho.</p>}
          {GUIDES.length > here.length && (
            <details className="text-sm">
              <summary className="cursor-pointer text-xs text-muted-foreground">Todos os passo a passo ({GUIDES.length})</summary>
              <div className="mt-1 space-y-1">
                {GUIDES.map((g) => (
                  <button key={g.id} type="button" className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-muted" onClick={() => showGuide(g.id, g.routes[0])}>
                    <PlayCircle className="w-3.5 h-3.5" /> {g.title}
                  </button>
                ))}
              </div>
            </details>
          )}
        </div>

        <p className="text-xs font-medium text-muted-foreground pt-1">Como faço…? Pergunte e a IA mostra o caminho.</p>
        <div className="flex-1 overflow-y-auto space-y-2 py-1">
          {!msgs.length && (
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((e) => <Button key={e} size="sm" variant="outline" onClick={() => void send(e)}>{e}</Button>)}
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted rounded-bl-sm"}`}>
                {m.role === "assistant" ? <Answer text={m.content} onGo={() => setOpen(false)} /> : m.content}
              </div>
            </div>
          ))}
          {busy && <p className="text-xs text-muted-foreground">{solved === "nao" ? "Abrindo o chamado…" : "Procurando o caminho…"}</p>}

          {/* Resolveu? Se não, a própria Ajuda abre o chamado com a conversa. */}
          {lastIsAnswer && !busy && solved === null && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Resolveu?</span>
              <Button size="sm" variant="outline" onClick={() => setSolved("sim")}><ThumbsUp className="w-4 h-4 mr-1" /> Sim</Button>
              <Button size="sm" variant="outline" onClick={() => setSolved("nao")}><ThumbsDown className="w-4 h-4 mr-1" /> Não resolveu</Button>
            </div>
          )}
          {solved === "sim" && <p className="text-sm text-success-text">Que bom! Se precisar, é só perguntar de novo.</p>}
          {solved === "nao" && !busy && (
            <div className="rounded-md border p-2 space-y-2 text-sm">
              <p>Vou abrir um <b>chamado para o suporte</b> com esta conversa. A IA avalia a urgência e a equipe Clubetec é avisada.</p>
              <Textarea rows={2} maxLength={800} placeholder="Quer acrescentar algo? (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void escalate()}><LifeBuoy className="w-4 h-4 mr-1" /> Abrir chamado</Button>
                <Button size="sm" variant="ghost" onClick={() => setSolved(null)}>Agora não</Button>
              </div>
            </div>
          )}
          {solved === "aberto" && ticket && (
            <div className="rounded-md bg-primary/10 p-2 text-sm space-y-1">
              <p><b>Chamado {ticket.protocol ?? ""} aberto</b> (urgência {URG[ticket.urgency] ?? ticket.urgency}): {ticket.topic}</p>
              <p className="text-muted-foreground">Você recebe a confirmação por e-mail e a resposta da equipe chega no sino.</p>
              {manager
                ? <Link to="/configuracoes/suporte" onClick={() => setOpen(false)} className="underline">Acompanhar em Configurações → Suporte</Link>
                : <p className="text-muted-foreground">O responsável pela empresa acompanha em Configurações → Suporte. A resposta também chega no sino.</p>}
            </div>
          )}
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div ref={end} />
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <Input value={text} maxLength={500} placeholder="Ex.: como crio uma etiqueta?" onChange={(e) => setText(e.target.value)} disabled={busy} />
          <Button type="submit" disabled={busy || !text.trim()} aria-label="Enviar"><Send className="w-4 h-4" /></Button>
        </form>
        {manager && (
          <Link to="/configuracoes/suporte" onClick={() => setOpen(false)} className="text-xs text-muted-foreground underline text-center">
            Meus chamados de suporte
          </Link>
        )}
      </SheetContent>
    </Sheet>
  );
}
