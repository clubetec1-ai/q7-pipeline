import { useCallback, useEffect, useState } from "react";
import { Activity, Check, ClipboardCopy, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { callFunction } from "@/lib/callFunction";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

type Status = "aberto" | "proposta" | "aprovado" | "resolvido" | "ignorado";
interface Diag {
  hipotese: string; evidencias: string[]; tipo: string; plano: string[]; arquivos: string[]; testes: string[]; risco: string; verificar: string;
  tarefa?: string; equipe_nome?: string; at?: string;
}
interface Incident {
  id: string; kind: string; equipe: string; gravidade: "baixa" | "media" | "alta" | "critica"; titulo: string; empresas: number; ocorrencias: number;
  pico: number; evidencia: Record<string, unknown>; status: Status; diagnostico: Diag | null;
  revisao: { status: string; achados: { quem: string; texto: string }[] } | null; nota: string | null; first_seen: string; last_seen: string; resolved_at: string | null;
}

/** Mesmo organograma de supabase/functions/_shared/platform-brain.ts (TEAMS). */
const TEAMS: Record<string, { diretor: string; equipe: string }> = {
  engenharia_back: { diretor: "Diretor de Engenharia (IA)", equipe: "Back-end e banco (IA)" },
  engenharia_front: { diretor: "Diretor de Engenharia (IA)", equipe: "Front-end (IA)" },
  integracoes: { diretor: "Diretor de Engenharia (IA)", equipe: "Integrações (IA)" },
  seguranca: { diretor: "Diretor de Segurança e LGPD (IA)", equipe: "Guardião da plataforma e Auditor de isolamento (IA)" },
  qualidade: { diretor: "Diretor de Qualidade (IA)", equipe: "Testes (QA) e Monitor de saúde (IA)" },
  design: { diretor: "Diretor de Design e Experiência (IA)", equipe: "UX, guias e vídeos (IA)" },
  suporte: { diretor: "Diretor de Operações e Suporte (IA)", equipe: "Triagem de chamados e base de conhecimento (IA)" },
  custos: { diretor: "Analista de custos (IA)", equipe: "Analista de custos (IA)" },
};
const GRAV: Record<Incident["gravidade"], { label: string; cls: string }> = {
  critica: { label: "Crítica", cls: "bg-danger-soft text-danger-text" },
  alta: { label: "Alta", cls: "bg-warning-soft text-warning-text" },
  media: { label: "Média", cls: "bg-info-soft text-info-text" },
  baixa: { label: "Baixa", cls: "bg-muted text-muted-foreground" },
};
const STATUS: Record<Status, string> = {
  aberto: "Aberto", proposta: "Proposta para aprovar", aprovado: "Correção aprovada (verificando)", resolvido: "Resolvido", ignorado: "Ignorado por 7 dias",
};
const when = (s: string) => new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * Plataforma → Saúde (só a Clubetec; desenho 07 §12, fatia 11): o vigia transforma sinais (só metadados) em incidentes a
 * cada 15 min; a equipe de IA dona diagnostica e propõe; o Guardião da plataforma e o QA revisam por regra; um operador
 * aprova. A correção de código sai como tarefa para o desenvolvimento (branch, testes, revisão). O vigia marca resolvido
 * quando o sinal para.
 */
export function PlatformHealthPanel() {
  const { toast } = useToast();
  const [rows, setRows] = useState<Incident[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [nota, setNota] = useState<Record<string, string>>({});
  const [verTodos, setVerTodos] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("platform_incidents")
      .select("id, kind, equipe, gravidade, titulo, empresas, ocorrencias, pico, evidencia, status, diagnostico, revisao, nota, first_seen, last_seen, resolved_at")
      .order("last_seen", { ascending: false }).limit(100);
    if (error) return toast({ variant: "destructive", title: "Não carregou", description: error.message });
    setRows((data as unknown as Incident[]) ?? []);
  }, [toast]);
  useEffect(() => { void load(); }, [load]);

  const diagnose = async (i: Incident) => {
    setBusy(`d:${i.id}`);
    const r = await callFunction<{ status: string }>("platform-brain", { action: "diagnose", incident_id: i.id });
    setBusy(null);
    if (!r.ok) return toast({ variant: "destructive", title: "Sem diagnóstico", description: r.message });
    toast({ title: r.data.status === "proposta" ? "Proposta pronta para você aprovar" : "A revisão barrou a proposta", description: "Veja o diagnóstico abaixo." });
    setOpen(i.id);
    void load();
  };
  const decide = async (i: Incident, decisao: "aprovar" | "ignorar" | "reabrir" | "resolver") => {
    setBusy(`x:${i.id}`);
    const { error } = await supabase.rpc("platform_incident_decide", { p_id: i.id, p_decisao: decisao, p_nota: nota[i.id] ?? null });
    setBusy(null);
    if (error) return toast({ variant: "destructive", title: "Não salvo", description: error.message });
    toast({ title: { aprovar: "Correção aprovada", ignorar: "Ignorado por 7 dias", reabrir: "Reaberto", resolver: "Marcado como resolvido" }[decisao] });
    void load();
  };
  const copy = async (t: string) => {
    try { await navigator.clipboard.writeText(t); toast({ title: "Tarefa copiada", description: "Cole no Claude Code ou no repositório (trabalhe em branch, com testes)." }); }
    catch { toast({ variant: "destructive", title: "Não consegui copiar" }); }
  };

  if (!rows) return <Loader2 className="w-5 h-5 animate-spin" />;
  const ativos = rows.filter((r) => r.status === "aberto" || r.status === "proposta" || r.status === "aprovado");
  const lista = verTodos ? rows : ativos;
  const porEquipe = Object.keys(TEAMS).map((k) => ({ k, n: ativos.filter((r) => r.equipe === k).length }));

  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-card p-4 space-y-2">
        <h2 className="font-semibold flex items-center gap-2"><Activity className="w-4 h-4" /> Saúde da plataforma</h2>
        <p className="text-xs text-muted-foreground">
          A cada 15 minutos o vigia lê os sinais de todas as empresas (só números e códigos de erro, nunca conversas) e abre um incidente
          para a equipe de IA dona. A IA diagnostica e propõe; o Guardião da plataforma e o QA revisam por regra; <b>nada é publicado sem a
          sua aprovação</b> — correção de código vira tarefa para o desenvolvimento, com testes. Quando o sinal para por 6 horas, o
          incidente fecha sozinho.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {porEquipe.map(({ k, n }) => (
            <div key={k} className="rounded-md border p-2 text-xs">
              <p className="font-medium">{TEAMS[k].equipe}</p>
              <p className="text-muted-foreground">{TEAMS[k].diretor}</p>
              <p className={n ? "text-warning-text" : "text-success-text"}>{n ? `${n} incidente(s) em aberto` : "Tudo certo"}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="flex items-center justify-between">
        <p className="text-sm">{ativos.length} incidente(s) em aberto</p>
        <Button size="sm" variant="ghost" onClick={() => setVerTodos(!verTodos)}>{verTodos ? "Só os em aberto" : "Ver também resolvidos e ignorados"}</Button>
      </div>
      {lista.length === 0 && <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Nenhum incidente {verTodos ? "" : "em aberto"}.</p>}
      {lista.map((i) => {
        const d = i.diagnostico;
        const isOpen = open === i.id;
        return (
          <section key={i.id} className="rounded-xl border bg-card p-3 space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={GRAV[i.gravidade].cls}>{GRAV[i.gravidade].label}</Badge>
              <b className="mr-auto">{i.titulo}</b>
              <Badge variant="outline">{STATUS[i.status]}</Badge>
              <Button size="sm" variant="ghost" onClick={() => setOpen(isOpen ? null : i.id)}>{isOpen ? "Fechar" : "Detalhes"}</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {TEAMS[i.equipe]?.equipe ?? i.equipe} · {i.ocorrencias} ocorrência(s) na janela (pico {i.pico}) · {i.empresas} empresa(s) ·
              desde {when(i.first_seen)} · último sinal {when(i.last_seen)}
            </p>
            {isOpen && (
              <div className="space-y-2 border-t pt-2">
                <p className="text-xs"><b>Evidência (só metadados):</b> <code className="break-all">{JSON.stringify(i.evidencia)}</code></p>
                {d && (
                  <div className="rounded-md bg-muted/50 p-2 space-y-1">
                    <p><b>Diagnóstico ({d.equipe_nome ?? "equipe"}):</b> {d.hipotese}</p>
                    {d.evidencias.length > 0 && <ul className="list-disc pl-5 text-xs">{d.evidencias.map((e, k) => <li key={k}>{e}</li>)}</ul>}
                    <p className="text-xs"><b>Plano ({d.tipo}):</b></p>
                    <ol className="list-decimal pl-5 text-xs">{d.plano.map((p, k) => <li key={k}>{p}</li>)}</ol>
                    {d.testes.length > 0 && <p className="text-xs"><b>Testes:</b> {d.testes.join(" · ")}</p>}
                    {d.verificar && <p className="text-xs"><b>Verificação:</b> {d.verificar}</p>}
                    {d.risco && <p className="text-xs"><b>Risco:</b> {d.risco}</p>}
                  </div>
                )}
                {i.revisao && (
                  <p className={`text-xs flex items-start gap-1 ${i.revisao.status === "reprovado" ? "text-danger-text" : "text-success-text"}`}>
                    <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    {i.revisao.status === "reprovado"
                      ? <>Revisão barrou a proposta: {i.revisao.achados.map((a) => `${a.quem === "qa" ? "QA" : "Guardião"} — ${a.texto}`).join(" · ")}. Peça um novo diagnóstico.</>
                      : <>Guardião da plataforma e QA: sem problema nas regras fixas.</>}
                  </p>
                )}
                {i.nota && <p className="text-xs"><b>Nota / aprendizado:</b> {i.nota}</p>}
                <div className="flex flex-wrap gap-2">
                  {(i.status === "aberto" || i.status === "proposta") && (
                    <Button size="sm" variant={d ? "outline" : "default"} disabled={!!busy} onClick={() => void diagnose(i)}>
                      {busy === `d:${i.id}` ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
                      {d ? "Diagnosticar de novo" : "Diagnosticar com a IA"}
                    </Button>
                  )}
                  {i.status === "proposta" && (
                    <Button size="sm" disabled={!!busy} onClick={() => void decide(i, "aprovar")}><Check className="w-4 h-4 mr-1" /> Aprovar correção</Button>
                  )}
                  {d?.tarefa && (i.status === "proposta" || i.status === "aprovado") && (
                    <Button size="sm" variant="outline" onClick={() => void copy(d.tarefa!)}><ClipboardCopy className="w-4 h-4 mr-1" /> Copiar tarefa para o desenvolvimento</Button>
                  )}
                  {i.status !== "resolvido" && i.status !== "ignorado" && (
                    <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void decide(i, "ignorar")}>Ignorar por 7 dias</Button>
                  )}
                  {(i.status === "resolvido" || i.status === "ignorado") && (
                    <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void decide(i, "reabrir")}>Reabrir</Button>
                  )}
                </div>
                {i.status !== "resolvido" && i.status !== "ignorado" && (
                  <div className="space-y-1">
                    <Textarea rows={2} maxLength={2000} value={nota[i.id] ?? ""} onChange={(e) => setNota({ ...nota, [i.id]: e.target.value })}
                      placeholder="O que foi feito e o que se aprendeu (ex.: virou teste de regressão no grupo 112; guia novo na tela X)." />
                    <Button size="sm" variant="outline" disabled={!!busy || (nota[i.id] ?? "").trim().length < 5} onClick={() => void decide(i, "resolver")}>Marcar resolvido</Button>
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
