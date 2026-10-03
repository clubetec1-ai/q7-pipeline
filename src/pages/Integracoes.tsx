import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ExternalLink, LifeBuoy, LogOut, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { Logo } from "@/components/Logo";
import { MainNav } from "@/components/MainNav";
import { NumberHealthBanner } from "@/components/NumberHealthBanner";
import { ConnectorsPanel } from "./integracoes/ConnectorsPanel";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface Pair { key?: string; value?: string; path?: string; var?: string }
interface Config { method: string; url: string; headers: Pair[]; body: string; map: Pair[] }
interface GuideData {
  titulo: string; documentacao: string | null; passos_chave: string[]; campos: { path: string; var: string; descricao: string }[];
  mensagem: string; complexa: boolean; observacoes: string; segredo: string;
}
interface Guide { id: string; system: string; goal: string; title: string | null; guide: GuideData; config: Config; status: string; flow_id: string | null }
interface TestResult { ok: boolean; status: number | null; ms: number; error: string | null; body: string | null; paths: string[] }

const STATUS: Record<string, string> = { draft: "Rascunho", tested: "Testada", installed: "Fluxo criado" };
const EXAMPLES = [
  ["Bling", "Consultar o status do pedido pelo telefone do cliente"],
  ["Google Agenda", "Ver horários livres para agendar"],
  ["Meu ERP", "Enviar a segunda via do boleto"],
];

/** Integrações com outros sistemas: guia passo a passo + teste real + fluxo em rascunho. */
export default function Integracoes() {
  const { signOut, user } = useAuth();
  const { org, can } = useOrg();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { toast } = useToast();
  const [guides, setGuides] = useState<Guide[]>([]);
  const [current, setCurrent] = useState<string | null>(params.get("guia"));
  const [creating, setCreating] = useState<{ system: string; goal: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [msg, setMsg] = useState("");
  const [secretValue, setSecretValue] = useState("");
  const [phone, setPhone] = useState("");
  const [test, setTest] = useState<TestResult | null>(null);
  const [help, setHelp] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!org) return;
    const { data } = await supabase.from("integration_guides").select("id, system, goal, title, guide, config, status, flow_id")
      .eq("organization_id", org.id).order("created_at", { ascending: false });
    const list = (data as unknown as Guide[]) ?? [];
    setGuides(list);
    setCurrent((c) => c ?? list[0]?.id ?? null);
  }, [org]);
  useEffect(() => { void load(); }, [load]);

  const g = guides.find((x) => x.id === current) ?? null;
  useEffect(() => { setCfg(g ? g.config : null); setMsg(g?.guide?.mensagem ?? ""); setTest(null); setSecretValue(""); }, [g?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!org) return null;
  if (!can("org.settings")) return <Navigate to="/" replace />;

  const call = async <T,>(action: string, extra: Record<string, unknown>, tag: string) => {
    setBusy(tag);
    const r = await callFunction<T>("integrations", { action, organization_id: org.id, ...extra });
    setBusy(null);
    if (!r.ok) { toast({ variant: "destructive", title: r.message }); return null; }
    return r.data;
  };

  const create = async () => {
    if (!creating) return;
    const r = await call<{ guide_id: string }>("draft", creating, "draft");
    if (!r) return;
    setCreating(null);
    await load();
    setCurrent(r.guide_id);
  };
  const saveSecret = async () => {
    if (!g) return;
    const { error } = await supabase.rpc("set_http_secret", { org: org.id, secret_key: g.guide.segredo, secret_value: secretValue });
    if (error) return toast({ variant: "destructive", title: "Chave não salva", description: error.message });
    setSecretValue("");
    toast({ title: "Chave guardada no cofre", description: `O bloco usa {{segredo.${g.guide.segredo}}}; ela não aparece de novo.` });
  };
  const saveConfig = async () => {
    if (!g || !cfg) return;
    const r = await call<{ config: Config }>("update", { guide_id: g.id, config: cfg, mensagem: msg }, "save");
    if (r) { setCfg(r.config); toast({ title: "Configuração salva" }); void load(); }
  };
  const runTest = async () => {
    if (!g) return;
    await saveConfig();
    const r = await call<{ result: TestResult }>("test", { guide_id: g.id, phone }, "test");
    if (r) { setTest(r.result); void load(); }
  };
  const addField = (path: string) => {
    if (!cfg || cfg.map.some((m) => m.path === path)) return;
    const v = path.split(/[.[\]]/).filter(Boolean).pop()?.replace(/[^a-z0-9_]/gi, "_").toLowerCase() || "campo";
    setCfg({ ...cfg, map: [...cfg.map, { path, var: v }] });
  };
  const install = async () => {
    if (!g) return;
    await saveConfig();
    const r = await call<{ flow_id: string }>("install", { guide_id: g.id }, "install");
    if (r) { toast({ title: "Fluxo criado em rascunho", description: "Teste no simulador e publique quando estiver certo." }); navigate(`/fluxos/${r.flow_id}`); }
  };
  const remove = async () => {
    if (!g || !window.confirm("Apagar este guia? O fluxo criado (se houver) continua em Fluxos.")) return;
    await supabase.from("integration_guides").delete().eq("id", g.id);
    setCurrent(null);
    void load();
  };
  const askHelp = async () => {
    if (!help?.trim()) return;
    const { error } = await supabase.from("service_requests").insert({
      organization_id: org.id, guide_id: g?.id ?? null, topic: `Integração: ${g?.system ?? "sistema"}`.slice(0, 120), message: help.trim().slice(0, 2000), created_by: user?.id,
    });
    if (error) return toast({ variant: "destructive", title: "Pedido não enviado" });
    setHelp(null);
    toast({ title: "Pedido enviado ao time Clubetec", description: "Entraremos em contato para orçar a integração." });
  };

  const setPair = (list: "headers" | "map", i: number, patch: Pair) =>
    cfg && setCfg({ ...cfg, [list]: cfg[list].map((p, n) => (n === i ? { ...p, ...patch } : p)) });

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="integracoes" />
      <NumberHealthBanner />

      <main className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-6 grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-2">
          <Button className="w-full" onClick={() => setCreating({ system: "", goal: "" })}><Plus className="w-4 h-4 mr-1" /> Nova integração</Button>
          {guides.map((x) => (
            <button key={x.id} type="button" onClick={() => setCurrent(x.id)}
              className={`w-full text-left rounded-md border p-2 text-sm hover:bg-muted ${x.id === current ? "bg-muted" : ""}`}>
              <div className="font-medium truncate">{x.system}</div>
              <div className="text-xs text-muted-foreground truncate">{x.title ?? x.goal}</div>
              <Badge variant="outline" className="mt-1 text-[10px]">{STATUS[x.status] ?? x.status}</Badge>
            </button>
          ))}
          <Button variant="ghost" className="w-full" onClick={() => setHelp("")}><LifeBuoy className="w-4 h-4 mr-1" /> Pedir ajuda ao time Clubetec</Button>
        </aside>

        {!g || !cfg ? (
          <section className="text-sm text-muted-foreground space-y-4">
            <ConnectorsPanel orgId={org.id} />
            <h1 className="text-2xl font-semibold text-foreground">Integrações</h1>
            <p>Conecte o Deixa com a IA a outro sistema (ERP, agenda, loja) para a IA e os fluxos consultarem dados de verdade — por exemplo, o status do pedido pelo telefone do cliente.</p>
            <p>Clique em “Nova integração”: a IA monta o passo a passo, você guarda a chave, testa e cria o fluxo em rascunho.</p>
          </section>
        ) : (
          <section className="space-y-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h1 className="text-xl font-semibold">{g.guide.titulo}</h1>
                <p className="text-sm text-muted-foreground">{g.system} · {g.goal}</p>
              </div>
              <Button variant="ghost" size="icon" title="Apagar guia" onClick={remove}><Trash2 className="w-4 h-4" /></Button>
            </div>
            {g.guide.complexa && (
              <p className="rounded-md border border-amber-400 bg-amber-50 dark:bg-amber-950/30 p-2 text-sm">
                Esta integração parece mais complexa. Você pode tentar pelo guia ou <button className="underline" onClick={() => setHelp(`Quero ajuda para integrar ${g.system}: ${g.goal}`)}>pedir ao time Clubetec</button>.
              </p>
            )}
            {g.guide.observacoes && <p className="text-xs text-muted-foreground">Observação: {g.guide.observacoes}</p>}

            <div className="rounded-lg border p-4 space-y-2">
              <p className="font-semibold">1. Pegue a chave de acesso no {g.system}</p>
              <ol className="list-decimal pl-5 text-sm space-y-1">{g.guide.passos_chave.map((p, i) => <li key={i}>{p}</li>)}</ol>
              {g.guide.documentacao && (
                <a href={g.guide.documentacao} target="_blank" rel="noopener noreferrer" className="text-sm underline inline-flex items-center gap-1">
                  Documentação oficial <ExternalLink className="w-3 h-3" />
                </a>
              )}
              <p className="text-xs text-muted-foreground">Cole a chave só aqui (vai para o cofre; nunca cole em chat).</p>
              <div className="flex gap-2">
                <Input type="password" autoComplete="off" className="max-w-sm" placeholder={`Chave (fica como {{segredo.${g.guide.segredo}}})`}
                  value={secretValue} onChange={(e) => setSecretValue(e.target.value)} />
                <Button variant="outline" disabled={!secretValue} onClick={saveSecret}>Guardar chave</Button>
              </div>
            </div>

            <div className="rounded-lg border p-4 space-y-2">
              <p className="font-semibold">2. Endereço da API (sugerido pela IA — confira na documentação)</p>
              <div className="flex gap-2">
                <select className="h-9 rounded-md border bg-background px-2 text-sm" value={cfg.method} onChange={(e) => setCfg({ ...cfg, method: e.target.value })}>
                  {["GET", "POST", "PUT", "PATCH"].map((m) => <option key={m}>{m}</option>)}
                </select>
                <Input value={cfg.url} placeholder="https://..." onChange={(e) => setCfg({ ...cfg, url: e.target.value })} />
              </div>
              <p className="text-xs text-muted-foreground">Cabeçalhos</p>
              {cfg.headers.map((h, i) => (
                <div key={i} className="flex gap-1">
                  <Input className="h-8 text-xs w-40" value={h.key ?? ""} onChange={(e) => setPair("headers", i, { key: e.target.value })} />
                  <Input className="h-8 text-xs" value={h.value ?? ""} onChange={(e) => setPair("headers", i, { value: e.target.value })} />
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCfg({ ...cfg, headers: cfg.headers.filter((_, n) => n !== i) })}><Trash2 className="w-4 h-4" /></Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => setCfg({ ...cfg, headers: [...cfg.headers, { key: "", value: "" }] })}>+ Cabeçalho</Button>
              {cfg.method !== "GET" && (
                <Textarea rows={3} className="font-mono text-xs" placeholder='{"telefone": "{telefone}"}' value={cfg.body} onChange={(e) => setCfg({ ...cfg, body: e.target.value })} />
              )}
              <Button size="sm" onClick={saveConfig} disabled={busy === "save"}>Salvar</Button>
            </div>

            <div className="rounded-lg border p-4 space-y-2">
              <p className="font-semibold">3. Testar de verdade</p>
              <p className="text-xs text-muted-foreground">Use um telefone de cliente que exista no sistema (com DDI 55). A chamada passa pela mesma proteção dos fluxos.</p>
              <div className="flex gap-2">
                <Input className="max-w-xs" placeholder="Telefone para teste (ex.: 5519999999999)" value={phone} onChange={(e) => setPhone(e.target.value)} />
                <Button onClick={runTest} disabled={!!busy}>{busy === "test" ? "Testando..." : "Testar agora"}</Button>
              </div>
              {test && (
                test.ok ? (
                  <div className="space-y-2">
                    <p className="text-sm text-green-600">✅ Respondeu (HTTP {test.status}, {test.ms} ms). Clique nos campos que quer usar:</p>
                    <div className="flex flex-wrap gap-1">
                      {test.paths.map((p) => <Button key={p} size="sm" variant="outline" className="h-7 text-xs font-mono" onClick={() => addField(p)}>{p}</Button>)}
                    </div>
                    <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-xs">{test.body}</pre>
                  </div>
                ) : <p className="text-sm text-destructive">❌ {test.error}{test.status ? ` (HTTP ${test.status})` : ""}. Confira a chave, o endereço e os cabeçalhos.</p>
              )}
              <p className="text-xs text-muted-foreground">Campos usados (vira {"{var.nome}"} na mensagem)</p>
              {cfg.map.map((m, i) => (
                <div key={i} className="flex gap-1 items-center">
                  <code className="text-xs flex-1 truncate">{m.path}</code>
                  <span className="text-xs">→</span>
                  <Input className="h-8 w-40 text-xs" value={m.var ?? ""} onChange={(e) => setPair("map", i, { var: e.target.value })} />
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCfg({ ...cfg, map: cfg.map.filter((_, n) => n !== i) })}><Trash2 className="w-4 h-4" /></Button>
                </div>
              ))}
            </div>

            <div className="rounded-lg border p-4 space-y-2">
              <p className="font-semibold">4. Resposta ao cliente e fluxo</p>
              <Textarea rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Seu pedido está {var.status}." />
              <p className="text-xs text-muted-foreground">Se o sistema não responder, o fluxo avisa o cliente e passa para um atendente. Tudo fica em rascunho para você testar no simulador e publicar.</p>
              <Button onClick={install} disabled={!!busy || g.status === "draft"}>
                {busy === "install" ? "Criando..." : g.flow_id ? "Criar outro fluxo" : "Criar fluxo (rascunho)"}
              </Button>
              {g.status === "draft" && <p className="text-xs text-muted-foreground">Teste no passo 3 antes de criar o fluxo.</p>}
              {g.flow_id && <Button variant="ghost" onClick={() => navigate(`/fluxos/${g.flow_id}`)}>Abrir fluxo criado</Button>}
            </div>
          </section>
        )}
      </main>

      <Dialog open={!!creating} onOpenChange={(o) => !o && setCreating(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova integração</DialogTitle>
            <DialogDescription>Diga qual sistema a empresa usa e o que quer automatizar. A IA monta o passo a passo.</DialogDescription>
          </DialogHeader>
          {creating && (
            <div className="space-y-2">
              <Input placeholder="Sistema (ex.: Bling, Omie, Google Agenda, meu ERP)" maxLength={80} value={creating.system} onChange={(e) => setCreating({ ...creating, system: e.target.value })} />
              <Textarea rows={3} maxLength={500} placeholder="O que você quer (ex.: consultar o status do pedido pelo telefone do cliente)" value={creating.goal} onChange={(e) => setCreating({ ...creating, goal: e.target.value })} />
              <div className="flex flex-wrap gap-1">
                {EXAMPLES.map(([s, goal]) => <Button key={s} size="sm" variant="outline" className="h-7 text-xs" onClick={() => setCreating({ system: s, goal })}>{s}</Button>)}
              </div>
            </div>
          )}
          <DialogFooter><Button onClick={create} disabled={busy === "draft" || !creating?.system.trim() || !creating?.goal.trim()}>{busy === "draft" ? "Montando o guia..." : "Montar guia"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={help !== null} onOpenChange={(o) => !o && setHelp(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pedir ajuda ao time Clubetec</DialogTitle>
            <DialogDescription>Para integrações mais complexas, nossa equipe faz para você (serviço orçado à parte).</DialogDescription>
          </DialogHeader>
          <Textarea rows={4} maxLength={2000} placeholder="O que você precisa integrar e para quê" value={help ?? ""} onChange={(e) => setHelp(e.target.value)} />
          <DialogFooter><Button onClick={askHelp} disabled={!help?.trim()}>Enviar pedido</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
