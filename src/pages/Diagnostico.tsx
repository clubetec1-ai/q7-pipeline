import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { LogOut, RotateCcw, Send, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { Logo } from "@/components/Logo";
import { MainNav } from "@/components/MainNav";
import { NumberHealthBanner } from "@/components/NumberHealthBanner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/** Mesmas seções do servidor (_shared/company.ts); públicas podem ir para a IA de atendimento. */
const SECTIONS: [string, string, boolean][] = [
  ["empresa", "Sobre a empresa", true], ["atendimento", "Atendimento (canais, horários, prazos)", true],
  ["produtos", "Produtos, serviços e preços", true], ["politicas", "Políticas (troca, cancelamento, pagamento, garantia)", true],
  ["faq", "Perguntas frequentes", true], ["areas", "Áreas, pessoas e responsáveis", false],
  ["sistemas", "Sistemas usados", false], ["metas", "Volumes, metas e maiores dores", false],
];
interface Msg { id: number; role: "assistant" | "user"; content: string }

/** Negrito "**texto**" da IA vira <b> (sem HTML: só texto e <b>). */
const rich = (t: string) => t.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));
interface Suggestion {
  titulo: string; area: string; tipo: "pronta" | "integracao"; impacto: string; esforco: string;
  descricao: string; modelo: string | null; sistema: string | null; passos: string[];
}
interface Profile { sections: Record<string, string>; processes: Record<string, string>[]; suggestions: Suggestion[]; use_in_ai: boolean }

/** Agente entrevistador: levantamento da empresa e sugestões de automação (dono/admin). */
export default function Diagnostico() {
  const { signOut } = useAuth();
  const { org, can } = useOrg();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState<Profile>({ sections: {}, processes: [], suggestions: [], use_in_ai: true });
  const [dirty, setDirty] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!org) return;
    const [m, p] = await Promise.all([
      supabase.from("interview_messages").select("id, role, content").eq("organization_id", org.id).order("id"),
      supabase.from("company_profiles").select("sections, processes, suggestions, use_in_ai").eq("organization_id", org.id).maybeSingle(),
    ]);
    setMsgs((m.data as Msg[]) ?? []);
    if (p.data) setProfile(p.data as unknown as Profile);
    setDirty(false);
  }, [org]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs]);

  if (!org) return null;
  if (!can("org.settings")) return <Navigate to="/" replace />;

  const ask = async (t: string) => {
    setBusy(true);
    if (t) setMsgs((ms) => [...ms, { id: Date.now(), role: "user", content: t }]);
    setText("");
    const r = await callFunction<{ reply: string; saved: number }>("interviewer", { action: "message", organization_id: org.id, text: t });
    setBusy(false);
    if (!r.ok) return toast({ variant: "destructive", title: r.message });
    if (r.data.saved) toast({ title: "Retrato atualizado", description: "O entrevistador anotou o que você contou." });
    void load();
  };

  const suggest = async () => {
    setSuggesting(true);
    const r = await callFunction<{ suggestions: Suggestion[] }>("interviewer", { action: "suggest", organization_id: org.id });
    setSuggesting(false);
    if (!r.ok) return toast({ variant: "destructive", title: r.message });
    setProfile((p) => ({ ...p, suggestions: r.data.suggestions }));
  };

  const saveProfile = async () => {
    const { error } = await supabase.from("company_profiles").upsert({
      organization_id: org.id, sections: profile.sections as never, processes: profile.processes as never, use_in_ai: profile.use_in_ai,
    }, { onConflict: "organization_id" });
    if (error) return toast({ variant: "destructive", title: "Não salvo", description: error.message });
    setDirty(false);
    toast({ title: "Retrato salvo" });
  };

  const restart = async () => {
    if (!window.confirm("Apagar a conversa e recomeçar? O retrato da empresa é mantido.")) return;
    await supabase.from("interview_messages").delete().eq("organization_id", org.id);
    void load();
  };

  const filled = SECTIONS.filter(([k]) => profile.sections?.[k]?.trim()).length;
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b px-4 h-14 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Logo horizontal width={26} height={26} />
          <MainNav active="diagnostico" />
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" size="icon" title="Sair" onClick={async () => { await signOut(); navigate("/login"); }}><LogOut className="w-4 h-4" /></Button>
        </div>
      </header>
      <NumberHealthBanner />

      <main className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-6 grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col rounded-lg border min-h-[70vh]">
          <div className="p-3 border-b flex items-center justify-between">
            <div>
              <p className="font-semibold">Entrevista</p>
              <p className="text-xs text-muted-foreground">Conte como a sua empresa funciona. O assistente anota tudo no retrato ao lado.</p>
            </div>
            {msgs.length > 0 && <Button variant="ghost" size="icon" title="Recomeçar conversa" onClick={restart}><RotateCcw className="w-4 h-4" /></Button>}
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {msgs.length === 0 && (
              <div className="text-center py-10 space-y-3">
                <p className="text-sm text-muted-foreground">Leva de 10 a 20 minutos. Dá para parar e continuar depois.</p>
                <Button onClick={() => ask("")} disabled={busy}><Sparkles className="w-4 h-4 mr-1" /> Começar entrevista</Button>
              </div>
            )}
            {msgs.map((m) => (
              <div key={m.id} className={m.role === "user" ? "text-right" : ""}>
                <span className={`inline-block max-w-[90%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap text-left ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  {m.role === "assistant" ? rich(m.content) : m.content}
                </span>
              </div>
            ))}
            {busy && <p className="text-xs text-muted-foreground">Pensando…</p>}
            <div ref={end} />
          </div>
          {msgs.length > 0 && (
            <div className="p-3 border-t flex gap-2">
              <Input value={text} placeholder="Sua resposta" maxLength={4000} disabled={busy}
                onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && ask(text.trim())} />
              <Button size="icon" disabled={busy || !text.trim()} onClick={() => ask(text.trim())} title="Enviar"><Send className="w-4 h-4" /></Button>
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold">Retrato da empresa <span className="text-xs text-muted-foreground font-normal">({filled}/{SECTIONS.length} seções)</span></p>
              <Button size="sm" disabled={!dirty} onClick={saveProfile}>Salvar</Button>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Switch checked={profile.use_in_ai} onCheckedChange={(v) => { setProfile({ ...profile, use_in_ai: v }); setDirty(true); }} />
              <span>A IA de atendimento usa as seções públicas (🌐) para responder clientes. Áreas, sistemas, metas e processos são internos e nunca vão para clientes.</span>
            </label>
            {SECTIONS.map(([k, label, pub]) => (
              <div key={k} className="space-y-1">
                <p className="text-xs font-medium">{pub ? "🌐 " : "🔒 "}{label}</p>
                <Textarea rows={3} maxLength={8000} value={profile.sections?.[k] ?? ""} placeholder="O entrevistador preenche; você pode ajustar."
                  onChange={(e) => { setProfile({ ...profile, sections: { ...profile.sections, [k]: e.target.value } }); setDirty(true); }} />
              </div>
            ))}
            {profile.processes.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium">🔒 Processos repetidos</p>
                {profile.processes.map((p, i) => (
                  <div key={i} className="text-xs rounded border p-2">
                    <b>{p.nome}</b>{p.area ? ` · ${p.area}` : ""}{p.quem_faz ? ` · ${p.quem_faz}` : ""}{p.frequencia ? ` · ${p.frequencia}` : ""}
                    {p.tempo ? ` · ${p.tempo}` : ""}{p.dificuldade ? <div className="text-muted-foreground">Onde trava: {p.dificuldade}</div> : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold">Sugestões de automação</p>
              <Button size="sm" variant="outline" disabled={suggesting || filled === 0} onClick={suggest}>
                <Sparkles className="w-4 h-4 mr-1" /> {suggesting ? "Gerando..." : profile.suggestions.length ? "Gerar de novo" : "Gerar sugestões"}
              </Button>
            </div>
            {profile.suggestions.length === 0 && <p className="text-sm text-muted-foreground">Faça a entrevista e clique em “Gerar sugestões”.</p>}
            {profile.suggestions.map((s, i) => (
              <div key={i} className="rounded-md border p-3 space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s.titulo}</span>
                  {s.tipo === "pronta" ? <Badge variant="secondary">Pronta no CRM</Badge> : <Badge variant="outline">Precisa de integração{s.sistema ? `: ${s.sistema}` : ""}</Badge>}
                  <Badge variant="outline">Impacto {s.impacto}</Badge>
                  <Badge variant="outline">Esforço {s.esforco}</Badge>
                  {s.area && <span className="text-xs text-muted-foreground">{s.area}</span>}
                </div>
                <p className="text-muted-foreground">{s.descricao}</p>
                {s.tipo === "pronta" && (
                  <p className="text-xs text-muted-foreground">Instalação com um clique chega com o agente implementador. Enquanto isso, dá para montar em Fluxos.</p>
                )}
                {s.passos.length > 0 && (
                  <ol className="list-decimal pl-5 text-xs space-y-0.5">{s.passos.map((p, j) => <li key={j}>{p}</li>)}</ol>
                )}
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
