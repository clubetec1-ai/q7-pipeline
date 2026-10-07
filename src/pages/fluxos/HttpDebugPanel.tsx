import { useCallback, useEffect, useState } from "react";
import { Bug, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

interface Row { id: number; node_id: string; ok: boolean; status: number | null; ms: number; error: string | null; body: string | null; created_at: string }

/**
 * Depuração do bloco HTTP (Etapa B, item 6): ligada por 1 hora, mostra o que o outro sistema devolveu em cada chamada
 * do fluxo publicado (situação, tempo, erro e o começo da resposta, sem dados pessoais). Some sozinha depois de 1 hora.
 */
export function HttpDebugPanel({ flowId, nodeId }: { flowId: string; nodeId: string }) {
  const { toast } = useToast();
  const [until, setUntil] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const load = useCallback(async () => {
    const [{ data: f }, { data }] = await Promise.all([
      supabase.from("flows").select("http_debug_until").eq("id", flowId).maybeSingle(),
      supabase.from("flow_http_debug").select("id, node_id, ok, status, ms, error, body, created_at")
        .eq("flow_id", flowId).eq("node_id", nodeId).order("created_at", { ascending: false }).limit(10),
    ]);
    const u = (f as { http_debug_until: string | null } | null)?.http_debug_until ?? null;
    setUntil(u && new Date(u) > new Date() ? u : null);
    setRows((data as Row[]) ?? []);
  }, [flowId, nodeId]);
  useEffect(() => { void load(); }, [load]);
  const toggle = async (on: boolean) => {
    const { error } = await supabase.rpc("set_flow_http_debug", { p_flow: flowId, p_on: on });
    if (error) return toast({ variant: "destructive", title: "Não foi possível", description: error.message });
    void load();
  };
  return (
    <div className="mt-3 rounded-md border p-2 space-y-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium inline-flex items-center gap-1"><Bug className="w-3.5 h-3.5" /> Depuração</span>
        <span className="flex gap-1">
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => void load()} title="Atualizar"><RefreshCw className="w-3.5 h-3.5" /></Button>
          {until
            ? <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => void toggle(false)}>Desligar</Button>
            : <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => void toggle(true)}>Ligar por 1 hora</Button>}
        </span>
      </div>
      <p className="text-muted-foreground">
        {until ? `Ligada até ${new Date(until).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}. Mande uma mensagem de teste para o fluxo publicado e atualize.`
          : "Ligue para ver o que o outro sistema responde em cada chamada (vale para o fluxo publicado; some depois de 1 hora)."}
      </p>
      {rows.map((r) => (
        <div key={r.id} className={`rounded border p-1.5 space-y-0.5 ${r.ok ? "" : "border-danger/50"}`}>
          <p>{new Date(r.created_at).toLocaleTimeString("pt-BR")} · {r.ok ? "deu certo" : "falhou"} · {r.status ?? "sem resposta"} · {r.ms} ms</p>
          {r.error && <p className="text-danger-text">{r.error}</p>}
          {r.body && <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all bg-muted/50 p-1 font-mono text-[10px]">{r.body}</pre>}
        </div>
      ))}
    </div>
  );
}
