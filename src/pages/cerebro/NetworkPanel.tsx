import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Network } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Task { id: string; pergunta: string; status: string; to_agent: string | null; fonte: string | null; resposta: string | null; depth: number; created_at: string }

/**
 * Rede do time de IA (desenho 07, fatia 8): perguntas que os agentes trocaram — quantas estão com o time, quantas
 * esperam o dono e quantas o próprio time resolveu, com a fonte da resposta.
 */
export function NetworkPanel({ orgId }: { orgId: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  useEffect(() => {
    void supabase.from("agent_tasks").select("id, pergunta, status, to_agent, fonte, resposta, depth, created_at")
      .eq("organization_id", orgId).gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString())
      .order("created_at", { ascending: false }).limit(50)
      .then(({ data }) => setTasks((data as Task[]) ?? []));
  }, [orgId]);
  if (!tasks.length) return null;
  const comTime = tasks.filter((t) => t.status === "aberta" && t.to_agent).length;
  const comVoce = tasks.filter((t) => t.status === "aberta" && !t.to_agent).length;
  const peloTime = tasks.filter((t) => t.status === "respondida" && t.fonte !== "dono").length;
  const porVoce = tasks.filter((t) => t.status === "respondida" && t.fonte === "dono").length;
  const FONTE: Record<string, string> = { diagnostico: "Diagnóstico", processos: "processos", base_conhecimento: "base de conhecimento", dono: "você" };
  return (
    <section className="rounded-xl border bg-card p-4 space-y-2">
      <p className="font-medium flex items-center gap-2"><Network className="w-4 h-4" /> Rede do time de IA (30 dias)</p>
      <div className="flex flex-wrap gap-3 text-sm">
        <span>Com o time: <b>{comTime}</b></span>
        <span>Esperando você: <b>{comVoce}</b>{comVoce > 0 && <> · <Link to="/diagnostico" className="underline">responder</Link></>}</span>
        <span>Resolvidas pelo time: <b>{peloTime}</b></span>
        <span>Respondidas por você: <b>{porVoce}</b></span>
      </div>
      <ul className="space-y-1 text-xs">
        {tasks.slice(0, 8).map((t) => (
          <li key={t.id} className="rounded border p-1.5">
            <b>{t.pergunta}</b>
            <span className="block text-muted-foreground">
              {t.status === "respondida" ? `Respondida (fonte: ${FONTE[t.fonte ?? ""] ?? t.fonte}): ${t.resposta ?? ""}` : t.to_agent ? `Com o time (nível ${t.depth + 1})` : "Esperando você no Diagnóstico"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
