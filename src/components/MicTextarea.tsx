import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Mic, Square } from "lucide-react";
import { callFunction } from "@/lib/callFunction";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";

type Props = Omit<ComponentProps<typeof Textarea>, "value" | "onChange"> & {
  value: string;
  onChange: (v: string) => void;
  orgId: string;
};

const toBase64 = (b: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1] ?? "");
  r.onerror = rej;
  r.readAsDataURL(b);
});

/**
 * Caixa de texto com microfone: a pessoa pode escrever ou clicar em "Falar" e o que ela
 * fala entra no fim do texto (ao vivo no Chrome/Edge; nos outros, grava e transcreve).
 * Padrão do produto: em qualquer caixa grande, falar é tão fácil quanto escrever.
 */
export function MicTextarea({ value, onChange, orgId, className, ...props }: Props) {
  const { toast } = useToast();
  const [on, setOn] = useState(false);
  const [secs, setSecs] = useState(0);
  const [busy, setBusy] = useState(false);
  const live = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const speech = useRef<any>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    if (!on) return;
    setSecs(0);
    const t = window.setInterval(() => setSecs((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [on]);
  useEffect(() => () => { live.current = false; speech.current?.stop(); recorder.current?.stop(); }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SR: any = typeof window !== "undefined" ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : null;

  const stop = () => {
    live.current = false;
    speech.current?.stop();
    if (recorder.current?.state === "recording") recorder.current.stop();
    setOn(false);
  };
  const start = async () => {
    const base = valueRef.current.trim() ? `${valueRef.current.trim()} ` : "";
    if (SR) {
      let finals = "";
      const sr = new SR();
      sr.lang = "pt-BR"; sr.continuous = true; sr.interimResults = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sr.onresult = (e: any) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finals += `${t.trim()} `; else interim += t;
        }
        onChange(`${base}${finals}${interim}`.replace(/\s+$/, interim ? "" : " "));
      };
      // O navegador para depois de um silêncio: continua até a pessoa clicar em Parar.
      sr.onend = () => { if (live.current) { try { sr.start(); } catch { /* reiniciando */ } } };
      sr.onerror = (e: { error?: string }) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          stop();
          toast({ variant: "destructive", title: "Microfone bloqueado", description: "Permita o microfone no navegador para falar." });
        }
      };
      speech.current = sr;
      live.current = true;
      sr.start();
      setOn(true);
      return;
    }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { return toast({ variant: "destructive", title: "Microfone bloqueado", description: "Permita o microfone no navegador para falar." }); }
    const mr = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: mr.mimeType });
      if (blob.size < 2000) return;
      setBusy(true);
      const r = await callFunction<{ text: string }>("interviewer", { action: "transcribe", organization_id: orgId, audio: await toBase64(blob), mime: blob.type });
      setBusy(false);
      if (!r.ok) return toast({ variant: "destructive", title: r.message });
      const cur = valueRef.current.trim();
      onChange(cur ? `${cur} ${r.data.text}` : r.data.text);
    };
    recorder.current = mr;
    mr.start();
    setOn(true);
  };

  return (
    <div className="relative">
      <Textarea {...props} className={`pb-9 ${className ?? ""}`} value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" disabled={busy} onClick={() => (on ? stop() : void start())}
        title={on ? "Parar" : "Falar: o que você falar entra no fim do texto"}
        className={`absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium shadow-sm ${
          on ? "bg-danger text-white border-danger" : "bg-background hover:bg-muted"}`}>
        {on ? <><Square className="h-3.5 w-3.5" /> Parar {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</>
          : busy ? "Transcrevendo..." : <><Mic className="h-3.5 w-3.5" /> Falar</>}
      </button>
    </div>
  );
}
