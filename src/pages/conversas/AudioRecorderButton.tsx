import { useEffect, useRef, useState } from "react";
import { Mic, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Formatos que o WhatsApp aceita, na ordem de preferência (o Chrome antigo só grava WebM, que o WhatsApp recusa). */
const FORMATS: [string, string][] = [["audio/ogg;codecs=opus", "ogg"], ["audio/mp4;codecs=mp4a.40.2", "m4a"], ["audio/mp4", "m4a"]];
const pick = () => (typeof MediaRecorder === "undefined" ? null : FORMATS.find(([m]) => MediaRecorder.isTypeSupported(m)) ?? null);
const MAX_SECS = 300;

/**
 * Gravar áudio pelo navegador (Etapa B, item 6): o atendente grava e o áudio entra como arquivo pendente — ele ouve o
 * nome, pode cancelar e envia pelo botão de sempre. Some quando o navegador não grava num formato aceito pelo WhatsApp.
 */
export function AudioRecorderButton({ disabled, onRecorded }: { disabled?: boolean; onRecorded: (f: File) => void }) {
  const [fmt] = useState(pick);
  const [secs, setSecs] = useState<number | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const cancel = useRef(false);
  useEffect(() => () => { cancel.current = true; rec.current?.state === "recording" && rec.current.stop(); }, []);
  useEffect(() => {
    if (secs === null) return;
    if (secs >= MAX_SECS) { rec.current?.stop(); return; }
    const t = window.setTimeout(() => setSecs((s) => (s === null ? null : s + 1)), 1000);
    return () => window.clearTimeout(t);
  }, [secs]);
  if (!fmt) return null;

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: fmt[0] });
      const chunks: Blob[] = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setSecs(null);
        if (cancel.current || !chunks.length) { cancel.current = false; return; }
        const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
        onRecorded(new File(chunks, `audio-${stamp}.${fmt[1]}`, { type: fmt[0].split(";")[0] }));
      };
      rec.current = mr;
      cancel.current = false;
      mr.start();
      setSecs(0);
    } catch {
      window.alert("Não consegui usar o microfone. Libere o acesso ao microfone no navegador e tente de novo.");
    }
  };

  if (secs !== null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-600">
        <Mic className="w-4 h-4 animate-pulse" /> {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" title="Parar e anexar" onClick={() => rec.current?.stop()}><Square className="w-4 h-4" /></Button>
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" title="Descartar" onClick={() => { cancel.current = true; rec.current?.stop(); }}><X className="w-4 h-4" /></Button>
      </span>
    );
  }
  return (
    <Button type="button" size="icon" variant="ghost" disabled={disabled} title="Gravar áudio (até 5 minutos)" onClick={() => void start()}>
      <Mic className="w-4 h-4" />
    </Button>
  );
}
