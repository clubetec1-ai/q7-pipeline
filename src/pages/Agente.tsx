import { useCallback, useEffect, useState } from "react";
import { AgentTester } from "./agente/AgentTester";
import { Link, Navigate } from "react-router-dom";
import { Bot, CheckCircle2, Clock, KeyRound, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { AppHeader } from "@/components/AppHeader";
import { NumberHealthBanner } from "@/components/NumberHealthBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PROVIDER_LABEL } from "./fluxos/blocks";

const SUGGESTED = "Você é o atendente virtual da empresa. Responda de forma cordial, curta e objetiva, sempre em português. " +
  "Resolva dúvidas com base nas informações da empresa; quando não souber ou o cliente pedir, avise que vai chamar uma pessoa da equipe.";

/**
 * Agente de IA do atendimento, numa tela só e simples: ligar/desligar, como ele
 * se comporta, follow-up automático e teste. A chave da IA NÃO fica aqui: fica em
 * Configurações → Chaves de IA (vai para o cofre e nunca volta para a tela).
 */
export default function Agente() {
  const { user } = useAuth();
  const { org, can } = useOrg();
  const { toast } = useToast();
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [followOn, setFollowOn] = useState(false);
  const [followMin, setFollowMin] = useState(60);
  const [followMax, setFollowMax] = useState(1);
  const [provider, setProvider] = useState("groq");
  const [model, setModel] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!org) return;
    const [a, k, o] = await Promise.all([
      supabase.from("agent_configs").select("system_prompt, enabled, followup_inactivity_minutes, followup_max_per_conversation")
        .eq("organization_id", org.id).maybeSingle(),
      supabase.rpc("ai_keys_status", { org: org.id }),
      supabase.from("organizations").select("settings").eq("id", org.id).maybeSingle(),
    ]);
    const st = (o.data?.settings ?? {}) as Record<string, unknown>;
    const prov = typeof st.ai_provider === "string" ? st.ai_provider : "groq";
    setProvider(prov);
    setModel(typeof st.ai_model === "string" ? st.ai_model : "");
    setHasKey(!!((k.data as Record<string, boolean> | null) ?? {})[prov]);
    if (a.data) {
      setEnabled(a.data.enabled);
      setPrompt(a.data.system_prompt ?? "");
      const m = a.data.followup_inactivity_minutes;
      setFollowOn(!!m && m > 0);
      setFollowMin(m && m > 0 ? m : 60);
      setFollowMax(a.data.followup_max_per_conversation ?? 1);
    } else setPrompt(SUGGESTED);
    setLoaded(true);
  }, [org]);
  useEffect(() => { void load(); }, [load]);

  if (!org) return null;
  if (!can("org.settings")) return <Navigate to="/" replace />;

  const save = async (next?: { enabled?: boolean }) => {
    if (!user) return;
    const on = next?.enabled ?? enabled;
    if (on && !hasKey) {
      toast({ variant: "destructive", title: "Cadastre a chave da IA primeiro", description: "Configurações → Chaves de IA." });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("agent_configs").upsert({
      user_id: user.id, system_prompt: prompt.trim() || SUGGESTED, enabled: on,
      followup_inactivity_minutes: followOn ? Math.max(5, followMin) : null,
      followup_max_per_conversation: Math.min(5, Math.max(1, followMax)),
    } as never, { onConflict: "organization_id" });
    setSaving(false);
    if (error) return toast({ variant: "destructive", title: "Não salvou", description: error.message });
    setEnabled(on);
    toast({ title: on ? "Agente ligado e salvo" : "Salvo", description: on ? "A IA passa a responder os clientes nos atendimentos com ela." : undefined });
  };
  const runTest = async () => {
    setTesting(true); setTest(null);
    const { data, error } = await supabase.functions.invoke("test-ai-connection", { body: {} });
    setTesting(false);
    setTest(error || !data?.ok
      ? { ok: false, text: data?.error || error?.message || "A IA não respondeu." }
      : { ok: true, text: `A IA respondeu: "${String(data.data?.reply ?? "").slice(0, 160)}"` });
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="agente" />
      <NumberHealthBanner />
      <main className="flex-1 w-full max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Bot className="w-6 h-6" /> Agente de IA</h1>
          <p className="text-sm text-muted-foreground">A IA atende os clientes na hora e passa para uma pessoa quando precisa.</p>
        </div>

        {!loaded ? <Loader2 className="w-5 h-5 animate-spin" /> : (
          <>
            <section className="rounded-xl border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">Agente {enabled ? "ligado" : "desligado"}</p>
                  <p className="text-xs text-muted-foreground">{enabled ? "Respondendo os atendimentos que estão com a IA." : "Os atendimentos vão direto para a equipe."}</p>
                </div>
                <Switch checked={enabled} disabled={saving} onCheckedChange={(v) => void save({ enabled: v })} />
              </div>
              <div className={`rounded-md p-2 text-sm flex flex-wrap items-center justify-between gap-2 ${hasKey ? "bg-muted/50" : "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"}`}>
                <span className="flex items-center gap-2">
                  {hasKey ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <TriangleAlert className="w-4 h-4" />}
                  {hasKey ? <>IA: <b>{PROVIDER_LABEL[provider] ?? provider}</b>{model ? ` · ${model}` : ""} — chave guardada no cofre</> : "Falta cadastrar a chave da IA."}
                </span>
                <Button asChild size="sm" variant="outline"><Link to="/configuracoes/ia"><KeyRound className="w-4 h-4 mr-1" /> {hasKey ? "Trocar em Configurações" : "Cadastrar a chave"}</Link></Button>
              </div>
            </section>

            <section className="rounded-xl border bg-card p-4 space-y-2">
              <p className="font-medium">Como o agente se comporta</p>
              <p className="text-xs text-muted-foreground">
                Escreva em poucas linhas o papel do agente. O <b>tom de voz da marca</b>, as <b>regras e limites</b> e o <b>perfil dos clientes</b> que você
                aprovou no <Link to="/diagnostico" className="underline">Diagnóstico</Link> entram sozinhos — não precisa repetir aqui.
              </p>
              <Textarea rows={6} value={prompt} maxLength={4000} onChange={(e) => setPrompt(e.target.value)} />
              <button type="button" className="text-xs underline text-muted-foreground inline-flex items-center gap-1" onClick={() => setPrompt(SUGGESTED)}>
                <Sparkles className="w-3 h-3" /> Usar texto sugerido
              </button>
            </section>

            <section className="rounded-xl border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium flex items-center gap-2"><Clock className="w-4 h-4" /> Follow-up automático</p>
                  <p className="text-xs text-muted-foreground">Quando o cliente para de responder, o agente retoma a conversa sozinho.</p>
                </div>
                <Switch checked={followOn} onCheckedChange={setFollowOn} />
              </div>
              {followOn && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  Depois de <Input type="number" min={5} className="h-8 w-20" value={followMin} onChange={(e) => setFollowMin(Number(e.target.value) || 60)} /> minutos
                  sem resposta, no máximo <Input type="number" min={1} max={5} className="h-8 w-16" value={followMax} onChange={(e) => setFollowMax(Number(e.target.value) || 1)} /> vez(es) por conversa.
                </div>
              )}
            </section>

            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={saving} onClick={() => void save()}>{saving ? "Salvando…" : "Salvar"}</Button>
              <Button variant="outline" disabled={testing || !hasKey} onClick={runTest}>{testing ? "Testando…" : "Testar a IA"}</Button>
              {test && <span className={`text-sm ${test.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600"}`}>{test.ok ? "✓ " : "✗ "}{test.text}</span>}
            </div>

            <AgentTester orgId={org.id} prompt={prompt} disabled={!hasKey} />
          </>
        )}
      </main>
    </div>
  );
}
