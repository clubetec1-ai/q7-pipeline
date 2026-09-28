import {
  Invitation, Inviter, Registerer, RegistererState, SessionState, UserAgent, Web, type Session,
} from "sip.js";

/**
 * Telefone WebRTC (SIP sobre WSS) do ramal do atendente. Carregado só quando o
 * ramal está em WebRTC (import dinâmico), para não pesar para quem não usa.
 */
export interface SoftphoneConfig { wss: string; domain: string; user: string; password: string; displayName?: string }
export type PhoneState = "off" | "connecting" | "ready" | "error";
export type CallState = "idle" | "ringing" | "calling" | "active";
export interface PhoneEvents {
  onPhone(state: PhoneState, detail?: string): void;
  onCall(state: CallState, info: { direction: "in" | "out"; number: string; name?: string } | null): void;
}

export class Softphone {
  private ua: UserAgent;
  private registerer: Registerer;
  private session: Session | null = null;
  private audio: HTMLAudioElement;
  private held = false;
  private muted = false;

  constructor(private cfg: SoftphoneConfig, private ev: PhoneEvents) {
    this.audio = document.createElement("audio");
    this.audio.autoplay = true;
    const uri = UserAgent.makeURI(`sip:${cfg.user}@${cfg.domain}`);
    if (!uri) throw new Error("Ramal inválido");
    this.ua = new UserAgent({
      uri,
      transportOptions: { server: cfg.wss },
      authorizationUsername: cfg.user,
      authorizationPassword: cfg.password,
      displayName: cfg.displayName,
      logLevel: "error",
      sessionDescriptionHandlerFactoryOptions: { peerConnectionConfiguration: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] } },
      delegate: {
        onInvite: (inv) => this.incoming(inv),
        onDisconnect: (err) => { this.ev.onPhone("error", err ? "Conexão com a central caiu" : undefined); this.retry(); },
      },
    });
    this.registerer = new Registerer(this.ua, { expires: 300 });
    this.registerer.stateChange.addListener((s) => {
      if (s === RegistererState.Registered) this.ev.onPhone("ready");
      if (s === RegistererState.Unregistered) this.ev.onPhone("connecting");
    });
  }

  private stopped = false;
  private retryTimer: number | undefined;
  private retry() {
    if (this.stopped || this.retryTimer) return;
    this.retryTimer = window.setTimeout(() => { this.retryTimer = undefined; void this.start(); }, 10_000);
  }

  async start() {
    this.ev.onPhone("connecting");
    try {
      if (!this.ua.isConnected()) await this.ua.start().catch(() => this.ua.reconnect());
      await this.registerer.register({ requestDelegate: {
        onReject: (r) => this.ev.onPhone("error", r.message.statusCode === 401 || r.message.statusCode === 403
          ? "Usuário ou senha do ramal recusados pela central" : `Central recusou (${r.message.statusCode})`),
      } });
    } catch (e) {
      this.ev.onPhone("error", e instanceof Error ? e.message : "Não conectou à central");
      this.retry();
    }
  }

  async stop() {
    this.stopped = true;
    window.clearTimeout(this.retryTimer);
    try { await this.hangup(); } catch { /* sem ligação */ }
    try { await this.registerer.unregister(); } catch { /* já desregistrado */ }
    try { await this.ua.stop(); } catch { /* já parado */ }
    this.ev.onPhone("off");
  }

  private track(session: Session, info: { direction: "in" | "out"; number: string; name?: string }) {
    this.session = session;
    this.held = false; this.muted = false;
    session.stateChange.addListener((s) => {
      if (s === SessionState.Established) {
        const sdh = session.sessionDescriptionHandler as Web.SessionDescriptionHandler | undefined;
        if (sdh) { this.audio.srcObject = sdh.remoteMediaStream; void this.audio.play().catch(() => undefined); }
        this.ev.onCall("active", info);
      }
      if (s === SessionState.Terminated) {
        this.audio.srcObject = null;
        if (this.session === session) this.session = null;
        this.ev.onCall("idle", info);
      }
    });
  }

  private incoming(inv: Invitation) {
    if (this.session) { void inv.reject({ statusCode: 486 }); return; } // ocupado
    const info = { direction: "in" as const, number: inv.remoteIdentity.uri.user ?? "", name: inv.remoteIdentity.displayName || undefined };
    this.track(inv, info);
    this.ev.onCall("ringing", info);
  }

  async call(number: string) {
    const digits = number.replace(/[^\d*#+]/g, "");
    if (!digits || this.session) return;
    const target = UserAgent.makeURI(`sip:${digits}@${this.cfg.domain}`);
    if (!target) throw new Error("Número inválido");
    const inviter = new Inviter(this.ua, target, { sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } } });
    const info = { direction: "out" as const, number: digits };
    this.track(inviter, info);
    this.ev.onCall("calling", info);
    await inviter.invite();
  }

  async answer() {
    if (this.session instanceof Invitation && this.session.state === SessionState.Initial) {
      await this.session.accept({ sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } } });
    }
  }

  async hangup() {
    const s = this.session;
    if (!s) return;
    if (s.state === SessionState.Established) await s.bye();
    else if (s instanceof Invitation) await s.reject();
    else if (s instanceof Inviter) await s.cancel();
  }

  toggleMute() {
    const sdh = this.session?.sessionDescriptionHandler as Web.SessionDescriptionHandler | undefined;
    if (!sdh) return this.muted;
    this.muted = !this.muted;
    sdh.enableSenderTracks(!this.muted && !this.held);
    return this.muted;
  }

  async toggleHold() {
    const s = this.session;
    if (!s || s.state !== SessionState.Established) return this.held;
    const next = !this.held;
    s.sessionDescriptionHandlerOptionsReInvite = { hold: next } as Web.SessionDescriptionHandlerOptions;
    await s.invite({ requestDelegate: { onAccept: () => {
      this.held = next;
      (s.sessionDescriptionHandler as Web.SessionDescriptionHandler | undefined)?.enableSenderTracks(!next && !this.muted);
    } } });
    return next;
  }

  dtmf(tone: string) {
    const sdh = this.session?.sessionDescriptionHandler as Web.SessionDescriptionHandler | undefined;
    sdh?.sendDtmf(tone);
  }
}
