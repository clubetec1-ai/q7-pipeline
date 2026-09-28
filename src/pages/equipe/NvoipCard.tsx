import { useCallback, useEffect, useState } from "react";
import { PlugZap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Row { enabled: boolean; has_credentials: boolean; last_sync_at: string | null; last_error: string | null }
const when = (d: string) => new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * Integração Nvoip (dono/admin): Client ID e segredo vão para o cofre e não voltam
 * para a tela. Com ela, o botão Ligar toca o MicroSIP do atendente e depois o
 * cliente, e o histórico de ligações entra sozinho a cada 5 minutos.
 */
export function NvoipCard({ orgId }: { orgId: string }) {
  const { toast } = useToast();
  const [row, setRow] = useState<Row | null>(null);
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("voice_integrations").select("enabled, has_credentials, last_sync_at, last_error").eq("organization_id", orgId).maybeSingle();
    setRow(data ?? null);
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);

  const save = async (enabled = row?.enabled ?? true) => {
    setBusy(true);
    const { error } = await supabase.rpc("set_voice_integration", { org: orgId, p_client_id: id, p_client_secret: secret, p_enabled: enabled });
    setBusy(false);
    if (error) return toast({ variant: "destructive", title: "Não salvou", description: error.message });
    setId(""); setSecret("");
    toast({ title: "Nvoip salva" });
    void load();
  };
  const runTest = async () => {
    setBusy(true); setTest(null);
    const r = await callFunction<{ calls_today: number; item_fields: string[] }>("voice", { action: "nvoip_test", org_id: orgId });
    setBusy(false);
    setTest(r.ok ? `✓ Conectado. ${r.data.calls_today} ligação(ões) hoje.${r.data.item_fields?.length ? ` Campos: ${r.data.item_fields.join(", ")}` : ""}` : `✗ ${r.message}`);
    void load();
  };

  return (
    <section className="rounded-lg border p-4 space-y-3 mb-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold flex items-center gap-2"><PlugZap className="w-4 h-4" /> Integração Nvoip</h3>
        <span className="text-xs">
          {!row?.has_credentials ? <span className="text-muted-foreground">Não configurada</span>
            : !row.enabled ? <span className="text-muted-foreground">Desligada</span>
            : row.last_error ? <span className="text-red-600">⚠ {row.last_error}</span>
            : <span className="text-emerald-600">● Ativa{row.last_sync_at ? ` · histórico em ${when(row.last_sync_at)}` : ""}</span>}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        Com a Nvoip conectada, o botão <b>Ligar</b> faz a central tocar o <b>MicroSIP do atendente</b> e, quando ele atende, liga para o cliente.
        As ligações (feitas, recebidas e <b>perdidas</b>) entram sozinhas no histórico do cliente a cada 5 minutos, e a perdida avisa o atendente.
        No painel da Nvoip, crie uma credencial de API (OAuth, tipo <i>client credentials</i>) com acesso a Ligações e cole abaixo.
      </p>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Input placeholder={row?.has_credentials ? "Client ID (vazio = manter)" : "Client ID"} value={id} onChange={(e) => setId(e.target.value)} autoComplete="off" />
        <Input type="password" autoComplete="new-password" placeholder={row?.has_credentials ? "Segredo (vazio = manter)" : "Segredo (client secret)"} value={secret} onChange={(e) => setSecret(e.target.value)} />
        <Button size="sm" className="h-9" disabled={busy || (!row?.has_credentials && (!id.trim() || !secret.trim()))} onClick={() => save()}>Salvar</Button>
      </div>
      {row?.has_credentials && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={runTest}>{busy ? "Testando…" : "Testar conexão"}</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => save(!row.enabled)}>{row.enabled ? "Desligar" : "Ligar"}</Button>
          {test && <span className={`text-sm ${test.startsWith("✓") ? "text-emerald-700 dark:text-emerald-400" : "text-red-600"}`}>{test}</span>}
        </div>
      )}
    </section>
  );
}
