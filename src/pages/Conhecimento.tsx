import { useCallback, useEffect, useMemo, useState } from "react";
import { FilePicker } from "@/components/FilePicker";
import { AppHeader } from "@/components/AppHeader";
import { Navigate, useNavigate } from "react-router-dom";
import { BookOpen, Download, LogOut, Search, Trash2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { Logo } from "@/components/Logo";
import { MainNav } from "@/components/MainNav";
import { NumberHealthBanner } from "@/components/NumberHealthBanner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ColorDot } from "@/components/ColorTag";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Doc {
  id: string; department_id: string | null; title: string; kind: string; visibility: string; file_name: string | null;
  size: number | null; status: string; error: string | null; chunks: number; created_at: string;
}
const KIND: Record<string, string> = {
  contrato: "Contrato", orcamento: "Orçamento", planilha: "Planilha", manual: "Manual", politica: "Política",
  script: "Script de atendimento", preco: "Tabela de preços", outro: "Outro",
};
const VIS: Record<string, [string, string]> = {
  interno: ["Interno", "Só orienta os agentes internos (diagnóstico, implementador, melhorias). Nunca aparece para o cliente."],
  atendimento: ["Atendimento", "A IA que conversa com o cliente também usa para responder."],
  enviavel: ["Pode ser enviado", "Além de orientar a IA, pode ser enviado como arquivo ao cliente."],
};
const ACCEPT = ".pdf,.docx,.xlsx,.csv,.txt,.md";

/** Base de conhecimento: documentos da empresa por setor, lidos e usados pelos agentes. */
export default function Conhecimento() {
  const { signOut, user } = useAuth();
  const { org, can } = useOrg();
  const { toast } = useToast();
  const navigate = useNavigate();
  const manage = can("org.settings");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [depts, setDepts] = useState<{ id: string; name: string; color: string | null }[]>([]);
  const [mine, setMine] = useState<string[]>([]);
  const [form, setForm] = useState({ title: "", kind: "outro", visibility: "interno", department: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<"interno" | "cliente">("cliente");
  const [results, setResults] = useState<{ title: string; content: string }[] | null>(null);

  const load = useCallback(async () => {
    if (!org || !user) return;
    const [d, dp, dm] = await Promise.all([
      supabase.from("knowledge_docs").select("id, department_id, title, kind, visibility, file_name, size, status, error, chunks, created_at")
        .eq("organization_id", org.id).order("created_at", { ascending: false }),
      supabase.from("departments").select("id, name, color").eq("organization_id", org.id).order("name"),
      supabase.from("department_members").select("department_id").eq("user_id", user.id),
    ]);
    setDocs((d.data as Doc[]) ?? []);
    setDepts(dp.data ?? []);
    setMine((dm.data ?? []).map((r) => r.department_id));
  }, [org, user]);
  useEffect(() => { void load(); }, [load]);

  // Setores em que a pessoa pode anexar: dono/admin em todos (e empresa toda); supervisor nos dele.
  const allowedDepts = useMemo(() => (manage ? depts : depts.filter((d) => mine.includes(d.id))), [manage, depts, mine]);
  useEffect(() => { if (!manage && !form.department && allowedDepts[0]) setForm((f) => ({ ...f, department: allowedDepts[0].id })); }, [manage, allowedDepts, form.department]);

  if (!org) return null;
  if (!manage && !can("library.manage")) return <Navigate to="/" replace />;

  const fail = (t: string) => toast({ variant: "destructive", title: t });
  const upload = async () => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return fail("Arquivo acima de 10 MB");
    setBusy("upload");
    const data = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1] ?? "");
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const r = await callFunction<{ status: string; chunks?: number; error?: string }>("knowledge", {
      action: "upload", organization_id: org.id, title: form.title || file.name.replace(/\.[^.]+$/, ""), kind: form.kind,
      visibility: form.visibility, department_id: form.department || null, file_name: file.name, mime: file.type, data,
    });
    setBusy(null);
    if (!r.ok) return fail(r.message);
    if (r.data.status === "failed") toast({ variant: "destructive", title: "Guardado, mas não consegui ler", description: r.data.error });
    else toast({ title: "Documento na base", description: `${r.data.chunks} trecho(s) prontos para os agentes.` });
    setFile(null);
    setForm((f) => ({ ...f, title: "" }));
    await load();
  };
  const act = async (action: string, d: Doc, extra: Record<string, unknown> = {}) => {
    const r = await callFunction<{ url?: string }>("knowledge", { action, organization_id: org.id, doc_id: d.id, ...extra });
    if (!r.ok) return fail(r.message);
    if (action === "link" && r.data.url) window.open(r.data.url, "_blank", "noopener");
    else await load();
  };
  const search = async () => {
    setBusy("search");
    const r = await callFunction<{ results: { title: string; content: string }[] }>("knowledge", { action: "search", organization_id: org.id, q, scope });
    setBusy(null);
    if (!r.ok) return fail(r.message);
    setResults(r.data.results);
  };

  const groups = [{ id: "", name: "Empresa toda", color: null as string | null }, ...depts]
    .map((g) => ({ ...g, docs: docs.filter((d) => (d.department_id ?? "") === g.id) }))
    .filter((g) => g.docs.length);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="conhecimento" />
      <NumberHealthBanner />

      <main className="flex-1 w-full max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><BookOpen className="w-6 h-6" /> Base de conhecimento</h1>
          <p className="text-sm text-muted-foreground">Contratos, orçamentos, planilhas, manuais e políticas por setor. Os agentes consultam só os trechos que importam para cada pergunta.</p>
        </div>

        <section className="rounded-lg border p-4 space-y-3">
          <p className="font-medium">Anexar documento</p>
          <FilePicker accept={ACCEPT} file={file} onFile={setFile} hint="PDF, Word (.docx), Excel (.xlsx), CSV ou texto, até 10 MB" />
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="Título (opcional)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
              {manage && <option value="">Empresa toda</option>}
              {allowedDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value })}>
              {Object.entries(VIS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>
          <p className="text-xs text-muted-foreground">{VIS[form.visibility][1]} Linhas com senha, token e números de cartão são removidas automaticamente. PDF, Word (.docx), Excel (.xlsx), CSV ou texto, até 10 MB.</p>
          <Button disabled={!file || busy === "upload" || (!manage && !form.department)} onClick={upload}>
            <Upload className="w-4 h-4 mr-1" /> {busy === "upload" ? "Lendo o documento..." : "Enviar para a base"}
          </Button>
        </section>

        <section className="space-y-4">
          {!groups.length && <p className="text-sm text-muted-foreground">Nenhum documento ainda.</p>}
          {groups.map((g) => (
            <div key={g.id || "empresa"} className="space-y-2">
              <p className="text-sm font-semibold flex items-center gap-2">{g.id && <ColorDot color={g.color} />}{g.name}</p>
              {g.docs.map((d) => (
                <div key={d.id} className="rounded-md border p-3 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{d.title}</span>
                  <Badge variant="outline">{KIND[d.kind] ?? d.kind}</Badge>
                  {d.status === "ready" && <span className="text-xs text-muted-foreground">{d.chunks} trecho(s)</span>}
                  {d.status === "failed" && <Badge variant="destructive" title={d.error ?? ""}>Não lido</Badge>}
                  {d.status === "processing" && <Badge variant="secondary">Lendo...</Badge>}
                  <div className="ml-auto flex items-center gap-1">
                    <select className="h-8 rounded-md border bg-background px-2 text-xs" value={d.visibility} title={VIS[d.visibility]?.[1]}
                      onChange={(e) => act("update", d, { visibility: e.target.value })}>
                      {Object.entries(VIS).map(([k, [label]]) => <option key={k} value={k}>{label}</option>)}
                    </select>
                    <Button size="icon" variant="ghost" title="Baixar" onClick={() => act("link", d)}><Download className="w-4 h-4" /></Button>
                    <Button size="icon" variant="ghost" title="Apagar" onClick={() => window.confirm(`Apagar "${d.title}" da base?`) && act("delete", d)}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                  {d.status === "failed" && d.error && <p className="w-full text-xs text-destructive">{d.error}</p>}
                </div>
              ))}
            </div>
          ))}
        </section>

        <section className="rounded-lg border p-4 space-y-3">
          <p className="font-medium">Testar a base</p>
          <div className="flex flex-wrap gap-2">
            <Input className="flex-1 min-w-[14rem]" placeholder="Pergunte como um cliente ou como a equipe (ex.: qual o prazo de instalação?)" value={q}
              onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && q.trim().length >= 3 && search()} />
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={scope} onChange={(e) => setScope(e.target.value as "interno" | "cliente")}>
              <option value="cliente">Como a IA de atendimento vê</option>
              <option value="interno">Como os agentes internos veem</option>
            </select>
            <Button variant="outline" disabled={busy === "search" || q.trim().length < 3} onClick={search}><Search className="w-4 h-4 mr-1" /> Buscar</Button>
          </div>
          {results && (results.length ? results.map((r, i) => (
            <div key={i} className="rounded-md bg-muted/50 p-2 text-sm"><p className="text-xs font-medium">{r.title}</p><p className="whitespace-pre-wrap">{r.content}</p></div>
          )) : <p className="text-sm text-muted-foreground">Nada encontrado para essa pergunta.</p>)}
        </section>
      </main>
    </div>
  );
}
