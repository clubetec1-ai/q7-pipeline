import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

/**
 * Configuração das cobranças (dono/admin): conectar o Asaas pela chave de API
 * (vai para o cofre pela função "payments"; nunca volta para a tela) e as regras.
 */
export function AsaasSettings({ orgId }: { orgId: string }) {
  const { toast } = useToast();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pay, setPay] = useState<Record<string, any>>({});
  const [env, setEnv] = useState("sandbox");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("organizations").select("settings").eq("id", orgId).maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = ((data?.settings ?? {}) as Record<string, any>).payments ?? {};
    setPay(p);
    if (p.env) setEnv(p.env);
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);

  const connected = pay.provider === "asaas";
  const connect = async () => {
    setBusy(true);
    const r = await callFunction<{ warning: string | null }>("payments", { action: "connect", organization_id: orgId, env, api_key: apiKey.trim() });
    setBusy(false);
    if (!r.ok) return toast({ variant: "destructive", title: "Não conectado", description: r.message });
    setApiKey("");
    toast(r.data.warning ? { variant: "destructive", title: "Conectado com aviso", description: r.data.warning } : { title: "Asaas conectado", description: "Os pagamentos serão avisados automaticamente." });
    void load();
  };
  const disconnect = async () => {
    if (!window.confirm("Desconectar o Asaas? As cobranças existentes continuam na lista.")) return;
    await callFunction("payments", { action: "disconnect", organization_id: orgId });
    void load();
  };
  const setRule = async (k: string, v: boolean) => {
    const { data } = await supabase.from("organizations").select("settings").eq("id", orgId).maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (data?.settings ?? {}) as Record<string, any>;
    const { error } = await supabase.from("organizations").update({ settings: { ...s, payments: { ...(s.payments ?? {}), [k]: v } } as never }).eq("id", orgId);
    if (error) return toast({ variant: "destructive", title: "Sem permissão" });
    setPay((p) => ({ ...p, [k]: v }));
  };

  return (
    <section className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold">Asaas</p>
        {connected ? <Badge>{pay.env === "production" ? "Conectado (produção)" : "Conectado (testes)"}</Badge> : <Badge variant="outline">Não conectado</Badge>}
      </div>
      <ol className="list-decimal pl-5 text-xs text-muted-foreground space-y-0.5">
        <li>Crie a conta no Asaas (para testar, use o ambiente de testes: sandbox.asaas.com).</li>
        <li>No Asaas: Integrações → Chaves de API → Gerar chave. Copie a chave.</li>
        <li>Cole abaixo, escolha o ambiente certo e clique em Conectar. O aviso de pagamento é configurado sozinho.</li>
      </ol>
      <div className="flex flex-wrap gap-2">
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={env} onChange={(e) => setEnv(e.target.value)}>
          <option value="sandbox">Testes (sandbox)</option><option value="production">Produção</option>
        </select>
        <Input type="password" autoComplete="off" className="max-w-sm" placeholder={connected ? "Trocar chave" : "Chave de API do Asaas"}
          value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
        <Button onClick={connect} disabled={busy || apiKey.trim().length < 20}>{busy ? "Conectando..." : "Conectar"}</Button>
        {connected && <Button variant="ghost" onClick={disconnect}>Desconectar</Button>}
      </div>
      {connected && (
        <div className="space-y-2 text-sm pt-2">
          <label className="flex items-center gap-2"><Switch checked={pay.allow_agents === true} onCheckedChange={(v) => setRule("allow_agents", v)} /> Atendentes também podem cobrar (na conversa e em Cobranças)</label>
          <label className="flex items-center gap-2"><Switch checked={pay.notify_paid !== false} onCheckedChange={(v) => setRule("notify_paid", v)} /> Avisar o cliente quando o pagamento cair</label>
          <label className="flex items-center gap-2"><Switch checked={pay.reminders !== false} onCheckedChange={(v) => setRule("reminders", v)} /> Lembrete um dia antes e um dia depois do vencimento</label>
        </div>
      )}
    </section>
  );
}
