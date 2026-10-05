import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicVocal, Play, Square, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { callFunction } from "@/lib/callFunction";
import { Button } from "@/components/ui/button";

type Phase = "pensando" | "falando" | "pronto" | "ouvindo" | "transcrevendo" | "fim";
const AUTO_KEY = "clubecrm:voz-auto";
const VOICE_KEY = "clubecrm:voz-entrevista";
const VOICES: [string, string][] = [
  ["nova", "Voz 1 (feminina)"], ["shimmer", "Voz 2 (feminina)"], ["coral", "Voz 3 (feminina)"],
  ["ash", "Voz 4 (masculina)"], ["verse", "Voz 5 (masculina)"], ["browser", "Voz do navegador"],
];
const read = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* preferência só deste navegador */ } };
interface QA { q: string; a: string }

const toBase64 = (b: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1] ?? "");
  r.onerror = rej;
  r.readAsDataURL(b);
});

/** Voz do navegador em português, sempre a mesma (prefere vozes femininas naturais). */
function browserVoice(): SpeechSynthesisVoice | null {
  const all = window.speechSynthesis?.getVoices?.() ?? [];
  const pt = all.filter((v) => v.lang?.toLowerCase().startsWith("pt-br") || v.lang?.toLowerCase() === "pt_br");
  const pref = ["francisca", "thalita", "luciana", "google português", "maria", "vitoria"];
  return pt.find((v) => pref.some((p) => v.name.toLowerCase().includes(p))) ?? pt[0] ?? null;
}

/**
 * Entrevista por voz: a IA faz uma pergunta por vez (falando), o dono responde
 * falando, a resposta vira texto e a IA decide a próxima pergunta. Cada resposta
 * é salva na hora (continua de onde parou se a página fechar). No fim, perguntas e
 * respostas entram na caixa da etapa para conferir e "Organizar com IA".
 * Nada de áudio fica guardado.
 */
export function VoiceInterview({ orgId, step, setor, onDone }: {
  orgId: string; step: string; setor?: string | null; onDone: (text: string) => void;
}) {
  const key = setor ? `proc:${setor}` : step;
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("pensando");
  const [qa, setQa] = useState<QA[]>([]);
  const [saved, setSaved] = useState<QA[]>([]);
  const [question, setQuestion] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [secs, setSecs] = useState(0);
  const [voice, setVoice] = useState(() => read(VOICE_KEY, "nova"));
  const voiceRef = useRef(voice);
  // Microfone abre sozinho depois da pergunta (ágil) ou só quando a pessoa clica em Responder (dá tempo de pensar).
  const [auto, setAuto] = useState(() => read(AUTO_KEY, "0") === "1");
  const autoRef = useRef(auto);
  const rec = useRef<MediaRecorder | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const lastAudio = useRef<string | null>(null);
  const alive = useRef(false);
  // A gravação termina num callback antigo: perguntas e respostas ficam em refs para não perder o estado.
  const qaRef = useRef<QA[]>([]);
  const qRef = useRef("");

  // Entrevista salva desta etapa (para continuar de onde parou).
  const loadSaved = useCallback(async () => {
    const { data } = await supabase.from("company_profiles").select("steps").eq("organization_id", orgId).maybeSingle();
    const v = ((data?.steps as Record<string, { voice?: { qa?: QA[] } }> | null)?.[key]?.voice?.qa) ?? [];
    setSaved(Array.isArray(v) ? v : []);
  }, [orgId, key]);
  useEffect(() => { void loadSaved(); }, [loadSaved]);

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
  const persist = (list: QA[]) => { void supabase.rpc("save_voice_progress", { org: orgId, p_key: key, p_qa: list as never }); };

  const playMp3 = (b64: string) => new Promise<void>((done) => {
    const a = new Audio(`data:audio/mpeg;base64,${b64}`);
    audio.current = a;
    a.onended = () => done(); a.onerror = () => done();
    void a.play().catch(() => done());
  });
  const playBrowser = (text: string) => new Promise<void>((done) => {
    if (!window.speechSynthesis) return done();
    const u = new SpeechSynthesisUtterance(text);
    const v = browserVoice();
    if (v) u.voice = v;
    u.lang = "pt-BR"; u.rate = 1; u.onend = () => done(); u.onerror = () => done();
    window.speechSynthesis.speak(u);
  });
  // Sempre a voz escolhida: se a voz natural falhar, mostra o texto (não troca para outra voz no meio).
  const sayQuestion = async (text: string, b64: string | null) => {
    if (voiceRef.current === "browser") return playBrowser(text);
    if (b64) { lastAudio.current = b64; return playMp3(b64); }
    setErr("Não consegui gerar a voz desta pergunta agora. Leia acima e responda normalmente.");
  };
  const sample = async (v: string) => {
    stopAll();
    if (v === "browser") return playBrowser("Olá! Vamos conversar sobre a sua empresa?");
    const r = await callFunction<{ audio: string | null }>("interviewer", { action: "speak", organization_id: orgId, voice: v, text: "Olá! Vamos conversar sobre a sua empresa?" });
    if (r.ok && r.data.audio) await playMp3(r.data.audio);
    else setErr("Não consegui tocar esta voz agora.");
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
    const r = await callFunction<{ question: string; done: boolean; audio: string | null }>("interviewer", {
      action: "voice_turn", organization_id: orgId, step, setor: setor ?? undefined, qa: history, voice: voiceRef.current,
    });
    if (!alive.current) return;
    if (!r.ok) { setErr(r.message); setPhase("pronto"); return; }
    qRef.current = r.data.question;
    lastAudio.current = null;
    // Texto e voz ao mesmo tempo.
    setQuestion(r.data.question);
    setPhase("falando");
    await sayQuestion(r.data.question, r.data.audio);
    if (!alive.current) return;
    if (r.data.done) { finish(history); return; }
    if (autoRef.current) await listen();
    else setPhase("pronto");
  };

  const answer = async (blob: Blob) => {
    if (!alive.current) return;
    if (blob.size < 2000) { setErr("Não ouvi nada. Clique em Responder e fale perto do microfone."); return setPhase("pronto"); }
    setPhase("transcrevendo");
    const r = await callFunction<{ text: string }>("interviewer", {
      action: "transcribe", organization_id: orgId, audio: await toBase64(blob), mime: blob.type,
    });
    if (!alive.current) return;
    if (!r.ok || !r.data.text?.trim()) {
      setErr(r.ok ? "Não entendi. Vamos de novo?" : r.message);
      if (autoRef.current) return void listen();
      return setPhase("pronto");
    }
    const next = [...qaRef.current, { q: qRef.current, a: r.data.text.trim() }];
    qaRef.current = next;
    setQa(next);
    persist(next); // salva cada resposta na hora
    await ask(next);
  };

  const finish = (history = qaRef.current) => {
    stopAll();
    setPhase("fim");
    if (history.length) onDone(history.map((x) => `${x.q}\n${x.a}`).join("\n\n"));
    void loadSaved();
  };

  const start = (resume: boolean) => {
    const base = resume ? saved : [];
    if (!resume && saved.length) persist([]); // começar de novo apaga a entrevista salva desta etapa
    alive.current = true; qaRef.current = base; qRef.current = "";
    setOpen(true); setQa(base); setQuestion(""); void ask(base);
  };
  const close = () => { alive.current = false; stopAll(); setOpen(false); void loadSaved(); };

  if (!open) {
    return saved.length ? (
      <span className="inline-flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => start(true)} title="Continua a entrevista desta etapa de onde parou">
          <MicVocal className="w-4 h-4 mr-1" /> Continuar entrevista ({saved.length} resposta{saved.length > 1 ? "s" : ""})
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onDone(saved.map((x) => `${x.q}\n${x.a}`).join("\n\n"))}>Usar respostas salvas</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => { if (window.confirm("Começar a entrevista desta etapa do zero? As respostas salvas são apagadas.")) start(false); }}>Começar de novo</Button>
      </span>
    ) : (
      <Button type="button" variant="outline" size="sm" onClick={() => start(false)} title="A IA pergunta falando e você responde falando, como numa entrevista">
        <MicVocal className="w-4 h-4 mr-1" /> Entrevista por voz
      </Button>
    );
  }

  return (
    <div className="w-full rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium flex items-center gap-2"><MicVocal className="w-4 h-4" /> Entrevista por voz</p>
        <Button type="button" variant="ghost" size="sm" onClick={close} title="Fechar (as respostas ficam salvas)"><X className="w-4 h-4" /></Button>
      </div>
      {question && (
        <p className="text-sm rounded-md bg-background border p-3">
          <span className="text-xs text-muted-foreground block mb-1">Pergunta {qa.length + (phase === "fim" ? 0 : 1)}</span>{question}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {phase === "pensando" && <span className="text-muted-foreground">Preparando a próxima pergunta…</span>}
        {phase === "falando" && <span className="text-muted-foreground">A IA está perguntando…</span>}
        {phase === "pronto" && (
          <>
            <span className="text-muted-foreground">Pense com calma. Quando estiver pronto:</span>
            <Button type="button" size="sm" onClick={() => { setErr(null); void listen(); }}><Mic className="w-4 h-4 mr-1" /> Responder</Button>
            {(lastAudio.current || voice === "browser") && (
              <Button type="button" size="sm" variant="ghost" onClick={() => void (voice === "browser" ? playBrowser(qRef.current) : playMp3(lastAudio.current!))}>Ouvir a pergunta de novo</Button>
            )}
          </>
        )}
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
          <summary className="cursor-pointer">Respostas até agora ({qa.length}) — salvas automaticamente</summary>
          <ol className="mt-2 space-y-2 list-decimal pl-5">{qa.map((x, i) => <li key={i}><b>{x.q}</b><br />{x.a}</li>)}</ol>
        </details>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span>Voz:</span>
        <select className="h-7 rounded-md border bg-background px-2 text-xs" value={voice} aria-label="Voz da entrevista"
          onChange={(e) => { setVoice(e.target.value); voiceRef.current = e.target.value; write(VOICE_KEY, e.target.value); }}>
          {VOICES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => void sample(voice)}><Play className="w-3.5 h-3.5 mr-1" /> Ouvir</Button>
        <span className="text-muted-foreground">(vale a partir da próxima pergunta)</span>
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); autoRef.current = e.target.checked; write(AUTO_KEY, e.target.checked ? "1" : "0"); }} />
        Abrir o microfone sozinho depois de cada pergunta (desligado: você clica em “Responder” quando estiver pronto)
      </label>
      <p className="text-xs text-muted-foreground">Fale à vontade, como numa conversa. Cada resposta é salva na hora: se a página fechar, é só clicar em “Continuar entrevista”. O áudio não fica guardado, só o texto.</p>
    </div>
  );
}
