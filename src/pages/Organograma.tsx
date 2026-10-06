import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, Loader2, Network, Pause, Play, Tag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { HowItWorks } from "./diagnostico/HowItWorks";
import { ProofPanel } from "./organograma/ProofPanel";
import { GuardianBadge, GuardianFindings, type GuardianReview } from "@/components/GuardianBadge";

type Level = "cerebro" | "diretor" | "coordenador" | "especialista" | "executor" | "apoio";
interface Agent {
  id: string; key: string; level: Level; parent_id: string | null; papel: string; apelido: string | null;
  cracha: { dados: string[]; acoes: string[] }; autonomia: "A0" | "A1" | "A2" | "A3" | "A4"; status: "proposto" | "ativo" | "pausado"; version: number;
}

const DADOS: Record<string, string> = {
  numeros_agregados: "números da área (sem nomes de pessoas)", diagnostico: "o Diagnóstico aprovado", processos: "os processos do setor",
  base_conhecimento: "a base de conhecimento", avaliacoes_anonimas: "avaliações dos atendimentos (sem nomes)", conversa_em_andamento: "só a conversa que está atendendo",
};
const ACOES: Record<string, string> = {
  delegar: "delegar tarefas", cobrar: "cobrar o que está parado", revisar: "revisar e apontar problemas", propor_melhoria: "sugerir melhorias",
  pedir_informacao: "pedir informação", preparar_rascunho: "preparar rascunhos", responder_cliente: "responder o cliente",
  passar_para_pessoa: "passar para uma pessoa", enviar_modelo: "enviar mensagens prontas", agendar: "agendar",
};
const AUTONOMIA: Record<Agent["autonomia"], string> = {
  A0: "Só observa", A1: "Sugere — você decide", A2: "Prepara rascunho", A3: "Executa com aprovação", A4: "Executa sozinho (com limite)",
};
const LEVEL: Record<Level, { label: string; cls: string }> = {
  cerebro: { label: "Cérebro", cls: "border-primary bg-primary/5" },
  diretor: { label: "Diretor", cls: "border-info bg-info-soft/40" },
  coordenador: { label: "Coordenador", cls: "border-border" },
  especialista: { label: "Especialista", cls: "border-border" },
  executor: { label: "Atende clientes", cls: "border-warning bg-warning-soft/40" },
  apoio: { label: "Equipe de apoio", cls: "border-dashed" },
};
const nameOf = (a: Agent) => (a.apelido ? `${a.apelido} — ${a.papel}` : a.papel);

/**
 * Time de IA (desenho 07, fatia 4): o organograma de agentes da empresa, montado pelo cérebro por regra a
 * partir dos setores e dos processos aprovados. O dono aprova, pausa, dá apelido e ajusta a autonomia; o
 * responsável de área vê os agentes do seu setor. Executar sozinho só depois da prova (fatia 6).
 */
export default function Organograma() {
  const { org, can } = useOrg();
  const { toast } = useToast();
  const owner = can("org.settings");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [label, setLabel] = useState<Record<string, string>>({});
  const [guard, setGuard] = useState<Map<string, GuardianReview>>(new Map());

  const load = useCallback(async () => {
    if (!org) return;
    const [{ data }, { data: g }] = await Promise.all([
      supabase.from("ai_agents").select("id, key, level, parent_id, papel, apelido, cracha, autonomia, status, version").eq("organization_id", org.id).order("papel"),
      supabase.from("guardian_reviews").select("subject_id, status, findings").eq("organization_id", org.id).eq("subject_type", "agente"),
    ]);
    setAgents((data as unknown as Agent[]) ?? []);
    setGuard(new Map(((g as unknown as GuardianReview[]) ?? []).map((x) => [x.subject_id, x])));
    setLoaded(true);
  }, [org]);
  useEffect(() => { void load(); }, [load]);

  const children = useMemo(() => {
    const m = new Map<string | null, Agent[]>();
    const ids = new Set(agents.map((a) => a.id));
    for (const a of agents) {
      const p = a.parent_id && ids.has(a.parent_id) ? a.parent_id : null; // pai que a pessoa não vê: mostra na raiz
      m.set(p, [...(m.get(p) ?? []), a]);
    }
    return m;
  }, [agents]);
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const propostos = agents.filter((a) => a.status === "proposto").length;
  // Portão do Guardião (fatia 5): proposto sem revisão ou reprovado trava a aprovação do time.
  const travados = agents.filter((a) => a.status === "proposto" && (!guard.get(a.id) || guard.get(a.id)?.status === "reprovado")).length;

  const propose = async () => {
    if (!org) return;
    setBusy("propose");
    const r = await callFunction<{ agents: number; propostos: number }>("orgchart", { action: "propose", organization_id: org.id });
    setBusy(null);
    if (!r.ok) return toast({ variant: "destructive", title: "Não montei o time", description: r.message });
    toast({ title: "Time montado", description: `${r.data.agents} agente(s); ${r.data.propostos} para você aprovar.` });
    void load();
  };
  const approveAll = async () => {
    if (!org) return;
    setBusy("approve");
    const { error } = await supabase.rpc("approve_org_chart", { org: org.id });
    setBusy(null);
    if (error) return toast({ variant: "destructive", title: "Não aprovado", description: error.message });
    toast({ title: "Time aprovado", description: "Todos começam só sugerindo: você decide o que vai para o cliente." });
    void load();
  };
  const rpc = async (fn: "set_agent_status" | "set_agent_label" | "set_agent_autonomy", args: Record<string, unknown>, id: string) => {
    setBusy(id);
    const { error } = await supabase.rpc(fn as never, args as never);
    setBusy(null);
    if (error) return toast({ variant: "destructive", title: "Não salvo", description: error.message });
    void load();
  };

  // Função (não componente): o campo de apelido não perde o foco ao digitar.
  const renderNode = (a: Agent, depth: number): JSX.Element => {
    const kids = children.get(a.id) ?? [];
    const parent = a.parent_id ? byId.get(a.parent_id) : undefined;
    const talks = [parent ? nameOf(parent) : null, ...kids.map(nameOf)].filter(Boolean) as string[];
    return (
      <li key={a.id} className="space-y-2">
        <div data-demo={`agente-${a.level}`} className={`rounded-lg border p-3 space-y-1.5 text-sm ${LEVEL[a.level].cls} ${a.status === "pausado" ? "opacity-60" : ""}`}>
          <div className="flex flex-wrap items-center gap-2">
            <b className="mr-auto">{nameOf(a)}</b>
            <Badge variant="outline">{LEVEL[a.level].label}</Badge>
            {a.status === "proposto" && <Badge className="bg-warning-soft text-warning-text">Para aprovar</Badge>}
            {a.status === "pausado" && <Badge variant="outline">Pausado</Badge>}
            {guard.get(a.id)?.status !== "aprovado" && <GuardianBadge review={guard.get(a.id)} />}
          </div>
          <GuardianFindings review={guard.get(a.id)} />
          {owner && org && a.level === "executor" && a.status !== "proposto" && <ProofPanel orgId={org.id} agentId={a.id} />}
          <p className="text-xs"><b>Vê:</b> {a.cracha.dados.map((d) => DADOS[d] ?? d).join(", ") || "nada"}</p>
          <p className="text-xs"><b>Faz:</b> {a.cracha.acoes.map((d) => ACOES[d] ?? d).join(", ") || "só acompanha"}</p>
          {talks.length > 0 && <p className="text-xs text-muted-foreground"><b>Fala com:</b> {talks.join(" · ")}</p>}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span><b>Autonomia:</b></span>
            {owner ? (
              <select data-demo="autonomia" className="h-7 rounded border bg-background px-1" value={a.autonomia} disabled={busy === a.id}
                onChange={(e) => void rpc("set_agent_autonomy", { p_id: a.id, p_autonomia: e.target.value }, a.id)}>
                {(["A0", "A1", "A2"] as const).map((k) => <option key={k} value={k}>{AUTONOMIA[k]}</option>)}
                <option value="A3" disabled={a.level !== "executor"}>{AUTONOMIA.A3}{a.level === "executor" ? " (precisa da prova em dia)" : " — só quem atende"}</option>
                {a.level === "executor" && <option value="A4" disabled>{AUTONOMIA.A4} — depois da prova</option>}
              </select>
            ) : <span>{AUTONOMIA[a.autonomia]}</span>}
            {owner && a.status !== "proposto" && (
              <Button size="sm" variant="ghost" className="h-7 px-2" data-demo="btn-pausar" disabled={busy === a.id}
                onClick={() => void rpc("set_agent_status", { p_id: a.id, p_status: a.status === "ativo" ? "pausado" : "ativo" }, a.id)}>
                {a.status === "ativo" ? <><Pause className="w-3 h-3 mr-1" /> Pausar</> : <><Play className="w-3 h-3 mr-1" /> Ligar</>}
              </Button>
            )}
            {owner && (
              <span className="flex items-center gap-1">
                <Input className="h-7 w-32 text-xs" maxLength={40} placeholder="Apelido (opcional)" value={label[a.id] ?? a.apelido ?? ""}
                  onChange={(e) => setLabel({ ...label, [a.id]: e.target.value })} />
                {(label[a.id] ?? a.apelido ?? "") !== (a.apelido ?? "") && (
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => void rpc("set_agent_label", { p_id: a.id, p_apelido: label[a.id] }, a.id)}>
                    <Tag className="w-3 h-3 mr-1" /> Salvar
                  </Button>
                )}
              </span>
            )}
          </div>
        </div>
        {kids.length > 0 && (
          <ul className={`space-y-2 border-l pl-3 ${depth < 4 ? "ml-3" : ""}`}>
            {kids.filter((k) => k.level !== "apoio").map((k) => renderNode(k, depth + 1))}
            {kids.some((k) => k.level === "apoio") && (
              <li>
                <details className="rounded-lg border border-dashed p-2 text-sm" data-demo="apoio">
                  <summary className="cursor-pointer text-xs"><b>Equipe de apoio</b> ({kids.filter((k) => k.level === "apoio").length}): Analista de Diagnóstico, Revisor, Arquiteto, Implementador, Guardião, Auditor, Analista de dados</summary>
                  <ul className="mt-2 space-y-2">{kids.filter((k) => k.level === "apoio").map((k) => renderNode(k, depth + 1))}</ul>
                </details>
              </li>
            )}
          </ul>
        )}
      </li>
    );
  };

  const roots = children.get(null) ?? [];
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="configuracoes" />
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-6 sm:px-6 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <Link to="/configuracoes" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"><ArrowLeft className="w-4 h-4" /> Configurações</Link>
            <h1 className="font-brand text-2xl leading-tight mt-1">Time de IA</h1>
            <p className="text-sm text-muted-foreground max-w-3xl">
              Os agentes de IA da empresa organizados como uma equipe: o <b>cérebro</b> no topo, ao seu lado; abaixo, diretores, coordenadores,
              especialistas (um por processo aprovado) e quem atende os clientes. Cada um só vê e faz o que está no seu crachá.
              Todos começam só <b>sugerindo</b>: você decide.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <HowItWorks guide="organograma" className="" />
            <Button asChild variant="outline"><Link to="/processos">Processos</Link></Button>
            {owner && (
              <Button variant="outline" data-demo="btn-montar" disabled={!!busy} onClick={() => void propose()}>
                {busy === "propose" ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Network className="w-4 h-4 mr-1" />}
                {agents.length ? "Atualizar o time" : "Montar o time com o cérebro"}
              </Button>
            )}
            {owner && propostos > 0 && (
              <Button data-demo="btn-aprovar-time" disabled={!!busy || travados > 0}
                title={travados ? `${travados} agente(s) sem revisão ou reprovados pelo Guardião: clique em Atualizar o time` : undefined}
                onClick={() => void approveAll()}>
                <Check className="w-4 h-4 mr-1" /> Aprovar o time ({propostos})
              </Button>
            )}
          </div>
        </div>

        {!loaded ? <Loader2 className="w-5 h-5 animate-spin" /> : agents.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            {owner ? <>Ainda não há time. Clique em <b>Montar o time com o cérebro</b>. Dica: aprove os processos em <Link to="/processos" className="underline">Processos</Link> antes — cada processo aprovado ganha um especialista.</>
              : "Ainda não há agentes no seu setor."}
          </p>
        ) : (
          <ul className="space-y-2">{roots.map((a) => renderNode(a, 0))}</ul>
        )}
      </main>
    </div>
  );
}
