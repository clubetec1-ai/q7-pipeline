import { useCallback, useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

interface Suggestion { id: string; content: string; mode: string; motivo: "sombra" | "precisa_pessoa" | "bloqueio"; guard: string[]; created_at: string }

const MOTIVO: Record<Suggestion["motivo"], string> = {
  sombra: "A IA está em modo sombra: ela sugere e você envia.",
  precisa_pessoa: "A IA achou que este caso precisa de uma pessoa — confira antes de usar.",
  bloqueio: "A trava de segurança segurou esta resposta — revise com cuidado (pode prometer algo, pedir dado ou expor informação).",
};

/**
 * Sugestão da IA que não foi enviada ao cliente (desenho 07, fatia 7): no modo sombra, quando o caso precisa
 * de uma pessoa ou quando a trava segurou a resposta. A pessoa usa (vai para a caixa de resposta) ou dispensa.
 */
export function AiSuggestion({ conversationId, refresh, onUse }: { conversationId: string; refresh: number; onUse: (text: string) => void }) {
  const [s, setS] = useState<Suggestion | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.from("ai_suggestions").select("id, content, mode, motivo, guard, created_at")
      .eq("conversation_id", conversationId).is("used_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    setS((data as Suggestion | null) ?? null);
  }, [conversationId]);
  useEffect(() => { void load(); }, [load, refresh]);
  if (!s) return null;
  const done = async (use: boolean) => {
    if (use) onUse(s.content);
    await supabase.rpc("mark_ai_suggestion_used", { p_id: s.id });
    setS(null);
  };
  return (
    <div className={`mx-3 mt-2 rounded-md border p-2 text-sm ${s.motivo === "bloqueio" ? "border-danger bg-danger-soft/40" : "border-primary/40 bg-primary/5"}`}>
      <p className="flex items-center gap-1 text-xs font-medium"><Sparkles className="h-3 w-3" /> Sugestão da IA</p>
      <p className="text-xs text-muted-foreground">{MOTIVO[s.motivo]}</p>
      <p className="mt-1 whitespace-pre-wrap">{s.content}</p>
      <div className="mt-1 flex gap-2">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void done(true)}>Usar sugestão</Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void done(false)}><X className="mr-1 h-3 w-3" /> Dispensar</Button>
      </div>
    </div>
  );
}
