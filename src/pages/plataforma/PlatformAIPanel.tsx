import { useCallback, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * IA da Clubetec incluída (só operador): uma chave Groq da plataforma, no cofre,
 * usada pelas empresas que ainda não cadastraram chave própria — assim o cliente
 * novo faz o Diagnóstico e testa o agente no primeiro minuto.
 */
export function PlatformAIPanel() {
  const { toast } = useToast();
  const [has, setHas] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const { data } = await supabase.rpc("platform_secret_status");
    setHas(!!(data as Record<string, boolean> | null)?.groq_api_key);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("set_platform_secret", { secret_key: "groq_api_key", secret_value: key.trim() });
    setBusy(false);
    if (error) return toast({ variant: "destructive", title: "Não salvou", description: error.message });
    setKey("");
    toast({ title: "Chave da IA da Clubetec salva", description: "Empresas sem chave própria já podem usar a IA." });
    void load();
  };
  return (
    <section className="space-y-2 rounded-lg border p-4">
      <h2 className="font-semibold flex items-center gap-2"><Sparkles className="w-4 h-4" /> IA da Clubetec (incluída)
        {has ? <Badge className="ml-1">Ativa</Badge> : <Badge variant="outline" className="ml-1">Sem chave</Badge>}</h2>
      <p className="text-sm text-muted-foreground">
        Chave Groq da plataforma, usada pelas empresas que ainda não têm chave própria (Diagnóstico, agente, fluxos). O limite de chamadas por
        empresa continua valendo. A chave vai para o cofre e não aparece de novo.
      </p>
      <div className="flex flex-wrap gap-2">
        <Input type="password" autoComplete="off" className="max-w-sm" placeholder={has ? "Trocar chave (gsk_...)" : "Chave Groq (gsk_...)"} value={key} onChange={(e) => setKey(e.target.value)} />
        <Button disabled={busy || key.trim().length < 20} onClick={save}>{busy ? "Salvando…" : "Salvar"}</Button>
      </div>
    </section>
  );
}
