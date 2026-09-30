import { useEffect, useRef, useState } from "react";
import { FlaskConical, RotateCcw, Send } from "lucide-react";
import { callFunction } from "@/lib/callFunction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Msg = { role: "user" | "assistant"; content: string };
const EXAMPLES = ["Oi, quanto custa?", "Vocês atendem no sábado?", "Quero falar com uma pessoa", "Me dá um desconto?"];

/**
 * Testar o agente: o dono escreve como se fosse o cliente e vê como a IA responde,
 * com o comportamento da tela (mesmo sem salvar), a empresa, a marca, as regras e
 * a base de conhecimento. Nada vai para cliente nenhum e nada fica gravado.
 */
export function AgentTester({ orgId, prompt, disabled }: { orgId: string; prompt: string; disabled?: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [used, setUsed] = useState<{ empresa: boolean; base: boolean } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [msgs, busy]);

  const send = async (t = text) => {
    const content = t.trim();
    if (!content || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content }];
    setMsgs(next); setText(""); setBusy(true); setErr(null);
    const r = await callFunction<{ reply: string; used: { empresa: boolean; base: boolean } }>("agent-test", { organization_id: orgId, messages: next, prompt });
    setBusy(false);
    if (!r.ok) { setErr(r.message); return; }
    setUsed(r.data.used);
    setMsgs([...next, { role: "assistant", content: r.data.reply }]);
  };

  return (
    <section id="testar" className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-medium flex items-center gap-2"><FlaskConical className="w-4 h-4" /> Testar o agente</p>
          <p className="text-xs text-muted-foreground">Escreva como se fosse o cliente. Usa o texto acima (mesmo sem salvar) e tudo o que o agente sabe da empresa. Nada é enviado a clientes.</p>
        </div>
        {msgs.length > 0 && <Button size="sm" variant="ghost" onClick={() => { setMsgs([]); setErr(null); setUsed(null); }}><RotateCcw className="w-4 h-4 mr-1" /> Recomeçar</Button>}
      </div>

      <div className="rounded-lg bg-muted/40 p-3 h-72 overflow-y-auto space-y-2">
        {!msgs.length && (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <span>Experimente uma destas:</span>
            <div className="flex flex-wrap justify-center gap-1.5">
              {EXAMPLES.map((e) => <Button key={e} size="sm" variant="outline" disabled={disabled} onClick={() => void send(e)}>{e}</Button>)}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-background border rounded-bl-sm"}`}>{m.content}</div>
          </div>
        ))}
        {busy && <div className="text-xs text-muted-foreground">O agente está escrevendo…</div>}
        <div ref={end} />
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}
      {used && (
        <p className="text-xs text-muted-foreground">
          Nesta resposta: {used.empresa ? "✓ usou os dados da empresa, marca e regras" : "⚠ sem dados da empresa (faça o Diagnóstico)"} · {used.base ? "✓ consultou a base de conhecimento" : "nada relevante na base de conhecimento"}
        </p>
      )}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <Input value={text} maxLength={1500} disabled={disabled || busy} placeholder={disabled ? "Cadastre a chave da IA para testar" : "Mensagem do cliente…"} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" disabled={disabled || busy || !text.trim()}><Send className="w-4 h-4" /></Button>
      </form>
    </section>
  );
}
