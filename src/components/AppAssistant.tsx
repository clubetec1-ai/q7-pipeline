import { Fragment, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { HelpCircle, Send } from "lucide-react";
import { useOrg } from "@/contexts/OrgContext";
import { callFunction } from "@/lib/callFunction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

type Msg = { role: "user" | "assistant"; content: string };
const EXAMPLES = ["Como conecto o WhatsApp?", "Como convido um atendente?", "Como ligo o agente de IA?", "Onde vejo os resultados?"];

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
 * "Como faço…?": assistente de uso do sistema, aberto pelo cabeçalho em qualquer tela.
 * Responde com o passo a passo e um botão que leva à tela certa (menos suporte humano).
 */
export function AppAssistant() {
  const { org } = useOrg();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [msgs, busy]);
  if (!org) return null;

  const send = async (t = text) => {
    const content = t.trim();
    if (!content || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content }];
    setMsgs(next); setText(""); setBusy(true); setErr(null);
    const r = await callFunction<{ reply: string }>("app-assistant", { organization_id: org.id, messages: next, page: pathname });
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    setMsgs([...next, { role: "assistant", content: r.data.reply }]);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className="h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-muted" title="Como faço…? (ajuda)" aria-label="Ajuda">
        <HelpCircle className="w-4 h-4" />
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md flex flex-col">
        <SheetHeader><SheetTitle>Como faço…?</SheetTitle></SheetHeader>
        <p className="text-xs text-muted-foreground">Pergunte como usar qualquer parte do sistema. A resposta traz o passo a passo e um botão para abrir a tela.</p>
        <div className="flex-1 overflow-y-auto space-y-2 py-2">
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
          {busy && <p className="text-xs text-muted-foreground">Procurando o caminho…</p>}
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div ref={end} />
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <Input value={text} maxLength={500} placeholder="Ex.: como crio uma etiqueta?" onChange={(e) => setText(e.target.value)} disabled={busy} />
          <Button type="submit" disabled={busy || !text.trim()} aria-label="Enviar"><Send className="w-4 h-4" /></Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
