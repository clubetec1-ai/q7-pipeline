import { useCallback, useEffect, useState } from "react";
import { FlaskConical, Loader2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MicTextarea } from "@/components/MicTextarea";

interface Eval { id: string; tipo: string; mensagem: string; contexto: string; esperado: string; origem: string; ativo: boolean }
interface Run { eval_id: string; passou: boolean; motivo: string; reply: string; ran_at: string }
interface Status { ok: boolean; total: number; passou: number; vencida: boolean }

const TIPO: Record<string, string> = {
  pergunta_comum: "Pergunta comum", excecao: "Caso diferente", fora_do_horario: "Fora do horário", reclamacao: "Reclamação",
  pedido_proibido: "Pedido proibido", tentativa_de_burla: "Tentativa de burla", dado_de_outro_cliente: "Dado de outro cliente", personalizado: "Seu cenário",
};

/**
 * Prova do agente que atende (desenho 07, fatia 6): 7 cenários obrigatórios (+ os do dono), rodados em modo
 * teste com a mesma montagem do atendimento real. Sem prova em dia, o agente não executa (A3).
 */
export function ProofPanel({ orgId, agentId }: { orgId: string; agentId: string }) {
  const { toast } = useToast();
  const [evals, setEvals] = useState<Eval[]>([]);
  const [runs, setRuns] = useState<Map<string, Run>>(new Map());
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [novo, setNovo] = useState({ mensagem: "", esperado: "" });

  const load = useCallback(async () => {
    const [{ data: e }, { data: st }] = await Promise.all([
      supabase.from("agent_evals").select("id, tipo, mensagem, contexto, esperado, origem, ativo").eq("organization_id", orgId).eq("agent_id", agentId).order("created_at"),
      supabase.rpc("agent_proof_status", { p_agent: agentId }),
    ]);
    const list = (e as Eval[]) ?? [];
    setEvals(list);
    setStatus((st as unknown as Status) ?? null);
    if (list.length) {
      const { data: r } = await supabase.from("agent_eval_runs").select("eval_id, passou, motivo, reply, ran_at")
        .eq("organization_id", orgId).in("eval_id", list.map((x) => x.id)).order("ran_at", { ascending: false }).limit(200);
      const m = new Map<string, Run>();
      for (const x of (r as Run[]) ?? []) if (!m.has(x.eval_id)) m.set(x.eval_id, x);
      setRuns(m);
    }
  }, [orgId, agentId]);
  useEffect(() => { void load(); }, [load]);

  const generate = async () => {
    setBusy("gen");
    const r = await callFunction<{ cenarios: number }>("proof", { action: "generate", organization_id: orgId, agent_id: agentId });
    setBusy(null);
    if (!r.ok) return toast({ variant: "destructive", title: "Não gerei os cenários", description: r.message });
    toast({ title: "Cenários prontos", description: `${r.data.cenarios} cenários. Agora clique em Rodar a prova.` });
    void load();
  };
  const runAll = async () => {
    const ativos = evals.filter((e) => e.ativo);
    setBusy("run");
    let ok = 0;
    for (const [i, e] of ativos.entries()) {
      setProgress(`${i + 1} de ${ativos.length}: ${TIPO[e.tipo] ?? e.tipo}…`);
      const r = await callFunction<{ passou: boolean }>("proof", { action: "run_one", organization_id: orgId, eval_id: e.id });
      if (!r.ok) { toast({ variant: "destructive", title: "A prova parou", description: r.message }); break; }
      if (r.data.passou) ok++;
    }
    setBusy(null); setProgress("");
    toast({ title: `Prova: ${ok} de ${ativos.length} passaram`, description: ok === ativos.length ? "Agente aprovado na prova." : "Veja o motivo dos que não passaram e ajuste o comportamento, a base ou o processo." });
    void load();
  };
  const addCustom = async () => {
    setBusy("add");
    const { error } = await supabase.rpc("add_custom_eval", { p_agent: agentId, p_mensagem: novo.mensagem, p_esperado: novo.esperado });
    setBusy(null);
    if (error) return toast({ variant: "destructive", title: "Não salvei o cenário", description: error.message });
    setNovo({ mensagem: "", esperado: "" });
    void load();
  };

  const label = !status ? "" : status.ok ? `✓ Prova em dia: ${status.passou} de ${status.total}` : status.vencida ? "⚠️ Prova vencida (algo mudou): rode de novo" : evals.length ? `${status.passou} de ${status.total} passaram` : "Sem prova ainda";
  return (
    <details data-demo="prova" className="rounded-md border p-2 text-xs" open={!status?.ok && evals.length > 0}>
      <summary className="cursor-pointer list-none">
        🧪 <b>Prova</b> <span className={status?.ok ? "text-success-text" : "text-warning-text"}>{label}</span>
      </summary>
      <div className="mt-2 space-y-2">
        <p className="text-muted-foreground">Cenários de teste em modo seguro (nada vai para cliente). O agente responde como no atendimento de verdade, e a resposta é conferida por regras fixas e por um avaliador. Só passa com os dois de acordo.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void generate()}>
            {busy === "gen" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}{evals.length ? "Gerar os cenários de novo" : "Gerar os cenários"}
          </Button>
          {evals.length > 0 && (
            <Button size="sm" data-demo="btn-rodar" disabled={!!busy} onClick={() => void runAll()}>
              {busy === "run" ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <FlaskConical className="w-3 h-3 mr-1" />} Rodar a prova
            </Button>
          )}
          {progress && <span className="text-muted-foreground">{progress}</span>}
        </div>
        <ul className="space-y-1.5">
          {evals.filter((e) => e.ativo).map((e) => {
            const r = runs.get(e.id);
            return (
              <li key={e.id} className="rounded border p-2">
                <span className="flex flex-wrap items-center gap-1">
                  <b>{TIPO[e.tipo] ?? e.tipo}</b>
                  {r ? <span className={r.passou ? "text-success-text" : "text-danger-text"}>{r.passou ? "✓ passou" : "✗ não passou"}</span> : <span className="text-muted-foreground">não rodou</span>}
                </span>
                <span className="block">Cliente: “{e.mensagem}”{e.contexto ? ` (${e.contexto})` : ""}</span>
                <span className="block text-muted-foreground">Esperado: {e.esperado}</span>
                {r && (
                  <details className="mt-1">
                    <summary className="cursor-pointer">Ver a resposta e o motivo</summary>
                    <span className="block whitespace-pre-wrap rounded bg-muted p-1">{r.reply || "(sem resposta)"}</span>
                    {r.motivo && <span className="block">Motivo: {r.motivo}</span>}
                  </details>
                )}
              </li>
            );
          })}
        </ul>
        {evals.length > 0 && (
          <div className="space-y-1 rounded border border-dashed p-2">
            <p className="font-medium">Acrescentar um cenário seu (o que seus clientes costumam perguntar)</p>
            <MicTextarea orgId={orgId} rows={2} maxLength={1000} placeholder="Ex.: Vocês parcelam no cartão?" value={novo.mensagem} onChange={(v) => setNovo({ ...novo, mensagem: v })} />
            <Input className="h-8 text-xs" maxLength={500} placeholder="O que o agente deve fazer. Ex.: explica as condições de pagamento da tabela" value={novo.esperado} onChange={(e) => setNovo({ ...novo, esperado: e.target.value })} />
            <Button size="sm" variant="outline" disabled={!!busy || novo.mensagem.trim().length < 3 || novo.esperado.trim().length < 3} onClick={() => void addCustom()}>
              <Plus className="w-3 h-3 mr-1" /> Acrescentar cenário
            </Button>
          </div>
        )}
      </div>
    </details>
  );
}
