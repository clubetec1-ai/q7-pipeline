import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Eraser, FileText, Globe, Mic, Paperclip, Pencil, RotateCcw, Sparkles, Square, Target, Undo2, X } from "lucide-react";
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
import { BrandKit, useBrandKit } from "@/components/brand/BrandKit";
import { ImplementationBoard, type Priority } from "./diagnostico/ImplementationBoard";
import { TEMPLATES, templateByKey } from "./diagnostico/templates";
import { HoursEditor, hoursValid, type Hours } from "@/components/HoursEditor";
import { VoiceInterview } from "./diagnostico/VoiceInterview";
import { MicTextarea } from "@/components/MicTextarea";
import { ExplainAsk } from "./diagnostico/ExplainAsk";
import { HowItWorks } from "./diagnostico/HowItWorks";
import { PresenceTexts, SectorDelegation } from "./diagnostico/Part2";

/** Rótulo das seções (as mesmas do servidor, _shared/company.ts); 🌐 = pode ir para a IA de atendimento. */
const SECTION_LABEL: Record<string, [string, boolean]> = {
  empresa: ["Sobre a empresa", true], atendimento: ["Atendimento (canais, horários, prazos)", true],
  produtos: ["Produtos, serviços e preços", true], politicas: ["Políticas (troca, cancelamento, pagamento, garantia)", true],
  faq: ["Perguntas frequentes", true], cultura: ["Cultura: missão, visão, valores", false],
  clientes: ["Clientes e jornada de compra (os agentes usam para qualificar)", false],
  regras_ia: ["Regras do atendimento e limites da IA (os agentes seguem sempre)", false],
  marca_visual: ["Identidade visual (cores, fontes, logos e como usar)", false], marca_voz: ["Tom de voz da marca (a IA segue ao escrever)", false],
  situacao: ["Onde a empresa está hoje", false], metas: ["Volumes, metas e maiores dores", false],
  sistemas: ["Sistemas usados", false], objetivos: ["Resultados que quer alcançar", false],
  setores: ["Setores e responsáveis", false], areas: ["Áreas, pessoas e responsáveis", false],
  dados: ["Dados dos clientes e LGPD (onde ficam, quem acessa, por quanto tempo)", false],
  pos_venda: ["Pós-venda: entrega, suporte, garantia, recompra e indicação", false],
  presenca: ["Onde a empresa aparece: Google, redes sociais e site", false], medicao: ["O que medir e quem acompanha", false],
};
/** Etapas de texto: o que contar e onde o texto organizado é guardado. */
/** Blocos da entrevista: conhecer → identidade → como funciona hoje → agentes. */
const BLOCKS: Record<string, string> = { conhecer: "1 · Conhecer", identidade: "2 · Identidade", hoje: "3 · Como funciona hoje", agentes: "4 · Agentes",
  publicar: "5 · Publicar, medir e planejar" };
const STEPS: { key: string; label: string; sections: string[]; ask: string[]; block: string; min: number; afterProcs?: boolean }[] = [
  { key: "empresa", label: "Empresa", block: "conhecer", min: 5, sections: ["empresa", "atendimento", "produtos", "politicas", "faq"],
    ask: ["O que a empresa faz, para quem e onde", "Canais e horários de atendimento", "Produtos/serviços e preços (ou como faz orçamento)", "Políticas: troca, cancelamento, pagamento, garantia", "Dúvidas que os clientes mais perguntam"] },
  { key: "clientes", label: "Clientes e jornada", block: "conhecer", min: 5, sections: ["clientes"],
    ask: ["Quem são os seus clientes (perfil, de onde vêm, o que buscam)", "Por onde chegam: WhatsApp, Instagram, indicação, site…", "O que perguntam antes de comprar e as objeções mais comuns",
      "As etapas do primeiro contato até fechar (e voltar a comprar)"] },
  { key: "posvenda", label: "Pós-venda", block: "conhecer", min: 4, sections: ["pos_venda"],
    ask: ["Entrega ou execução: prazos e como o cliente é avisado", "Suporte e reclamações: por onde chegam, quem resolve e em quanto tempo",
      "Garantia, trocas e devoluções na prática", "Como pede avaliação e indicação, e como traz o cliente de volta (recompra, renovação, lembretes)"] },
  { key: "marca", label: "Marca", block: "identidade", min: 5, sections: ["marca_visual", "marca_voz"],
    ask: ["Comece enviando o logo (e o manual da marca, se tiver) no kit abaixo: o sistema sugere as cores e as fontes", "Onde usa cada versão do logo e se as cores sugeridas representam a marca",
      "Como vocês falam com os clientes: chamam de \"você\" ou de \"senhor\"? Usam emoji? Mais sério ou mais descontraído?", "Palavras que vocês sempre usam e as que evitam, e 2 ou 3 frases que vocês costumam mandar (ex.: a saudação do WhatsApp)"] },
  { key: "cultura", label: "Cultura (opcional)", block: "identidade", min: 3, sections: ["cultura"],
    ask: ["A empresa já tem cultura definida? Como ela aparece no dia a dia?", "Missão (por que existe)", "Visão (onde quer chegar)", "Valores (o que não abre mão)"] },
  { key: "situacao", label: "Hoje e números de partida", block: "hoje", min: 5, sections: ["situacao", "metas"],
    ask: ["Tamanho da equipe", "Números de hoje: volumes por mês, tempo de resposta, quantos leads viram clientes (a base para medir a melhora)",
      "Maiores dores e o que já funciona bem"] },
  { key: "sistemas", label: "Sistemas e dados", block: "hoje", min: 4, sections: ["sistemas", "dados"],
    ask: ["Sistemas e planilhas que usa (pedidos, estoque, agenda, financeiro, nota fiscal) e o que é digitado duas vezes",
      "Onde ficam os dados dos clientes e quem tem acesso", "Por quanto tempo guarda e se pede autorização para mandar mensagens",
      "O que faz quando um cliente pede para apagar os dados dele (LGPD) — não escreva senhas nem dados de clientes"] },
  { key: "objetivos", label: "Objetivos", block: "hoje", min: 3, sections: ["objetivos"],
    ask: ["Resultados que quer nos próximos 6 a 12 meses", "Como vai medir cada um (número, prazo)"] },
  { key: "setores", label: "Setores", block: "hoje", min: 3, sections: ["setores", "areas"],
    ask: ["Todos os setores (ex.: comercial, financeiro, atendimento, operação, RH)", "Responsável e quantas pessoas em cada um", "Ainda não precisa detalhar os processos"] },
  { key: "regras", label: "Regras e limites da IA", block: "agentes", min: 5, afterProcs: true, sections: ["regras_ia"],
    ask: ["O que a IA pode responder e resolver sozinha", "O que ela NUNCA pode fazer ou prometer (desconto, prazo, pedir senha…)",
      "Quando passar para uma pessoa (pedido do cliente, reclamação, valor alto…)", "Horários, o que fazer fora do horário e dados que não devem ser pedidos"] },
  { key: "publicar", label: "Publicar e medir", block: "publicar", min: 4, afterProcs: true, sections: ["presenca", "medicao"],
    ask: ["Onde a empresa aparece: perfil no Google (Google Meu Negócio), Instagram, Facebook, site, marketplaces — e os links",
      "O que publica, com que frequência e o que dá mais retorno", "O que quer acompanhar para saber se está melhorando (ex.: tempo de resposta, vendas, avaliações)",
      "De quanto em quanto tempo olhar os números e quem acompanha"] },
];
const PROC_ASK = [
  "Descreva cada processo como se estivesse ensinando uma pessoa nova: passo a passo",
  "Quem faz, com que ferramenta, quanto tempo leva e onde trava",
  "Se quiser, conte também como deveria funcionar",
];

interface Proc {
  nome: string; setor?: string; area?: string; quem_faz?: string; frequencia?: string; tempo?: string; dificuldade?: string; passo_a_passo?: string; como_deveria?: string;
  implementar?: "agora" | "depois" | "nao"; lembrar_em?: string; lembrado_em?: string;
}
/** Setores que quase toda empresa tem: ponto de partida para o dono editar (como as etiquetas padrão). */
const COMMON_SECTORS = ["Vendas / Comercial", "Atendimento ao cliente", "Financeiro", "Administrativo", "Marketing",
  "Operação / Produção", "Logística / Entregas", "Compras", "RH / Pessoas"];
/** Conferência da etapa (o que a IA organizou + ajustes do dono), salva até aprovar ou cancelar. */
/** O que ainda pode completar: pergunta simples, exemplo e, quando faz sentido, uma sugestão da IA (ex.: slogan). */
type Falta = string | { pergunta: string; exemplo?: string; sugestao?: string; secao?: string };
type Draft = { secoes?: Record<string, string>; processos?: Proc[]; setores?: string[]; horario?: Hours; faltando: Falta[] };
interface StepState { raw?: string; approved_at?: string; skipped_at?: string; setores?: string[]; attachments?: { id: string; name: string }[]; tpl?: string; horario?: Hours; review?: Draft; voice?: unknown }
interface Suggestion { titulo: string; tipo: "pronta" | "integracao"; modelo: string | null; sistema: string | null; instalado?: { kind: "flow" | "record_type"; id: string } }
interface Auto { titulo: string; setor: string; tipo: "sem_ia" | "ia" | "integracao"; descricao: string; impacto: string; esforco: string; custo: { volume: number; groq: number; claude: number; claude_model: string } | null }
interface Plan {
  diagnostico?: string; missao?: string; visao?: string; valores?: string[];
  objetivos?: { objetivo: string; indicador: string; prazo: string }[];
  melhorias?: { titulo: string; setor: string; problema: string; como: string; impacto: string }[];
  automacoes?: Auto[]; plano_acao?: { acao: string; responsavel: string; prazo: string }[];
  custo?: { groq_mes: number; claude_mes: number; premissas: string };
}
interface Profile {
  sections: Record<string, string>; processes: Proc[]; suggestions: Suggestion[]; use_in_ai: boolean; stage: string;
  steps: Record<string, StepState>; public_research: { resumo?: string }; plan: Plan; plan_at: string | null; last_page?: string | null;
}
const EMPTY: Profile = { sections: {}, processes: [], suggestions: [], use_in_ai: true, stage: "empresa", steps: {}, public_research: {}, plan: {}, plan_at: null, last_page: null };
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const TIPO: Record<Auto["tipo"], [string, "secondary" | "default" | "outline"]> = {
  sem_ia: ["Sem IA (sem custo de IA)", "secondary"], ia: ["Com IA", "default"], integracao: ["Integração", "outline"],
};

/** Diagnóstico em páginas: o dono escreve, a IA organiza, ele aprova etapa por etapa; no fim, o planejamento. */
export default function Diagnostico() {
  const { signOut } = useAuth();
  const { org, can } = useOrg();
  const brandKit = useBrandKit(org?.id);
  const navigate = useNavigate();
  const { toast } = useToast();
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [page, setPage] = useState<string>("empresa");
  // Só mostra/salva o texto da etapa depois que o retrato salvo chegou do banco.
  const [ready, setReady] = useState(false);
  const [raw, setRaw] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [research, setResearch] = useState({ site: "", cnpj: "" });
  const [copies, setCopies] = useState(0);
  const [orgTpl, setOrgTpl] = useState<string | null>(null);
  // Horário: a empresa já tem um salvo? Se não, o horário contado na etapa Empresa vira sugestão pronta.
  const [orgHasHours, setOrgHasHours] = useState(true);
  const [hoursDraft, setHoursDraft] = useState<Hours | null>(null);
  const [atts, setAtts] = useState<{ id: string; name: string }[]>([]);
  const [depts, setDepts] = useState<{ id: string; name: string }[]>([]);
  const [rec, setRec] = useState<{ on: boolean; secs: number }>({ on: false, secs: 0 });
  const recorder = useRef<MediaRecorder | null>(null);
  // Ditado ao vivo (reconhecimento de voz do navegador): o texto aparece enquanto a pessoa fala.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const speech = useRef<any>(null);
  const dictating = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { install, busy: installing } = useInstall(org?.id ?? "");

  const load = useCallback(async (goTo?: string) => {
    if (!org) return;
    const { data } = await supabase.from("company_profiles")
      .select("sections, processes, suggestions, use_in_ai, stage, steps, public_research, plan, plan_at, last_page").eq("organization_id", org.id).maybeSingle();
    const p = data ? { ...EMPTY, ...(data as unknown as Profile) } : EMPTY;
    setProfile(p);
    const [{ data: n }, { data: dp }, { data: o }] = await Promise.all([
      supabase.rpc("company_profile_snapshots_count", { org: org.id }),
      supabase.from("departments").select("id, name").eq("organization_id", org.id),
      supabase.from("organizations").select("template_key, settings").eq("id", org.id).maybeSingle(),
    ]);
    setDepts(dp ?? []);
    setOrgTpl(o?.template_key ?? null);
    setOrgHasHours(!!(o?.settings as { business_hours?: unknown } | null)?.business_hours);
    setCopies((n as number | null) ?? 0);
    if (goTo !== undefined) setPage(goTo);
    return p;
  }, [org]);
  // ?pagina=marca (menu "Marca") abre direto na etapa; senão, a página onde a pessoa estava (mesmo depois de atualizar).
  const [params] = useSearchParams();
  const wanted = params.get("pagina");
  useEffect(() => {
    const ok = (k?: string | null): k is string => !!k && (STEPS.some((s) => s.key === k) || k.startsWith("proc:") || k === "plano");
    void load().then((p) => {
      if (!p) return;
      setPage(ok(wanted) ? wanted : ok(p.last_page) ? p.last_page : p.stage === "processos" ? "setores" : p.stage || "empresa");
      setReady(true);
    });
  }, [load, wanted]);

  // Setores aprovados viram páginas de processos.
  const sectors = useMemo(() => {
    const fromStep = profile.steps.setores?.setores ?? [];
    const fromProcs = profile.processes.map((p) => p.setor || p.area || "").filter(Boolean);
    return [...new Set([...fromStep, ...fromProcs])];
  }, [profile]);
  const pages = useMemo(() => [...STEPS.filter((s) => !s.afterProcs).map((s) => s.key), ...sectors.map((s) => `proc:${s}`),
    ...STEPS.filter((s) => s.afterProcs).map((s) => s.key), "plano"], [sectors]);
  const approved = (k: string) => !!profile.steps[k]?.approved_at;
  const skipped = (k: string) => !approved(k) && !!profile.steps[k]?.skipped_at;
  // Sem escolha no Diagnóstico, vale o modelo com que a empresa foi criada (ex.: Cartório).
  const tpl = templateByKey(profile.steps.modelo ? profile.steps.modelo.tpl : orgTpl);
  const outdated = !!profile.plan_at && Object.values(profile.steps).some((s) => s.approved_at && s.approved_at > profile.plan_at!);

  // Rascunho salvo sozinho: o texto e os anexos de cada etapa vão para o banco enquanto a pessoa escreve.
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const shown = useRef({ page: "", raw: "", atts: "[]" }); // o que está gravado da página aberta
  const saveDraft = useCallback(async (k: string, text: string, files: { id: string; name: string }[]) => {
    if (!org || k === "plano") return false;
    const { error } = await supabase.rpc("save_step_draft", { org: org.id, p_key: k, p_raw: text, p_attachments: files as never });
    if (error) { setSavedAt(null); return false; }
    if (shown.current.page === k) shown.current = { page: k, raw: text, atts: JSON.stringify(files) };
    setProfile((p) => ({ ...p, steps: { ...p.steps, [k]: { ...(p.steps[k] ?? {}), raw: text, attachments: files } } }));
    setSavedAt(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
    return true;
  }, [org]);
  useEffect(() => {
    const k = shown.current.page;
    if (!k || k !== page || (raw === shown.current.raw && JSON.stringify(atts) === shown.current.atts)) return;
    const t = window.setTimeout(() => void saveDraft(k, raw, atts), 800);
    return () => window.clearTimeout(t);
  }, [raw, atts, page, saveDraft]);

  // A conferência também é salva sozinha (some só ao aprovar ou cancelar).
  const reviewShown = useRef({ page: "", json: "null" });
  const saveReview = useCallback(async (k: string, d: Draft | null) => {
    if (!org || k === "plano") return;
    const { error } = await supabase.rpc("save_step_review", { org: org.id, p_key: k, p_review: d as never });
    if (error) return;
    if (reviewShown.current.page === k) reviewShown.current = { page: k, json: JSON.stringify(d) };
    setProfile((p) => {
      const st: StepState = { ...(p.steps[k] ?? {}) };
      if (d) st.review = d; else delete st.review;
      return { ...p, steps: { ...p.steps, [k]: st } };
    });
    if (d) setSavedAt(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
  }, [org]);
  useEffect(() => {
    const k = reviewShown.current.page;
    if (!k || k !== page || JSON.stringify(draft) === reviewShown.current.json) return;
    const t = window.setTimeout(() => void saveReview(k, draft), 800);
    return () => window.clearTimeout(t);
  }, [draft, page, saveReview]);

  // Ao trocar de página: grava o que faltava da anterior, carrega o texto da nova e lembra onde a pessoa está.
  useEffect(() => {
    if (!ready) return;
    if (dictating.current) { dictating.current = false; speech.current?.stop(); setRec({ on: false, secs: 0 }); }
    const old = shown.current;
    if (old.page && old.page !== page && (raw !== old.raw || JSON.stringify(atts) !== old.atts)) void saveDraft(old.page, raw, atts);
    const oldR = reviewShown.current;
    if (oldR.page && oldR.page !== page && JSON.stringify(draft) !== oldR.json) void saveReview(oldR.page, draft);
    const rv = profile.steps[page]?.review ?? null;
    reviewShown.current = { page, json: JSON.stringify(rv) };
    const r = profile.steps[page]?.raw ?? "";
    const a = profile.steps[page]?.attachments ?? [];
    shown.current = { page, raw: r, atts: JSON.stringify(a) };
    setRaw(r); setAtts(a); setDraft(rv); setSavedAt(null);
    if (org) void supabase.rpc("save_step_draft", { org: org.id, p_key: page, p_raw: null as never, p_attachments: null as never });
  }, [page, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  // Contador enquanto grava.
  useEffect(() => {
    if (!rec.on) return;
    const t = window.setInterval(() => setRec((r) => ({ ...r, secs: r.secs + 1 })), 1000);
    return () => window.clearInterval(t);
  }, [rec.on]);

  if (!org) return null;
  if (!can("org.settings")) return <Navigate to="/" replace />;

  const step = STEPS.find((s) => s.key === page);
  const setor = page.startsWith("proc:") ? page.slice(5) : null;
  const idx = pages.indexOf(page);
  const next = pages[idx + 1] ?? "plano";
  const prev = pages[idx - 1];

  // Etapas como estão no banco agora: a entrevista por voz, o rascunho e a conferência são salvos
  // à parte enquanto a pessoa trabalha; gravar a partir da cópia antiga da página apagava isso.
  const freshSteps = async (): Promise<Record<string, StepState>> => {
    const { data } = await supabase.from("company_profiles").select("steps").eq("organization_id", org.id).maybeSingle();
    return { ...profile.steps, ...((data?.steps ?? {}) as Record<string, StepState>) };
  };

  const ensureRow = async () => {
    const { data } = await supabase.from("company_profiles").select("organization_id").eq("organization_id", org.id).maybeSingle();
    if (!data) await supabase.from("company_profiles").insert({ organization_id: org.id });
  };

  const toBase64 = (b: Blob) => new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = rej;
    r.readAsDataURL(b);
  });
  // Microfone: grava no navegador; ao parar, vira texto (Groq Whisper) e entra na caixa para revisar.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SpeechRec: any = typeof window !== "undefined" ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : null;
  const toggleMic = async () => {
    if (SpeechRec) return toggleDictation();
    return recordAndTranscribe();
  };
  const toggleDictation = () => {
    if (dictating.current) { dictating.current = false; speech.current?.stop(); setRec({ on: false, secs: 0 }); return; }
    const base = raw.trim() ? `${raw.trim()} ` : "";
    let finals = "";
    const sr = new SpeechRec();
    sr.lang = "pt-BR"; sr.continuous = true; sr.interimResults = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sr.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finals += `${t.trim()} `; else interim += t;
      }
      setRaw(`${base}${finals}${interim}`.replace(/\s+$/, interim ? "" : " "));
    };
    // O navegador para sozinho depois de um silêncio: continua enquanto a pessoa não clicar em Parar.
    sr.onend = () => { if (dictating.current) { try { sr.start(); } catch { /* já reiniciando */ } } };
    sr.onerror = (e: { error?: string }) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        dictating.current = false; setRec({ on: false, secs: 0 });
        toast({ variant: "destructive", title: "Microfone bloqueado", description: "Permita o microfone no navegador para ditar." });
      }
    };
    speech.current = sr;
    dictating.current = true;
    sr.start();
    setRec({ on: true, secs: 0 });
  };
  const recordAndTranscribe = async () => {
    if (rec.on) { recorder.current?.stop(); return; }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { return toast({ variant: "destructive", title: "Microfone bloqueado", description: "Permita o microfone no navegador para falar." }); }
    const mr = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setRec({ on: false, secs: 0 });
      const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
      if (blob.size < 2000) return;
      setBusy("mic");
      const r = await callFunction<{ text: string }>("interviewer", { action: "transcribe", organization_id: org.id, audio: await toBase64(blob), mime: blob.type });
      setBusy(null);
      if (!r.ok) return toast({ variant: "destructive", title: r.message });
      setRaw((t) => (t.trim() ? `${t.trim()}\n${r.data.text}` : r.data.text));
    };
    recorder.current = mr;
    mr.start();
    setRec({ on: true, secs: 0 });
  };
  // Anexo: vai para a base de conhecimento (setor da página, interno) e é lido ao organizar.
  const attach = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) return toast({ variant: "destructive", title: "Arquivo acima de 10 MB" });
    // Formatos antigos do Office não são lidos: pede para salvar no formato novo antes de enviar.
    const old = /\.(doc|xls|ppt|pptx|odt|rtf|pages)$/i.exec(file.name)?.[1]?.toLowerCase();
    if (old) return toast({ variant: "destructive", title: `Não consigo ler arquivos .${old}`,
      description: old === "doc" || old === "odt" || old === "rtf" || old === "pages"
        ? "Abra no Word e use Arquivo → Salvar como → Documento do Word (.docx) ou PDF, e anexe de novo."
        : old === "xls" ? "Abra no Excel e salve como Pasta de Trabalho do Excel (.xlsx) ou CSV, e anexe de novo."
        : "Salve como PDF e anexe de novo." });
    setBusy("attach");
    const dept = setor ? depts.find((d) => d.name.toLowerCase() === setor.toLowerCase())?.id ?? null : null;
    const r = await callFunction<{ id: string; status: string; error?: string }>("knowledge", {
      action: "upload", organization_id: org.id, title: `${pageLabel(page)} — ${file.name}`, kind: "outro", visibility: "interno",
      department_id: dept, file_name: file.name, mime: file.type, data: await toBase64(file),
    });
    setBusy(null);
    if (!r.ok) return toast({ variant: "destructive", title: r.message });
    // Sem texto lido, o anexo não ajuda a IA: não entra na etapa (fica só na base de conhecimento).
    if (r.data.status === "failed") return toast({ variant: "destructive", title: "Não consegui ler este arquivo", description: `${r.data.error ?? ""} Salve como PDF ou .docx e anexe de novo.`.trim() });
    setAtts((a) => [...a, { id: r.data.id, name: file.name }]);
    toast({ title: "Arquivo lido", description: "A entrevista e o Organizar com IA vão usar o que está nele." });
  };

  const organize = async () => {
    setBusy("format");
    const r = await callFunction<{ secoes?: Record<string, string>; processos?: Proc[]; setores?: string[]; faltando: Falta[] }>(
      "interviewer", { action: "format", organization_id: org.id, step: setor ? "processos" : page, setor, text: raw, docs: atts.map((a) => a.id) });
    setBusy(null);
    if (!r.ok) return toast({ variant: "destructive", title: r.message });
    setDraft(r.data);
    void saveReview(page, r.data); // a conferência fica salva na hora
  };

  // Aprovar: grava o texto organizado (e o que o dono escreveu) e segue para a próxima página.
  const approve = async () => {
    if (!draft) return;
    setBusy("approve");
    await ensureRow();
    const horario = page === "empresa" ? draft.horario ?? profile.steps.empresa?.horario : undefined;
    const fresh = await freshSteps();
    // Aprovar mantém a entrevista por voz da etapa (dá para continuar depois) e tira só a conferência.
    const steps = { ...fresh, [page]: { ...(fresh[page]?.voice ? { voice: fresh[page].voice } : {}), raw, attachments: atts, approved_at: new Date().toISOString(), ...(draft.setores ? { setores: draft.setores } : {}), ...(horario ? { horario } : {}) } };
    const patch: Record<string, unknown> = { steps, stage: next.startsWith("proc:") ? "processos" : next === "plano" ? "plano" : next };
    if (draft.secoes) patch.sections = { ...profile.sections, ...Object.fromEntries(Object.entries(draft.secoes).filter(([, v]) => v.trim())) };
    if (setor && draft.processos) {
      // Mantém a decisão (agora/depois/não e lembrete) dos processos que continuam com o mesmo nome.
      const before = new Map(profile.processes.filter((p) => (p.setor || p.area) === setor).map((p) => [p.nome.trim().toLowerCase(), p]));
      patch.processes = [...profile.processes.filter((p) => (p.setor || p.area) !== setor), ...draft.processos.map((p) => {
        const old = before.get(p.nome.trim().toLowerCase());
        return { ...p, setor, area: setor, ...(old ? { implementar: old.implementar, lembrar_em: old.lembrar_em, lembrado_em: old.lembrado_em } : {}) };
      })];
    }
    const { error } = await supabase.from("company_profiles").update(patch as never).eq("organization_id", org.id);
    setBusy(null);
    if (error) return toast({ variant: "destructive", title: "Não salvo", description: error.message });
    // Aprovada: a conferência já saiu do banco junto (a etapa foi gravada sem ela); não regravar ao trocar de página.
    reviewShown.current = { page, json: JSON.stringify(draft) };
    toast({ title: "Etapa aprovada", description: "O retrato da empresa foi atualizado." });
    // Com horário sugerido e a empresa ainda sem horário: fica na etapa para o dono conferir e usar.
    if (page === "empresa" && horario && !orgHasHours) {
      setHoursDraft(null);
      setDraft(null); // mostra a etapa aprovada, com o cartão do horário
      await load("empresa");
      setPage("empresa");
      return;
    }
    const nextPage = draft.setores?.length && page === "setores" ? `proc:${draft.setores[0]}` : next;
    await load(nextPage);
  };

  const applyHours = async (h: Hours) => {
    if (!hoursValid(h)) return toast({ variant: "destructive", title: "Horário inicial deve ser antes do final" });
    const { data } = await supabase.from("organizations").select("settings").eq("id", org.id).maybeSingle();
    const nextSettings = { ...((data?.settings ?? {}) as Record<string, unknown>), business_hours: h };
    const { error } = await supabase.from("organizations").update({ settings: nextSettings as never }).eq("id", org.id);
    if (error) return toast({ variant: "destructive", title: "Sem permissão" });
    setOrgHasHours(true);
    toast({ title: "Horário de atendimento ativado", description: "Dá para mudar em Configurações → Horário e LGPD." });
  };

  // Plano de implementação: salva a escolha de cada processo (agora/depois/não + lembrete).
  const saveProcesses = async (next: Proc[]) => {
    setProfile((p) => ({ ...p, processes: next }));
    const { error } = await supabase.from("company_profiles").update({ processes: next } as never).eq("organization_id", org.id);
    if (error) toast({ variant: "destructive", title: "Não salvo", description: error.message });
  };
  const prioritize = async () => {
    setBusy("priority");
    const r = await callFunction("interviewer", { action: "sector_priority", organization_id: org.id });
    setBusy(null);
    if (!r.ok) return toast({ variant: "destructive", title: r.message });
    await load(page);
  };
  const priority = (profile.steps as Record<string, unknown>).prioridade as Priority | undefined;

  // Editar uma etapa aprovada: traz o que está salvo para a prévia (sem mexer nas outras).
  const edit = () => {
    if (step) setDraft({ secoes: Object.fromEntries(step.sections.map((k) => [k, profile.sections[k] ?? ""])), setores: page === "setores" ? profile.steps.setores?.setores ?? [] : undefined, faltando: [] });
    if (setor) setDraft({ processos: profile.processes.filter((p) => (p.setor || p.area) === setor), faltando: [] });
  };

  // Refazer só esta etapa: limpa texto, aprovação e o que ela gravou.
  // "Não sei / pular": marca a etapa como pulada (dá para voltar depois) e segue.
  const skipStep = async () => {
    await ensureRow();
    const fresh = await freshSteps();
    const steps = { ...fresh, [page]: { ...(fresh[page] ?? {}), raw, skipped_at: new Date().toISOString() } };
    const { error } = await supabase.from("company_profiles").update({ steps } as never).eq("organization_id", org.id);
    if (error) return toast({ variant: "destructive", title: "Não foi possível", description: error.message });
    toast({ title: "Etapa pulada", description: "Você pode voltar nela quando quiser." });
    await load(next);
  };
  // Modelo por tipo de empresa: traz exemplos prontos para cada etapa.
  const chooseTemplate = async (key: string) => {
    await ensureRow();
    const steps = { ...(await freshSteps()), modelo: { tpl: key } };
    const { error } = await supabase.from("company_profiles").update({ steps } as never).eq("organization_id", org.id);
    if (error) return toast({ variant: "destructive", title: "Não foi possível", description: error.message });
    await load(page);
  };
  const example = tpl ? (setor ? tpl.processes[setor] ?? Object.entries(tpl.processes).find(([k]) => k.toLowerCase() === setor.toLowerCase())?.[1] : tpl.steps[page]) : undefined;

  const redoStep = async () => {
    if (!window.confirm("Refazer só esta etapa? O texto e o resultado dela são apagados; as outras etapas continuam.")) return;
    await ensureRow();
    const steps = await freshSteps();
    delete steps[page];
    const patch: Record<string, unknown> = { steps };
    if (step) patch.sections = Object.fromEntries(Object.entries(profile.sections).filter(([k]) => !step.sections.includes(k)));
    if (setor) patch.processes = profile.processes.filter((p) => (p.setor || p.area) !== setor);
    const { error } = await supabase.from("company_profiles").update(patch as never).eq("organization_id", org.id);
    if (error) return toast({ variant: "destructive", title: "Não foi possível", description: error.message });
    await load(page);
    setRaw("");
  };

  const resetAll = async () => {
    const typed = window.prompt("Recomeçar o diagnóstico do zero? Todas as etapas e o planejamento são apagados (fluxos e registros já instalados continuam). Uma cópia fica guardada para desfazer.\n\nDigite RECOMEÇAR para confirmar:");
    if (!["RECOMEÇAR", "RECOMECAR"].includes(typed?.trim().toUpperCase() ?? "")) return;
    const { error } = await supabase.rpc("reset_company_profile", { org: org.id });
    if (error) return toast({ variant: "destructive", title: "Não foi possível", description: error.message });
    toast({ title: "Diagnóstico zerado" });
    await load("empresa");
  };
  const restorePrev = async () => {
    if (!window.confirm("Voltar o diagnóstico de antes do último recomeço?")) return;
    const { error } = await supabase.rpc("restore_company_profile", { org: org.id });
    if (error) return toast({ variant: "destructive", title: "Não foi possível", description: error.message });
    const p = await load();
    if (p) setPage(p.stage === "processos" ? "setores" : p.stage || "empresa");
  };

  const doResearch = async () => {
    setBusy("research");
    const r = await callFunction("interviewer", { action: "research", organization_id: org.id, site: research.site, cnpj: research.cnpj });
    setBusy(null);
    if (!r.ok) return toast({ variant: "destructive", title: r.message });
    toast({ title: "Dados públicos encontrados", description: "Use como ponto de partida e complete com o seu texto." });
    await load();
  };
  const makePlan = async () => {
    setBusy("plan");
    const r = await callFunction("interviewer", { action: "plan", organization_id: org.id });
    setBusy(null);
    if (!r.ok) return toast({ variant: "destructive", title: r.message });
    toast({ title: "Planejamento pronto" });
    await load("plano");
  };
  const toggleAI = async (v: boolean) => {
    await ensureRow();
    await supabase.from("company_profiles").update({ use_in_ai: v }).eq("organization_id", org.id);
    setProfile((p) => ({ ...p, use_in_ai: v }));
  };

  const pageLabel = (k: string) => STEPS.find((s) => s.key === k)?.label ?? (k.startsWith("proc:") ? k.slice(5) : "Planejamento");
  const plan = profile.plan ?? {};
  const hasPlan = !!(plan.diagnostico || plan.automacoes?.length);
  const readyForPlan = approved("empresa") && approved("setores") && sectors.some((s) => approved(`proc:${s}`));

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="print:hidden">
        <AppHeader active="diagnostico" />
        <NumberHealthBanner />
      </div>

      <main className="flex-1 w-full max-w-6xl mx-auto p-4 sm:p-6 grid gap-6 md:grid-cols-[220px_1fr] print:block print:p-0 print:max-w-none"
        style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}>
        <aside className="space-y-3 print:hidden">
          <p className="text-sm font-semibold">Diagnóstico</p>
          <label className="block text-xs text-muted-foreground space-y-1">
            <span>Modelo do seu tipo de empresa (traz exemplos prontos)</span>
            <select className="h-8 w-full rounded-md border bg-background px-2 text-xs text-foreground" value={tpl?.key ?? ""} onChange={(e) => void chooseTemplate(e.target.value)}>
              <option value="">Sem modelo</option>
              {TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </label>
          <nav className="space-y-0.5" aria-label="Etapas">
            {pages.map((k, i) => {
              const isProc = k.startsWith("proc:");
              const block = k === "plano" ? "publicar" : isProc ? "hoje" : STEPS.find((s) => s.key === k)?.block ?? "";
              const prevK = pages[i - 1];
              const prevBlock = !prevK ? "" : prevK === "plano" ? "publicar" : prevK.startsWith("proc:") ? "hoje" : STEPS.find((s) => s.key === prevK)?.block ?? "";
              return (
                <div key={k}>
                {block !== prevBlock && <p className="pt-2 pb-0.5 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{BLOCKS[block]}</p>}
                <button type="button" onClick={() => setPage(k)}
                  className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left transition ${isProc ? "pl-6" : ""} ${
                    page === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                  {approved(k) ? <Check className="w-3.5 h-3.5 shrink-0" /> : skipped(k) ? <span className="w-3.5 h-3.5 shrink-0 text-center leading-3" title="Pulada">–</span> : <span className="w-3.5 h-3.5 shrink-0 rounded-full border" />}
                  <span className="truncate">{pageLabel(k)}</span>
                </button>
                {k === "setores" && sectors.length === 0 && <p className="pl-6 text-xs text-muted-foreground">Processos: aprove os setores primeiro</p>}
                </div>
              );
            })}
          </nav>
          <div className="pt-2 space-y-1 border-t">
            <HowItWorks />
            <Button size="sm" variant="ghost" className="w-full justify-start" onClick={resetAll}><Eraser className="w-4 h-4 mr-2" /> Recomeçar tudo</Button>
            {copies > 0 && <Button size="sm" variant="ghost" className="w-full justify-start" onClick={restorePrev}><Undo2 className="w-4 h-4 mr-2" /> Desfazer recomeço</Button>}
          </div>
        </aside>

        <section className="space-y-4 min-w-0">
          {page !== "plano" && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="text-xl font-semibold">{setor ? `Processos — ${setor}` : step?.label}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">~{setor ? 5 : step?.min ?? 5} min</span></h1>
                {approved(page) && <Badge>Aprovado</Badge>}
              </div>
              <ExplainAsk key={page} orgId={org.id} step={setor ? "processos" : page} setor={setor} items={setor ? PROC_ASK : step?.ask ?? []} />

              {setor && (
                <SectorDelegation key={setor} orgId={org.id} setor={setor} onUse={(t) => {
                  setRaw((r) => (r.trim() ? `${r.trim()}\n\n` : "") + t);
                  if (approved(page)) edit();
                }} />
              )}
              {page === "publicar" && approved("publicar") && <PresenceTexts orgId={org.id} />}

              {page === "marca" && org && (
                <>
                  <p className="text-xs text-muted-foreground">
                    🎨 A marca guia o marketing e os agentes: as <b>cores, fontes e logos</b> ficam no kit abaixo (salva sozinho); o <b>tom de voz</b> você
                    escreve ou fala na caixa, a IA organiza e, depois de aprovado, os agentes de IA e as campanhas passam a escrever desse jeito.
                  </p>
                  <BrandKit orgId={org.id} editable kit={brandKit.kit} onSaved={() => void brandKit.reload()}
                    onSuggestText={(t) => setRaw((r) => (r.trim() ? `${r.trim()}\n\n` : "") + t)} />
                </>
              )}

              {page === "empresa" && (
                <div className="rounded-md border p-3 space-y-2 bg-muted/30">
                  <p className="text-xs flex items-center gap-1"><Globe className="w-3.5 h-3.5" /> Opcional: buscar dados públicos (site e CNPJ) para começar</p>
                  <div className="flex flex-wrap gap-2">
                    <Input className="h-8 flex-1 min-w-[10rem]" placeholder="Site" value={research.site} onChange={(e) => setResearch({ ...research, site: e.target.value })} />
                    <Input className="h-8 w-44" placeholder="CNPJ" value={research.cnpj} onChange={(e) => setResearch({ ...research, cnpj: e.target.value })} />
                    <Button size="sm" variant="outline" disabled={busy === "research" || (!research.site.trim() && !research.cnpj.trim())} onClick={doResearch}>
                      {busy === "research" ? "Buscando..." : "Buscar"}
                    </Button>
                  </div>
                  {profile.public_research?.resumo && <p className="text-xs text-muted-foreground">Achado: {profile.public_research.resumo}</p>}
                </div>
              )}

              {!draft && approved(page) ? (
                <div className="space-y-3">
                  {step?.sections.filter((k) => profile.sections[k]?.trim()).map((k) => (
                    <div key={k} className="rounded-md border p-3">
                      <p className="text-xs font-medium mb-1">{SECTION_LABEL[k][1] ? "🌐 " : "🔒 "}{SECTION_LABEL[k][0]}</p>
                      <p className="text-sm whitespace-pre-wrap">{profile.sections[k]}</p>
                    </div>
                  ))}
                  {setor && profile.processes.filter((p) => (p.setor || p.area) === setor).map((p, i) => <ProcCard key={i} p={p} />)}
                  {setor && <p className="text-xs text-muted-foreground">Defina o que implementar agora ou depois em <button type="button" className="underline" onClick={() => setPage("setores")}>Setores → Plano de implementação</button>.</p>}
                  {page === "empresa" && !orgHasHours && profile.steps.empresa?.horario && (
                    <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-3">
                      <div>
                        <p className="text-sm font-medium">Horário de atendimento sugerido</p>
                        <p className="text-xs text-muted-foreground">Montado com o que você contou. Ligue ou desligue os dias, ajuste se precisar e clique em usar — fora desse horário, o cliente recebe o aviso de fechado.</p>
                      </div>
                      <HoursEditor value={hoursDraft ?? profile.steps.empresa.horario} onChange={setHoursDraft} />
                      <Button size="sm" onClick={() => void applyHours(hoursDraft ?? profile.steps.empresa!.horario!)}><Check className="w-4 h-4 mr-1" /> Usar este horário</Button>
                    </div>
                  )}
                  {page === "setores" && (
                    <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm flex flex-wrap items-center justify-between gap-2">
                      <span>Os setores aprovados viram setores de verdade no sistema (fila, cor e equipe) em <b>Setores e processos</b>.</span>
                      <Button size="sm" variant="outline" onClick={() => navigate("/setores")}>Criar setores no sistema</Button>
                    </div>
                  )}
                  {page === "setores" && (
                    <ImplementationBoard processes={profile.processes} sectors={sectors} priority={priority} busy={busy === "priority"}
                      onChange={(n) => void saveProcesses(n as Proc[])} onPrioritize={prioritize} />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={edit}><Pencil className="w-4 h-4 mr-1" /> Editar esta etapa</Button>
                    <Button variant="ghost" onClick={redoStep}><RotateCcw className="w-4 h-4 mr-1" /> Refazer esta etapa</Button>
                    <Button className="ml-auto" onClick={() => setPage(next)}>Próxima: {pageLabel(next)}</Button>
                  </div>
                </div>
              ) : (
                <>
                  {example && !raw.trim() && (
                    <div className="rounded-md border border-dashed border-primary/50 bg-primary/5 p-3 space-y-2">
                      <p className="text-xs">📋 <b>Exemplo — {tpl?.label}</b>: use como ponto de partida e troque pelo que é da sua empresa.</p>
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-6">{example}</p>
                      <Button size="sm" variant="outline" onClick={() => setRaw(example)}>Usar exemplo</Button>
                    </div>
                  )}
                  {page === "setores" && !raw.trim() && !example && (
                    <div className="rounded-md border border-dashed p-3 space-y-2">
                      <p className="text-xs">💡 <b>Setores que quase toda empresa tem</b> — use como ponto de partida: apague o que não existe, renomeie e complete responsável e pessoas.</p>
                      <div className="flex flex-wrap gap-1">{COMMON_SECTORS.map((s) => <span key={s} className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{s}</span>)}</div>
                      <Button size="sm" variant="outline" onClick={() => setRaw(COMMON_SECTORS.map((s) => `${s} — responsável: ___ — pessoas: ___`).join("\n"))}>Usar como exemplo</Button>
                    </div>
                  )}
                  <Textarea rows={draft ? 5 : 12} value={raw} onChange={(e) => setRaw(e.target.value)} maxLength={12000}
                    placeholder={setor
                      ? "Escreva aqui ou clique em 🎤 Falar logo abaixo — o que você falar aparece escrito nesta caixa.\nEx.: 1. O cliente pede orçamento no WhatsApp. 2. O vendedor confere o estoque na planilha..."
                      : "Escreva aqui do seu jeito ou clique em 🎤 Falar logo abaixo — o que você falar aparece escrito nesta caixa. Depois a IA organiza para você revisar."} />
                  <p className="text-xs text-muted-foreground">
                    {savedAt && <span className="text-success-text">✓ Salvo às {savedAt}. </span>}
                    ✍️ Você pode <b>escrever</b> ou clicar em <b>🎤 Falar</b>: sua fala vira texto aqui em cima, para você conferir e corrigir.
                    Quando terminar, clique em <b>Organizar com IA</b>.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    📎 <b>Anexe materiais que ajudam</b> a montar esta etapa: contratos, orçamentos, planilhas, manuais, fluxos de processo,
                    apresentações da empresa. A IA lê o conteúdo junto com o que você escreveu ou falou, e os arquivos ficam guardados na
                    base de conhecimento do setor.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant={rec.on ? "destructive" : "outline"} size="sm" disabled={busy === "mic"} onClick={toggleMic}
                      title={rec.on ? "Parar" : SpeechRec ? "Ditar: o texto aparece enquanto você fala" : "Falar: grava e transforma em texto"}>
                      {rec.on ? <><Square className="w-4 h-4 mr-1" /> {SpeechRec ? "Parar ditado" : "Parar"} ({Math.floor(rec.secs / 60)}:{String(rec.secs % 60).padStart(2, "0")})</>
                        : <><Mic className="w-4 h-4 mr-1" /> {busy === "mic" ? "Transcrevendo..." : "Falar"}</>}
                    </Button>
                    <Button type="button" variant="outline" size="sm" disabled={busy === "attach"} onClick={() => fileInput.current?.click()} title="Anexar contrato, planilha, manual...">
                      <Paperclip className="w-4 h-4 mr-1" /> {busy === "attach" ? "Lendo..." : "Anexar materiais"}
                    </Button>
                    <VoiceInterview key={page} orgId={org.id} step={setor ? "processos" : page} setor={setor}
                      onDone={(text) => setRaw((r) => (r.trim() ? `${r.trim()}\n\n` : "") + text)}
                      onAttach={() => fileInput.current?.click()} attached={atts.map((a) => a.name)} docs={atts.map((a) => a.id)} />
                    <input ref={fileInput} type="file" className="hidden" accept=".pdf,.docx,.xlsx,.csv,.txt,.md"
                      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void attach(f); }} />
                    {atts.map((a) => (
                      <span key={a.id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
                        <Paperclip className="w-3 h-3" />{a.name}
                        <button type="button" title="Tirar desta etapa (continua na base de conhecimento)" onClick={() => setAtts((x) => x.filter((y) => y.id !== a.id))}><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {prev && <Button variant="ghost" onClick={() => setPage(prev)} title={`Volta para a etapa ${pageLabel(prev)} (o que você fez aqui fica salvo)`}><ArrowLeft className="w-4 h-4 mr-1" /> Etapa anterior</Button>}
                    {!draft && <Button variant="ghost" onClick={skipStep} title="Pular por agora; dá para voltar depois">Não sei / pular</Button>}
                    {!draft && (raw.trim() || atts.length > 0) && (
                      <Button variant="outline" disabled={busy === "next"} title="Guarda o que você escreveu e vai para a próxima etapa; organize e aprove quando quiser"
                        onClick={async () => {
                          setBusy("next");
                          const ok = await saveDraft(page, raw, atts);
                          setBusy(null);
                          if (!ok) return toast({ variant: "destructive", title: "Não consegui salvar agora", description: "Confira a internet e tente de novo." });
                          toast({ title: "Etapa salva", description: "Quando quiser, volte nela para organizar com IA e aprovar." });
                          setPage(next);
                        }}>
                        {busy === "next" ? "Salvando..." : <>Salvar e próxima etapa <ArrowRight className="w-4 h-4 ml-1" /></>}
                      </Button>
                    )}
                    <Button variant={draft ? "outline" : "default"} disabled={busy === "format" || (raw.trim().length < 10 && !atts.length)} onClick={organize}>
                      <Sparkles className="w-4 h-4 mr-1" /> {busy === "format" ? "Organizando..." : draft ? "Organizar de novo" : "Organizar com IA"}
                    </Button>
                  </div>
                </>
              )}

              {draft && (
                <div className="rounded-lg border p-4 space-y-3">
                  <p className="font-medium">Confira e ajuste antes de aprovar {savedAt && <span className="ml-1 text-xs font-normal text-success-text">✓ Salvo às {savedAt} — pode atualizar a página sem perder</span>}</p>
                  <p className="text-xs text-muted-foreground">Pode escrever direto nas caixas ou clicar em <b>🎤 Falar</b> em qualquer uma delas: o que você falar entra no fim do texto.</p>
                  {draft.secoes && Object.entries(draft.secoes).map(([k, v]) => (
                    <div key={k} className="space-y-1">
                      <p className="text-xs font-medium">{SECTION_LABEL[k]?.[1] ? "🌐 " : "🔒 "}{SECTION_LABEL[k]?.[0] ?? k}</p>
                      <MicTextarea orgId={org.id} rows={4} value={v} onChange={(t) => setDraft({ ...draft, secoes: { ...draft.secoes!, [k]: t } })} />
                    </div>
                  ))}
                  {draft.setores && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium">Setores (cada um vira uma página de processos) — um por linha</p>
                      <Textarea rows={3} value={draft.setores.join("\n")}
                        onChange={(e) => setDraft({ ...draft, setores: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} />
                    </div>
                  )}
                  {draft.processos?.map((p, i) => (
                    <div key={i} className="rounded-md border p-3 space-y-2">
                      <Input value={p.nome} placeholder="Nome do processo" onChange={(e) => setDraft({ ...draft, processos: draft.processos!.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)) })} />
                      <MicTextarea orgId={org.id} rows={5} value={p.passo_a_passo ?? ""} placeholder="Passo a passo (como funciona hoje)"
                        onChange={(t) => setDraft({ ...draft, processos: draft.processos!.map((x, j) => (j === i ? { ...x, passo_a_passo: t } : x)) })} />
                      <MicTextarea orgId={org.id} rows={2} value={p.como_deveria ?? ""} placeholder="Como deveria funcionar (opcional)"
                        onChange={(t) => setDraft({ ...draft, processos: draft.processos!.map((x, j) => (j === i ? { ...x, como_deveria: t } : x)) })} />
                      <p className="text-xs text-muted-foreground">{[p.quem_faz && `Quem: ${p.quem_faz}`, p.tempo && `Tempo: ${p.tempo}`, p.dificuldade && `Trava: ${p.dificuldade}`].filter(Boolean).join(" · ")}</p>
                    </div>
                  ))}
                  {draft.faltando.length > 0 && (
                    <div className="text-sm rounded-md bg-amber-500/10 p-3">
                      <p className="font-medium text-xs mb-1">Pode completar (opcional): responda na caixa de cima e clique em Organizar de novo — ou use uma sugestão da IA. Não sabe? Pode deixar em branco e aprovar.</p>
                      <ul className="list-disc pl-5 space-y-2">{draft.faltando.map((f, i) => {
                        const it = typeof f === "string" ? { pergunta: f } : f;
                        const into = it.secao && draft.secoes && it.secao in draft.secoes ? it.secao : (draft.secoes ? Object.keys(draft.secoes)[0] : "");
                        return (
                          <li key={i}>
                            {it.pergunta}
                            {it.exemplo && <span className="block text-xs text-muted-foreground">Ex.: {it.exemplo}</span>}
                            {it.sugestao && (
                              <span className="mt-1 block rounded-md border border-primary/30 bg-background p-2 text-xs space-y-1">
                                <span className="block">💡 <b>Sugestão da IA</b> — você decide; clique na que gostar:</span>
                                {it.sugestao.split(" / ").map((op) => op.trim()).filter(Boolean).map((op) => (
                                  <span key={op} className="flex flex-wrap items-center gap-2">
                                    <span>“{op}”</span>
                                    {into && (
                                      <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-xs"
                                        onClick={() => setDraft({ ...draft, secoes: { ...draft.secoes!, [into]: `${(draft.secoes![into] ?? "").trim()}\n${it.pergunta.replace(/\?$/, "")}: ${op}`.trim() },
                                          faltando: draft.faltando.filter((_, j) => j !== i) })}>
                                        Usar esta
                                      </Button>
                                    )}
                                  </span>
                                ))}
                              </span>
                            )}
                          </li>
                        );
                      })}</ul>
                    </div>
                  )}
                  {page === "empresa" && (
                    <label className="flex items-start gap-2 text-xs">
                      <Switch checked={profile.use_in_ai} onCheckedChange={toggleAI} />
                      <span>A IA de atendimento usa as seções 🌐 para responder clientes. As 🔒 são internas e nunca vão para clientes.</span>
                    </label>
                  )}
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" onClick={() => { setDraft(null); void saveReview(page, null); }}>Cancelar</Button>
                    <Button disabled={busy === "approve"} onClick={approve}><Check className="w-4 h-4 mr-1" /> {busy === "approve" ? "Salvando..." : "Aprovar e seguir"}</Button>
                  </div>
                </div>
              )}
            </>
          )}

          {page === "plano" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="text-xl font-semibold flex items-center gap-2"><Target className="w-5 h-5" /> Planejamento estratégico
                  <span className="hidden print:inline font-normal">— {org.name}</span></h1>
                <div className="flex gap-2 print:hidden">
                  {hasPlan && <Button variant="outline" onClick={() => window.print()} title="Abre a impressão: escolha Salvar como PDF"><FileText className="w-4 h-4 mr-1" /> PDF</Button>}
                  <Button disabled={busy === "plan" || !readyForPlan} onClick={makePlan}>
                    <Sparkles className="w-4 h-4 mr-1" /> {busy === "plan" ? "Analisando..." : hasPlan ? "Gerar de novo" : "Gerar planejamento"}
                  </Button>
                </div>
              </div>
              {!readyForPlan && <p className="text-sm text-muted-foreground">Aprove ao menos Empresa, Setores e os processos de um setor para gerar o planejamento. Quanto mais etapas aprovadas, melhor o resultado.</p>}
              {outdated && <p className="text-sm rounded-md bg-amber-500/10 p-3">Etapas foram alteradas depois deste planejamento. Gere de novo para ele refletir a forma atual de trabalhar.</p>}
              {hasPlan && <PlanView plan={plan} suggestions={profile.suggestions} planAt={profile.plan_at} installing={installing}
                onInstall={async (i) => { const r = await install({ suggestion_index: i }, `s${i}`); if (r?.id) await load(); }}
                onOpen={(s) => navigate(s.instalado!.kind === "flow" ? `/fluxos/${s.instalado!.id}` : "/registros")}
                onGuide={async (i, s) => {
                  const r = await callFunction<{ guide_id: string }>("integrations", { action: "draft", organization_id: org.id, suggestion_index: i, system: s.sistema ?? "Sistema", goal: s.titulo });
                  if (!r.ok) return toast({ variant: "destructive", title: r.message });
                  navigate(`/integracoes?guia=${r.data.guide_id}`);
                }} />}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function ProcCard({ p }: { p: Proc }) {
  return (
    <div className="rounded-md border p-3 text-sm space-y-1">
      <p className="font-medium">{p.nome}</p>
      <p className="text-xs text-muted-foreground">{[p.quem_faz, p.frequencia, p.tempo].filter(Boolean).join(" · ")}</p>
      {p.passo_a_passo && <p className="whitespace-pre-wrap">{p.passo_a_passo}</p>}
      {p.como_deveria && <p className="whitespace-pre-wrap text-muted-foreground"><b>Como deveria:</b> {p.como_deveria}</p>}
      {p.dificuldade && <p className="text-xs text-muted-foreground">Onde trava: {p.dificuldade}</p>}
    </div>
  );
}

function PlanView({ plan, suggestions, planAt, installing, onInstall, onOpen, onGuide }: {
  plan: Plan; suggestions: Suggestion[]; planAt: string | null; installing: string | null;
  onInstall: (i: number) => void; onOpen: (s: Suggestion) => void; onGuide: (i: number, s: Suggestion) => void;
}) {
  return (
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
            const s = i < 12 ? suggestions[i] : undefined;
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
                {a.custo && <p className="text-xs">≈ {a.custo.volume.toLocaleString("pt-BR")} respostas/mês · Groq {brl(a.custo.groq)}/mês · {a.custo.claude_model} {brl(a.custo.claude)}/mês</p>}
                {s?.tipo === "pronta" && s.modelo && <span className="print:hidden">{s.instalado
                  ? <Button size="sm" variant="ghost" onClick={() => onOpen(s)}>Instalado — abrir rascunho</Button>
                  : <Button size="sm" variant="outline" disabled={!!installing} onClick={() => onInstall(i)}>{installing === `s${i}` ? "Instalando..." : "Instalar (rascunho)"}</Button>}</span>}
                {s?.tipo === "integracao" && <Button className="print:hidden" size="sm" variant="outline" disabled={!!installing} onClick={() => onGuide(i, s)}>Abrir guia de integração</Button>}
              </div>
            );
          })}
          {plan.custo && (
            <p className="text-xs rounded bg-muted p-2">
              <b>Custo mensal estimado da IA:</b> Groq {brl(plan.custo.groq_mes)} · Claude {brl(plan.custo.claude_mes)}. {plan.custo.premissas} Valores convertidos por estimativa; confira no painel do provedor.
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
      {planAt && <p className="text-xs text-muted-foreground">Gerado em {new Date(planAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}. Tudo instalado fica em rascunho para você revisar.</p>}
    </div>
  );
}
