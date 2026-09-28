import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Check, Globe, LogOut, RotateCcw, Send, Sparkles, Target } from "lucide-react";
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
import { useInstall } from "./fluxos/ReadyTemplates";

/** Mesmas seções do servidor (_shared/company.ts); públicas podem ir para a IA de atendimento. */
const SECTIONS: [string, string, boolean][] = [
  ["empresa", "Sobre a empresa", true], ["atendimento", "Atendimento (canais, horários, prazos)", true],
  ["produtos", "Produtos, serviços e preços", true], ["politicas", "Políticas (troca, cancelamento, pagamento, garantia)", true],
  ["faq", "Perguntas frequentes", true], ["cultura", "Cultura: missão, visão, valores", false],
  ["situacao", "Onde a empresa está hoje", false], ["objetivos", "Resultados que quer alcançar", false],
  ["setores", "Setores e responsáveis", false], ["areas", "Áreas, pessoas e responsáveis", false],
  ["sistemas", "Sistemas usados", false], ["metas", "Volumes, metas e maiores dores", false],
];
/** Etapas da consultoria (mesma ordem do servidor). */
const STAGES: [string, string][] = [
  ["empresa", "Empresa"], ["cultura", "Cultura"], ["situacao", "Hoje"], ["objetivos", "Objetivos"],
  ["setores", "Setores"], ["processos", "Processos"], ["plano", "Planejamento"],
];
interface Msg { id: number; role: "assistant" | "user"; content: string }

/** Negrito "**texto**" da IA vira <b> (sem HTML: só texto e <b>). */
const rich = (t: string) => t.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));
interface Suggestion {
  titulo: string; area: string; tipo: "pronta" | "integracao"; impacto: string; esforco: string;
  descricao: string; modelo: string | null; sistema: string | null; passos: string[];
  instalado?: { kind: "flow" | "record_type"; id: string };
}
interface Auto {
  titulo: string; setor: string; tipo: "sem_ia" | "ia" | "integracao"; descricao: string; modelo: string | null; sistema: string | null;
  impacto: string; esforco: string; custo: { volume: number; groq: number; claude: number; claude_model: string } | null;
}
interface Plan {
  diagnostico?: string; missao?: string; visao?: string; valores?: string[];
  objetivos?: { objetivo: string; indicador: string; prazo: string }[];
  melhorias?: { titulo: string; setor: string; problema: string; como: string; impacto: string }[];
  automacoes?: Auto[];
  plano_acao?: { acao: string; responsavel: string; prazo: string }[];
  custo?: { groq_mes: number; claude_mes: number; premissas: string };
}
interface Profile {
  sections: Record<string, string>; processes: Record<string, string>[]; suggestions: Suggestion[]; use_in_ai: boolean;
  stage: string; public_research: { resumo?: string; site?: string; cnpj?: string; problemas?: string[] }; plan: Plan; plan_at: string | null;
}
const EMPTY: Profile = { sections: {}, processes: [], suggestions: [], use_in_ai: true, stage: "empresa", public_research: {}, plan: {}, plan_at: null };
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const TIPO: Record<Auto["tipo"], [string, "secondary" | "default" | "outline"]> = {
  sem_ia: ["Sem IA (sem custo de IA)", "secondary"], ia: ["Com IA", "default"], integracao: ["Integração", "outline"],
};

/** Entrevistador 2.0: consultoria em etapas, retrato da empresa e planejamento estratégico (dono/admin). */
export default function Diagnostico() {
  const { signOut } = useAuth();
  const { org, can } = useOrg();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [dirty, setDirty] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [research, setResearch] = useState({ site: "", cnpj: "" });
  const [researching, setResearching] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const { install, busy: installing } = useInstall(org?.id ?? "");

  const load = useCallback(async () => {
    if (!org) return;
    const [m, p] = await Promise.all([
      supabase.from("interview_messages").select("id, role, content").eq("organization_id", org.id).order("id"),
      supabase.from("company_profiles").select("sections, processes, suggestions, use_in_ai, stage, public_research, plan, plan_at").eq("organization_id", org.id).maybeSingle(),
    ]);
    setMsgs((m.data as Msg[]) ?? []);
    if (p.data) setProfile({ ...EMPTY, ...(p.data as unknown as Profile) });
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
    const r = await callFunction<{ reply: string; saved: number; stage: string }>("interviewer", { action: "message", organization_id: org.id, text: t });
    setBusy(false);
    if (!r.ok) return toast({ variant: "destructive", title: r.message });
    if (r.data.stage !== profile.stage) toast({ title: "Etapa concluída", description: `Agora: ${STAGES.find(([k]) => k === r.data.stage)?.[1] ?? ""}` });
    else if (r.data.saved) toast({ title: "Retrato atualizado", description: "O consultor anotou o que você contou." });
    void load();
  };

  const goStage = async (stage: string) => {
    const { error } = await supabase.from("company_profiles").update({ stage }).eq("organization_id", org.id);
    if (error) return toast({ variant: "destructive", title: "Não foi possível mudar a etapa" });
    setProfile((p) => ({ ...p, stage }));
  };

  const doResearch = async () => {
    setResearching(true);
    const r = await callFunction("interviewer", { action: "research", organization_id: org.id, site: research.site, cnpj: research.cnpj });
    setResearching(false);
    if (!r.ok) return toast({ variant: "destructive", title: r.message });
    toast({ title: "Dados públicos encontrados", description: "Confira o retrato e corrija o que precisar." });
    void load();
  };

  const makePlan = async () => {
    setPlanning(true);
    const r = await callFunction("interviewer", { action: "plan", organization_id: org.id });
    setPlanning(false);
    if (!r.ok) return toast({ variant: "destructive", title: r.message });
    toast({ title: "Planejamento pronto" });
    void load();
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
  const stageIdx = Math.max(0, STAGES.findIndex(([k]) => k === profile.stage));
  const bySector = profile.processes.reduce((m: Record<string, Record<string, string>[]>, p) => {
    const k = p.setor || p.area || "Sem setor";
    (m[k] ??= []).push(p);
    return m;
  }, {});
  const plan = profile.plan ?? {};
  const hasPlan = !!(plan.diagnostico || plan.automacoes?.length);

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

      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 pt-4">
        <ol className="flex flex-wrap gap-1.5" aria-label="Etapas da consultoria">
          {STAGES.map(([k, label], i) => (
            <li key={k}>
              <button type="button" onClick={() => goStage(k)} title="Ir para esta etapa"
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs transition ${
                  i === stageIdx ? "bg-primary text-primary-foreground border-primary" : i < stageIdx ? "bg-muted" : "text-muted-foreground hover:bg-muted"}`}>
                {i < stageIdx ? <Check className="w-3 h-3" /> : <span>{i + 1}.</span>}{label}
              </button>
            </li>
          ))}
        </ol>
      </div>

      <main className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-6 grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col rounded-lg border min-h-[70vh]">
          <div className="p-3 border-b flex items-center justify-between">
            <div>
              <p className="font-semibold">Consultoria</p>
              <p className="text-xs text-muted-foreground">Uma etapa por vez. Nos processos, descreva como se estivesse ensinando uma pessoa nova.</p>
            </div>
            {msgs.length > 0 && <Button variant="ghost" size="icon" title="Recomeçar conversa" onClick={restart}><RotateCcw className="w-4 h-4" /></Button>}
          </div>
          {profile.stage === "empresa" && (
            <div className="p-3 border-b space-y-2 bg-muted/30">
              <p className="text-xs flex items-center gap-1"><Globe className="w-3.5 h-3.5" /> Buscar dados públicos para eu já chegar conhecendo a empresa (opcional)</p>
              <div className="flex flex-wrap gap-2">
                <Input className="h-8 flex-1 min-w-[10rem]" placeholder="Site (ex.: minhaempresa.com.br)" value={research.site} onChange={(e) => setResearch({ ...research, site: e.target.value })} />
                <Input className="h-8 w-44" placeholder="CNPJ" value={research.cnpj} onChange={(e) => setResearch({ ...research, cnpj: e.target.value })} />
                <Button size="sm" variant="outline" disabled={researching || (!research.site.trim() && !research.cnpj.trim())} onClick={doResearch}>
                  {researching ? "Buscando..." : "Buscar"}
                </Button>
              </div>
              {profile.public_research?.resumo && <p className="text-xs text-muted-foreground">Achado: {profile.public_research.resumo}</p>}
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {msgs.length === 0 && (
              <div className="text-center py-10 space-y-3">
                <p className="text-sm text-muted-foreground">São 6 etapas; dá para parar e continuar depois. No fim, sai o planejamento estratégico com plano de ação.</p>
                <Button onClick={() => ask("")} disabled={busy}><Sparkles className="w-4 h-4 mr-1" /> Começar consultoria</Button>
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
            <div className="p-3 border-t flex gap-2 items-end">
              <Textarea rows={2} value={text} placeholder={profile.stage === "processos" ? "Descreva o processo passo a passo..." : "Sua resposta"} maxLength={4000} disabled={busy}
                onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && text.trim()) { e.preventDefault(); void ask(text.trim()); } }} />
              <Button size="icon" disabled={busy || !text.trim()} onClick={() => ask(text.trim())} title="Enviar"><Send className="w-4 h-4" /></Button>
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold flex items-center gap-2"><Target className="w-4 h-4" /> Planejamento estratégico</p>
              <Button size="sm" disabled={planning || (filled < 3 && profile.processes.length < 2)} onClick={makePlan}>
                <Sparkles className="w-4 h-4 mr-1" /> {planning ? "Analisando..." : hasPlan ? "Gerar de novo" : "Gerar planejamento"}
              </Button>
            </div>
            {!hasPlan && <p className="text-sm text-muted-foreground">Complete as etapas (principalmente setores e processos) e gere o planejamento: diagnóstico, missão/visão/valores, objetivos, melhorias, automações — as sem IA primeiro — plano de ação e custo estimado da IA.</p>}
            {hasPlan && (
              <div className="space-y-4 text-sm">
                {plan.diagnostico && <div><p className="text-xs font-medium text-muted-foreground">Diagnóstico</p><p className="whitespace-pre-wrap">{plan.diagnostico}</p></div>}
                {(plan.missao || plan.visao || plan.valores?.length) && (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div><p className="text-xs font-medium text-muted-foreground">Missão</p><p>{plan.missao}</p></div>
                    <div><p className="text-xs font-medium text-muted-foreground">Visão</p><p>{plan.visao}</p></div>
                    <div><p className="text-xs font-medium text-muted-foreground">Valores</p><p>{plan.valores?.join(" · ")}</p></div>
                  </div>
                )}
                {!!plan.objetivos?.length && (
                  <div><p className="text-xs font-medium text-muted-foreground">Objetivos</p>
                    <ul className="list-disc pl-5 space-y-0.5">{plan.objetivos.map((o, i) => <li key={i}>{o.objetivo}{o.indicador ? ` — medir: ${o.indicador}` : ""}{o.prazo ? ` (${o.prazo})` : ""}</li>)}</ul>
                  </div>
                )}
                {!!plan.melhorias?.length && (
                  <div className="space-y-1"><p className="text-xs font-medium text-muted-foreground">Melhorias de processo</p>
                    {plan.melhorias.map((m, i) => (
                      <div key={i} className="rounded border p-2">
                        <p className="font-medium">{m.titulo} <span className="text-xs text-muted-foreground font-normal">{m.setor} · impacto {m.impacto}</span></p>
                        {m.problema && <p className="text-muted-foreground">{m.problema}</p>}
                        {m.como && <p className="whitespace-pre-wrap"><b>Como:</b> {m.como}</p>}
                      </div>
                    ))}
                  </div>
                )}
                {!!plan.automacoes?.length && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Automações (as sem IA primeiro, para gastar menos)</p>
                    {plan.automacoes.map((a, i) => {
                      const s = i < 12 ? profile.suggestions[i] : undefined;
                      return (
                        <div key={i} className="rounded border p-2 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium">{a.titulo}</span>
                            <Badge variant={TIPO[a.tipo][1]}>{TIPO[a.tipo][0]}</Badge>
                            <Badge variant="outline">Impacto {a.impacto}</Badge>
                            <Badge variant="outline">Esforço {a.esforco}</Badge>
                            {a.setor && <span className="text-xs text-muted-foreground">{a.setor}</span>}
                          </div>
                          <p className="text-muted-foreground">{a.descricao}</p>
                          {a.custo && (
                            <p className="text-xs">≈ {a.custo.volume.toLocaleString("pt-BR")} respostas/mês · Groq {brl(a.custo.groq)}/mês · {a.custo.claude_model} {brl(a.custo.claude)}/mês</p>
                          )}
                          {s?.tipo === "pronta" && s.modelo && (s.instalado ? (
                            <Button size="sm" variant="ghost" onClick={() => navigate(s.instalado!.kind === "flow" ? `/fluxos/${s.instalado!.id}` : "/registros")}>Instalado — abrir rascunho</Button>
                          ) : (
                            <Button size="sm" variant="outline" disabled={!!installing} onClick={async () => {
                              const r = await install({ suggestion_index: i }, `s${i}`);
                              if (r?.id) void load();
                            }}>{installing === `s${i}` ? "Instalando..." : "Instalar (rascunho)"}</Button>
                          ))}
                          {s?.tipo === "integracao" && (
                            <Button size="sm" variant="outline" disabled={!!installing} onClick={async () => {
                              const r = await callFunction<{ guide_id: string }>("integrations", { action: "draft", organization_id: org.id, suggestion_index: i, system: s.sistema ?? "Sistema", goal: s.titulo });
                              if (!r.ok) return toast({ variant: "destructive", title: r.message });
                              navigate(`/integracoes?guia=${r.data.guide_id}`);
                            }}>Abrir guia de integração</Button>
                          )}
                        </div>
                      );
                    })}
                    {plan.custo && (
                      <p className="text-xs rounded bg-muted p-2">
                        <b>Custo mensal estimado da IA:</b> Groq {brl(plan.custo.groq_mes)} · Claude {brl(plan.custo.claude_mes)}. {plan.custo.premissas} Valores em dólar convertidos por estimativa; confira no painel do provedor.
                      </p>
                    )}
                  </div>
                )}
                {!!plan.plano_acao?.length && (
                  <div><p className="text-xs font-medium text-muted-foreground">Plano de ação</p>
                    <table className="w-full text-xs">
                      <thead><tr className="text-left text-muted-foreground"><th className="py-1">Ação</th><th>Quem</th><th>Quando</th></tr></thead>
                      <tbody>{plan.plano_acao.map((p, i) => <tr key={i} className="border-t align-top"><td className="py-1 pr-2">{p.acao}</td><td className="pr-2">{p.responsavel}</td><td>{p.prazo}</td></tr>)}</tbody>
                    </table>
                  </div>
                )}
                {profile.plan_at && <p className="text-xs text-muted-foreground">Gerado em {new Date(profile.plan_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}. Tudo instalado fica em rascunho para você revisar.</p>}
              </div>
            )}
          </div>

          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold">Retrato da empresa <span className="text-xs text-muted-foreground font-normal">({filled}/{SECTIONS.length} seções)</span></p>
              <Button size="sm" disabled={!dirty} onClick={saveProfile}>Salvar</Button>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Switch checked={profile.use_in_ai} onCheckedChange={(v) => { setProfile({ ...profile, use_in_ai: v }); setDirty(true); }} />
              <span>A IA de atendimento usa as seções públicas (🌐) para responder clientes. Cultura, situação, objetivos, setores, sistemas, metas e processos são internos (🔒) e nunca vão para clientes.</span>
            </label>
            {SECTIONS.map(([k, label, pub]) => (
              <div key={k} className="space-y-1">
                <p className="text-xs font-medium">{pub ? "🌐 " : "🔒 "}{label}</p>
                <Textarea rows={3} maxLength={8000} value={profile.sections?.[k] ?? ""} placeholder="O consultor preenche; você pode ajustar."
                  onChange={(e) => { setProfile({ ...profile, sections: { ...profile.sections, [k]: e.target.value } }); setDirty(true); }} />
              </div>
            ))}
            {profile.processes.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium">🔒 Processos por setor</p>
                {Object.entries(bySector).map(([setor, list]) => (
                  <div key={setor} className="space-y-1">
                    <p className="text-xs font-semibold">{setor}</p>
                    {list.map((p, i) => (
                      <details key={i} className="text-xs rounded border p-2">
                        <summary className="cursor-pointer">
                          <b>{p.nome}</b>{p.quem_faz ? ` · ${p.quem_faz}` : ""}{p.frequencia ? ` · ${p.frequencia}` : ""}{p.tempo ? ` · ${p.tempo}` : ""}
                        </summary>
                        {p.passo_a_passo && <p className="whitespace-pre-wrap mt-1">{p.passo_a_passo}</p>}
                        {p.dificuldade && <p className="text-muted-foreground mt-1">Onde trava: {p.dificuldade}</p>}
                      </details>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
