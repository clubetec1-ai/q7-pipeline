import { useCallback, useEffect, useState } from "react";
import { MessagesSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { MicTextarea } from "@/components/MicTextarea";

interface Task { id: string; pergunta: string; contexto: string; etapa: string | null; created_at: string }

/**
 * Perguntas do time de IA (desenho 07, fatia 8): o que nenhum agente encontrou nas informações da empresa chega
 * aqui. A resposta do dono entra no texto da etapa certa do Diagnóstico (depois é só organizar de novo).
 */
export function TeamQuestions({ orgId, labelOf, onAnswered }: { orgId: string; labelOf: (k: string) => string; onAnswered: (etapa: string, add: string) => void }) {
  const { toast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [text, setText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.from("agent_tasks").select("id, pergunta, contexto, etapa, created_at")
      .eq("organization_id", orgId).eq("status", "aberta").is("to_agent", null).order("created_at").limit(20);
    setTasks((data as Task[]) ?? []);
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);
  if (!tasks.length) return null;

  const answer = async (t: Task) => {
    setBusy(t.id);
    const { error } = await supabase.rpc("answer_agent_task", { p_task: t.id, p_resposta: text[t.id] ?? "" });
    setBusy(null);
    if (error) return toast({ variant: "destructive", title: "Não salvei a resposta", description: error.message });
    toast({ title: "Resposta salva", description: `Entrou na etapa ${labelOf(t.etapa ?? "empresa")}. Clique em Organizar com IA nessa etapa para atualizar.` });
    // O servidor acrescentou o mesmo texto na etapa: a tela acompanha (o salvar sozinho não pode apagar a resposta).
    onAnswered(t.etapa ?? "empresa", `Pergunta do time de IA: ${t.pergunta}\nResposta: ${(text[t.id] ?? "").trim()}`);
    void load();
  };

  // Pergunta sem sentido (ou que não vale responder) sai da lista; a do dono também vence sozinha em 14 dias.
  const dismiss = async (t: Task) => {
    setBusy(t.id);
    const { error } = await supabase.rpc("dismiss_agent_task", { p_task: t.id });
    setBusy(null);
    if (error) return toast({ variant: "destructive", title: "Não descartei", description: error.message });
    void load();
  };

  return (
    <section data-demo="perguntas-time" className="rounded-xl border border-primary/40 bg-primary/5 p-3 space-y-2">
      <p className="font-medium flex items-center gap-2 text-sm"><MessagesSquare className="w-4 h-4" /> Perguntas do time de IA ({tasks.length})</p>
      <p className="text-xs text-muted-foreground">Clientes perguntaram e nenhum agente achou a resposta nas informações da empresa. Responda aqui (escrevendo ou falando): a resposta entra no Diagnóstico e o agente passa a saber.</p>
      <ul className="space-y-2">
        {tasks.map((t) => (
          <li key={t.id} className="rounded-md border bg-background p-2 space-y-1 text-sm">
            <p><b>{t.pergunta}</b> <span className="text-xs text-muted-foreground">· vai para a etapa {labelOf(t.etapa ?? "empresa")}</span></p>
            <MicTextarea orgId={orgId} rows={2} maxLength={2000} placeholder="Sua resposta. Ex.: Sim, aos sábados das 8h às 12h." value={text[t.id] ?? ""}
              onChange={(v) => setText({ ...text, [t.id]: v })} />
            <div className="flex gap-2">
              <Button size="sm" disabled={busy === t.id || (text[t.id] ?? "").trim().length < 2} onClick={() => void answer(t)}>Responder</Button>
              <Button size="sm" variant="ghost" disabled={busy === t.id} title="A pergunta não faz sentido ou não vale responder" onClick={() => void dismiss(t)}>Descartar</Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
