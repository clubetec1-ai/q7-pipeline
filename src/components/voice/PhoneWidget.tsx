import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { setPhoneState as publishPhone } from "@/lib/phoneBus";
import { useNavigate } from "react-router-dom";
import { MessageSquare, Mic, MicOff, Pause, Phone, PhoneCall, PhoneIncoming, PhoneOff, Play, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CallState, PhoneState, Softphone } from "@/lib/softphone";

interface MyExt { id: string; number: string; sip_user: string; sip_domain: string; wss_url: string | null; mode: "webrtc" | "sip" | "off"; has_password: boolean; password: string | null; click_to_call?: boolean }
interface Caller { contact_id: string; name: string | null; phone: string; conversation_id: string | null; channel: string | null }
type CallInfo = { direction: "in" | "out"; number: string; name?: string } | null;

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Toque simples (sem arquivo de áudio): dois bipes a cada 2 s enquanto toca. */
function useRingtone() {
  const timer = useRef<number>();
  const stop = useCallback(() => { window.clearInterval(timer.current); timer.current = undefined; }, []);
  const start = useCallback(() => {
    stop();
    const beep = () => {
      try {
        const ctx = new AudioContext();
        [0, 0.35].forEach((t) => {
          const o = ctx.createOscillator(); const g = ctx.createGain();
          o.frequency.value = 480; g.gain.value = 0.08;
          o.connect(g).connect(ctx.destination);
          o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.25);
        });
        window.setTimeout(() => void ctx.close(), 1000);
      } catch { /* sem áudio */ }
    };
    beep();
    timer.current = window.setInterval(beep, 2000);
  }, [stop]);
  return useMemo(() => ({ start, stop }), [start, stop]);
}

/**
 * Telefone do ramal (botão flutuante em todas as telas). WebRTC: liga/atende no
 * navegador. MicroSIP/aparelho: disca pelo link sip: e identifica quem liga pelo
 * número digitado. Nos dois: abre a conversa do cliente e manda um "olá" no WhatsApp.
 */
export function PhoneWidget() {
  const { user } = useAuth();
  const { org, hasModule } = useOrg();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [ext, setExt] = useState<MyExt | null>(null);
  const [open, setOpen] = useState(false);
  const [phoneState, setPhoneState] = useState<PhoneState>("off");
  const [phoneMsg, setPhoneMsg] = useState<string>();
  const [callState, setCallState] = useState<CallState>("idle");
  const [call, setCall] = useState<CallInfo>(null);
  const [dial, setDial] = useState("");
  const [secs, setSecs] = useState(0);
  const [muted, setMuted] = useState(false);
  const [held, setHeld] = useState(false);
  const [callers, setCallers] = useState<Caller[] | null>(null);
  const [busy, setBusy] = useState(false);
  const phone = useRef<Softphone | null>(null);
  const callId = useRef<string | null>(null);
  const answeredAt = useRef<string | null>(null);
  const ring = useRingtone();
  const orgId = org?.id;

  const loadExt = useCallback(async () => {
    if (!orgId || !user) { setExt(null); return; }
    const { data } = await supabase.rpc("my_extension", { org: orgId });
    setExt((data as unknown as MyExt | null) ?? null);
  }, [orgId, user]);
  useEffect(() => { void loadExt(); }, [loadExt]);

  const identify = useCallback(async (num: string) => {
    if (!orgId || num.replace(/\D/g, "").length < 8) { setCallers(null); return; }
    const { data } = await supabase.rpc("lookup_caller", { org: orgId, p_phone: num });
    setCallers((data as Caller[] | null) ?? []);
  }, [orgId]);

  // Em fila: a atualização (atendeu/desligou) sempre depois do registro inicial.
  const logQueue = useRef<Promise<void>>(Promise.resolve());
  const log = useCallback((args: { direction?: "in" | "out"; number?: string; status: string; source: "webrtc" | "sip"; ended?: boolean }) => {
    if (!orgId) return Promise.resolve();
    const now = new Date().toISOString();
    const answered = args.status === "answered" ? now : answeredAt.current;
    logQueue.current = logQueue.current.then(async () => {
      const { data, error } = await supabase.rpc("log_call", {
        // com direção = ligação nova; sem = atualiza a última
        org: orgId, call: (args.direction ? null : callId.current) as string,
        p_direction: args.direction ?? "in", p_phone: args.number ?? "00",
        p_status: args.status, p_source: args.source,
        p_answered_at: answered as string, p_ended_at: (args.ended ? now : null) as string,
      });
      if (!error && data) callId.current = data as string;
    });
    return logQueue.current;
  }, [orgId]);

  // WebRTC: liga o telefone quando o ramal está pronto; desliga ao sair/trocar.
  useEffect(() => {
    if (!ext || ext.mode !== "webrtc" || !ext.wss_url || !ext.password) return;
    let alive = true;
    let sp: Softphone | null = null;
    // Status para a Clubetec/dono (online/erro), com sinal a cada 2 min enquanto registrado.
    let current: PhoneState = "off";
    const report = (state: "online" | "offline" | "error", detail?: string) =>
      void supabase.rpc("report_extension_status", { ext: ext.id, p_state: state, p_detail: (detail ?? null) as string });
    const beat = window.setInterval(() => { if (current === "ready") report("online"); }, 120_000);
    void import("@/lib/softphone").then(({ Softphone: SP }) => {
      if (!alive) return;
      sp = new SP({ wss: ext.wss_url!, domain: ext.sip_domain, user: ext.sip_user, password: ext.password! }, {
        onPhone: (s, d) => {
          setPhoneState(s); setPhoneMsg(d);
          if (s !== current) { if (s === "ready") report("online"); if (s === "error") report("error", d); }
          current = s;
        },
        onCall: (s, info) => {
          setCallState(s);
          if (s === "ringing" || s === "calling") {
            setCall(info); setSecs(0); setMuted(false); setHeld(false); setOpen(true);
            answeredAt.current = null;
            if (s === "ringing") ring.start();
            void identify(info?.number ?? "");
            void log({ direction: info?.direction, number: info?.number, status: "ringing", source: "webrtc" });
          } else if (s === "active") {
            ring.stop();
            answeredAt.current = new Date().toISOString();
            void log({ status: "answered", source: "webrtc" });
          } else if (s === "idle") {
            ring.stop();
            const status = answeredAt.current ? "ended" : info?.direction === "in" ? "missed" : "failed";
            void log({ status, source: "webrtc", ended: true });
            setCall(null);
          }
        },
      });
      phone.current = sp;
      void sp.start();
    });
    return () => {
      alive = false; window.clearInterval(beat); ring.stop(); void sp?.stop(); phone.current = null; setPhoneState("off");
      if (current === "ready") report("offline");
    };
  }, [ext, identify, log, ring]);

  // Cronômetro da ligação.
  useEffect(() => {
    if (callState !== "active") return;
    const t = window.setInterval(() => setSecs((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [callState]);

  const dialOut = useCallback(async (num: string) => {
    const digits = num.replace(/[^\d*#+]/g, "");
    if (!digits || !ext) return;
    setDial(digits);
    if (ext.mode === "webrtc" && phone.current && phoneState === "ready") {
      try { await phone.current.call(digits); } catch (e) { toast({ variant: "destructive", title: "Não ligou", description: String((e as Error).message) }); }
      return;
    }
    answeredAt.current = null;
    setCall({ direction: "out", number: digits });
    void identify(digits);
    // Central com API (Nvoip): toca o MicroSIP do atendente e depois o cliente.
    if (ext.click_to_call && orgId) {
      const r = await callFunction<{ call_id: string | null }>("voice", { action: "click_to_call", org_id: orgId, phone: digits });
      if (r.ok) {
        if (r.data.call_id) callId.current = r.data.call_id;
        toast({ title: "Atenda o MicroSIP", description: "Seu ramal vai tocar; ao atender, a central liga para o cliente." });
        return;
      }
      toast({ variant: "destructive", title: "A central não ligou", description: `${r.message} — abrindo o MicroSIP.` });
    }
    // MicroSIP/aparelho: o link sip: abre o programa padrão já discando.
    window.location.href = `sip:${digits}@${ext.sip_domain}`;
    void log({ direction: "out", number: digits, status: "ended", source: "sip" });
  }, [ext, orgId, phoneState, identify, log, toast]);

  // Botão "Ligar" da ficha/conversa.
  useEffect(() => {
    if (!ext || ext.mode === "off") return;
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ phone: string; handled: boolean }>).detail;
      d.handled = true;
      setOpen(true);
      void dialOut(d.phone);
    };
    window.addEventListener("clubecrm:call", h);
    return () => window.removeEventListener("clubecrm:call", h);
  }, [ext, dialOut]);

  const setMode = async (mode: MyExt["mode"]) => {
    if (!ext) return;
    const { error } = await supabase.rpc("set_extension_mode", { ext: ext.id, p_mode: mode });
    if (error) toast({ variant: "destructive", title: "Não mudou", description: error.message });
    void loadExt();
  };

  const registerIncomingSip = async () => {
    const digits = dial.replace(/\D/g, "");
    if (digits.length < 8) return;
    answeredAt.current = null;
    setCall({ direction: "in", number: digits });
    await log({ direction: "in", number: digits, status: "answered", source: "sip" });
    toast({ title: "Ligação registrada no histórico" });
  };

  const hello = async (num: string) => {
    if (!orgId) return;
    setBusy(true);
    const r = await callFunction<{ conversation_id: string | null }>("voice", { action: "whatsapp_hello", org_id: orgId, phone: num, call_id: callId.current });
    setBusy(false);
    if (!r.ok) { toast({ variant: "destructive", title: "Não enviou", description: r.message }); return; }
    toast({ title: "Olá enviado no WhatsApp", description: "O atendimento continua por lá." });
    if (r.data.conversation_id) navigate(`/?open=${r.data.conversation_id}`);
  };

  const usable = !!ext && hasModule("telefonia");
  const dot = !ext ? "" : ext.mode === "off" ? "bg-muted-foreground" : ext.mode === "sip" ? "bg-sky-500"
    : phoneState === "ready" ? "bg-emerald-500" : phoneState === "error" ? "bg-red-500" : "bg-amber-400";
  const status = !ext ? "" : ext.mode === "off" ? "Ramal desligado" : ext.mode === "sip" ? "MicroSIP / aparelho"
    : !ext.wss_url ? "Ramal sem WebRTC (use MicroSIP)" : !ext.password ? "Aguardando senha da Clubetec"
    : phoneState === "ready" ? "Pronto para ligar" : phoneState === "error" ? phoneMsg || "Sem conexão com a central" : "Conectando…";
  // O botão 📞 fica no cabeçalho: publica a situação e atende o pedido de abrir/fechar.
  useEffect(() => { publishPhone({ available: usable, dot, status, ringing: callState === "ringing" }); }, [usable, dot, status, callState]);
  useEffect(() => {
    const t = () => setOpen((o) => !o);
    window.addEventListener("clubecrm:phone-toggle", t);
    return () => window.removeEventListener("clubecrm:phone-toggle", t);
  }, []);

  if (!ext || !usable) return null;
  const live = callState !== "idle";
  const numberNow = call?.number || dial;

  return (
    <div className="fixed top-16 right-4 z-50 flex flex-col items-end gap-2">
      {open && (
        <div className="w-80 max-w-[calc(100vw-2rem)] rounded-xl border bg-background shadow-xl p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium flex items-center gap-2"><span className={`w-2 h-2 rounded-full ${dot}`} /> Ramal {ext.number}</div>
            <button type="button" onClick={() => setOpen(false)} title="Fechar"><X className="w-4 h-4" /></button>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">{status}</p>

          {live && call && (
            <div className="rounded-lg bg-muted p-2 text-center space-y-1">
              <div className="text-xs text-muted-foreground">
                {callState === "ringing" ? "Recebendo ligação" : callState === "calling" ? "Chamando…" : `Em ligação · ${fmt(secs)}`}
              </div>
              <div className="font-semibold">{callers?.[0]?.name || call.name || call.number}</div>
              {(callers?.[0]?.name || call.name) && <div className="text-xs">{call.number}</div>}
              <div className="flex justify-center gap-2 pt-1">
                {callState === "ringing" && <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => phone.current?.answer()}><PhoneIncoming className="w-4 h-4 mr-1" /> Atender</Button>}
                {callState === "active" && <>
                  <Button size="icon" variant="outline" title={muted ? "Ligar microfone" : "Mudo"} onClick={() => setMuted(phone.current?.toggleMute() ?? false)}>{muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}</Button>
                  <Button size="icon" variant="outline" title={held ? "Retomar" : "Em espera"} onClick={async () => setHeld((await phone.current?.toggleHold()) ?? false)}>{held ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}</Button>
                </>}
                <Button size="sm" variant="destructive" onClick={() => phone.current?.hangup()}><PhoneOff className="w-4 h-4 mr-1" /> {callState === "ringing" ? "Recusar" : "Desligar"}</Button>
              </div>
            </div>
          )}

          {!live && ext.mode !== "off" && (
            <div className="space-y-2">
              <div className="flex gap-1">
                <Input value={dial} placeholder={ext.mode === "sip" ? "Número (ligar ou identificar)" : "Número"} inputMode="tel"
                  onChange={(e) => { setDial(e.target.value); setCallers(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") void dialOut(dial); }} />
                <Button size="icon" title="Ligar" onClick={() => dialOut(dial)} disabled={ext.mode === "webrtc" && phoneState !== "ready"}><PhoneCall className="w-4 h-4" /></Button>
              </div>
              {ext.mode === "sip" && (
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => identify(dial)}><Search className="w-4 h-4 mr-1" /> Quem está ligando?</Button>
                  <Button size="sm" variant="outline" onClick={registerIncomingSip} title="Registrar no histórico a ligação que você atendeu no aparelho">Registrar</Button>
                </div>
              )}
            </div>
          )}

          {callState === "active" && (
            <div className="grid grid-cols-6 gap-1">
              {KEYS.map((k) => <button key={k} type="button" className="rounded border py-1 text-sm hover:bg-muted" onClick={() => phone.current?.dtmf(k)}>{k}</button>)}
            </div>
          )}

          {callers && numberNow && (
            <div className="space-y-1">
              {callers.length === 0 && <p className="text-xs text-muted-foreground">Cliente não encontrado (ou é de outro setor).</p>}
              {callers.map((c) => (
                <div key={c.contact_id} className="flex items-center justify-between gap-2 rounded border p-2 text-sm">
                  <div className="min-w-0"><div className="truncate font-medium">{c.name || "Sem nome"}</div><div className="text-xs text-muted-foreground">{c.phone}</div></div>
                  {c.conversation_id && <Button size="sm" variant="ghost" onClick={() => navigate(`/?open=${c.conversation_id}`)}>Abrir</Button>}
                </div>
              ))}
              <Button size="sm" variant="outline" className="w-full" disabled={busy} onClick={() => hello(numberNow)}>
                <MessageSquare className="w-4 h-4 mr-1" /> {busy ? "Enviando…" : "Enviar olá no WhatsApp"}
              </Button>
            </div>
          )}

          <div className="flex gap-1 text-xs">
            {([["webrtc", "Navegador"], ["sip", "MicroSIP"], ["off", "Desligado"]] as const).map(([k, l]) => (
              <button key={k} type="button" disabled={live || (k === "webrtc" && !ext.wss_url)} onClick={() => setMode(k)}
                className={`flex-1 rounded border px-2 py-1 disabled:opacity-40 ${ext.mode === k ? "bg-muted font-medium" : ""}`}>{l}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
