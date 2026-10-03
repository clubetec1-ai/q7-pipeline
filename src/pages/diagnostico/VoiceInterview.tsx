import { useEffect, useRef, useState } from "react";
import { Mic, MicVocal, Square, X } from "lucide-react";
import { callFunction } from "@/lib/callFunction";
import { Button } from "@/components/ui/button";

type Phase = "pensando" | "falando" | "ouvindo" | "transcrevendo" | "fim";
interface QA { q: string; a: string }

const toBase64 = (b: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1] ?? "");
  r.onerror = rej;
  r.readAsDataURL(b);
});

/**
 * Entrevista por voz: a IA faz uma pergunta por vez (falando), o dono responde
 * falando, a resposta vira texto e a IA decide a próxima pergunta. No fim, perguntas
 * e respostas entram na caixa da etapa para o dono conferir e clicar em "Organizar com IA".
 * Nada de áudio fica guardado.
 */
export function VoiceInterview({ orgId, step, setor, onDone }: {
  orgId: string; step: string; setor?: string | null; onDone: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("pensando");
  const [qa, setQa] = useState<QA[]>([]);
  const [question, setQuestion] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [secs, setSecs] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const alive = useRef(false);
  // A gravação termina num callback antigo: perguntas e respostas ficam em refs para não perder o estado.
  const qaRef = useRef<QA[]>([]);
  const qRef = useRef("");

  useEffect(() => () => { alive.current = false; stopAll(); }, []);
  useEffect(() => {
    if (phase !== "ouvindo") return;
    setSecs(0);
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const stopAll = () => {
    audio.current?.pause();
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    if (rec.current?.state === "recording") rec.current.stop();
    rec.current?.stream.getTracks().forEach((t) => t.stop());
  };

  // Fala a pergunta: voz natural do servidor (OpenAI) ou a voz do navegador.
  const speak = async (text: string) => {
    const r = await callFunction<{ audio: string | null; mime?: string }>("interviewer", { action: "speak", organization_id: orgId, text });
    if (!alive.current) return;
    if (r.ok && r.data.audio) {
      await new Promise<void>((done) => {
        const a = new Audio(`data:${r.data.mime ?? "audio/mpeg"};base64,${r.data.audio}`);
        audio.current = a;
        a.onended = () => done(); a.onerror = () => done();
        void a.play().catch(() => done());
      });
    } else if (window.speechSynthesis) {
      await new Promise<void>((done) => {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "pt-BR"; u.rate = 1.02; u.onend = () => done(); u.onerror = () => done();
        window.speechSynthesis.speak(u);
      });
    }
  };

  const listen = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mr.onstop = () => { stream.getTracks().forEach((t) => t.stop()); void answer(new Blob(chunks, { type: mr.mimeType })); };
      rec.current = mr;
      mr.start();
      setPhase("ouvindo");
    } catch {
      setErr("Não consegui usar o microfone. Libere o acesso ao microfone no navegador e tente de novo.");
    }
  };

  const ask = async (history: QA[]) => {
    setPhase("pensando"); setErr(null);
    const r = await callFunction<{ question: string; done: boolean }>("interviewer", {
      action: "voice_turn", organization_id: orgId, step, setor: setor ?? undefined, qa: history,
    });
    if (!alive.current) return;
    if (!r.ok) { setErr(r.message); return; }
    qRef.current = r.data.question;
    setQuestion(r.data.question);
    setPhase("falando");
    await speak(r.data.question);
    if (!alive.current) return;
    if (r.data.done) { finish(history); return; }
    await listen();
  };

  const answer = async (blob: Blob) => {
    if (!alive.current) return;
    if (blob.size < 2000) { setErr("Não ouvi nada. Clique em Responder de novo e fale perto do microfone."); setPhase("ouvindo"); return void listen(); }
    setPhase("transcrevendo");
    const r = await callFunction<{ text: string }>("interviewer", {
      action: "transcribe", organization_id: orgId, audio: await toBase64(blob), mime: blob.type,
    });
    if (!alive.current) return;
    if (!r.ok || !r.data.text?.trim()) { setErr(r.ok ? "Não entendi. Vamos de novo?" : r.message); return void listen(); }
    const next = [...qaRef.current, { q: qRef.current, a: r.data.text.trim() }];
    qaRef.current = next;
    setQa(next);
    await ask(next);
  };

  const finish = (history = qaRef.current) => {
    stopAll();
    setPhase("fim");
    if (history.length) onDone(history.map((x) => `${x.q}\n${x.a}`).join("\n\n"));
  };

  const start = () => {
    alive.current = true; qaRef.current = []; qRef.current = "";
    setOpen(true); setQa([]); setQuestion(""); void ask([]);
  };
  const close = () => { alive.current = false; stopAll(); setOpen(false); };

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={start} title="A IA pergunta falando e você responde falando, como numa entrevista">
        <MicVocal className="w-4 h-4 mr-1" /> Entrevista por voz
      </Button>
    );
  }

  return (
    <div className="w-full rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium flex items-center gap-2"><MicVocal className="w-4 h-4" /> Entrevista por voz</p>
        <Button type="button" variant="ghost" size="sm" onClick={close} title="Fechar"><X className="w-4 h-4" /></Button>
      </div>
      {question && (
        <p className="text-sm rounded-md bg-background border p-3">
          <span className="text-xs text-muted-foreground block mb-1">Pergunta {qa.length + (phase === "fim" ? 0 : 1)}</span>{question}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {phase === "pensando" && <span className="text-muted-foreground">Pensando na próxima pergunta…</span>}
        {phase === "falando" && <span className="text-muted-foreground">A IA está perguntando…</span>}
        {phase === "transcrevendo" && <span className="text-muted-foreground">Entendendo sua resposta…</span>}
        {phase === "ouvindo" && (
          <>
            <span className="inline-flex items-center gap-1 text-red-600"><Mic className="w-4 h-4 animate-pulse" /> Ouvindo… {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>
            <Button type="button" size="sm" onClick={() => rec.current?.stop()}><Square className="w-4 h-4 mr-1" /> Terminei de responder</Button>
          </>
        )}
        {phase === "fim" && <span className="text-emerald-700 dark:text-emerald-400">Pronto! As respostas foram para a caixa acima. Confira e clique em “Organizar com IA”.</span>}
        {phase !== "fim" && qa.length > 0 && (
          <Button type="button" size="sm" variant="outline" onClick={() => finish()}>Encerrar e usar as respostas</Button>
        )}
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      {qa.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Respostas até agora ({qa.length})</summary>
          <ol className="mt-2 space-y-2 list-decimal pl-5">{qa.map((x, i) => <li key={i}><b>{x.q}</b><br />{x.a}</li>)}</ol>
        </details>
      )}
      <p className="text-xs text-muted-foreground">Fale à vontade, como numa conversa. O áudio não fica guardado: só o texto das respostas, que você confere antes de aprovar.</p>
    </div>
  );
}
