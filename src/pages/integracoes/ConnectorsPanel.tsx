import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plug } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface ConnectorInfo {
  key: string; name: string; beta: boolean; description: string; app_ready: boolean;
  connection: { status: string; error: string | null; connected_at: string } | null;
  actions: { key: string; label: string; description: string; outputs: Record<string, string> }[];
}

/** Conectores prontos (login no próprio sistema, sem copiar chave). */
export function ConnectorsPanel({ orgId }: { orgId: string }) {
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState<ConnectorInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [result, setResult] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const r = await callFunction<{ catalog: ConnectorInfo[] }>("connectors", { action: "list", organization_id: orgId });
    if (r.ok) setList(r.data.catalog);
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);

  // Volta do login OAuth: ?conector=bling&status=ok|erro&msg=...
  useEffect(() => {
    const st = params.get("status");
    if (!st) return;
    toast(st === "ok" ? { title: "Conectado!", description: "Já dá para usar no bloco Conector dos fluxos." }
      : { variant: "destructive", title: "Não conectou", description: params.get("msg") ?? "" });
    params.delete("status"); params.delete("msg"); params.delete("conector");
    setParams(params, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async (c: ConnectorInfo) => {
    setBusy(c.key);
    const r = await callFunction<{ url: string }>("connectors", { action: "authorize", organization_id: orgId, connector: c.key });
    setBusy(null);
    if (!r.ok) return toast({ variant: "destructive", title: r.message });
    window.location.href = r.data.url; // login no próprio sistema; volta para esta tela
  };
  const test = async (c: ConnectorInfo, action: string) => {
    setBusy(`t:${c.key}`);
    const r = await callFunction<{ result: { ok: boolean; vars?: Record<string, string>; error?: string } }>("connectors", {
      action: "test", organization_id: orgId, connector: c.key, connector_action: action, phone,
    });
    setBusy(null);
    if (!r.ok) return toast({ variant: "destructive", title: r.message });
    const out = r.data.result;
    setResult((x) => ({ ...x, [c.key]: out.ok ? Object.entries(out.vars ?? {}).map(([k, v]) => `${k}: ${v}`).join(" · ") || "ok (sem dados)" : `❌ ${out.error}` }));
    void load();
  };
  const disconnect = async (c: ConnectorInfo) => {
    if (!window.confirm(`Desconectar ${c.name}? Os fluxos que usam este conector seguirão por “Não deu”.`)) return;
    await callFunction("connectors", { action: "disconnect", organization_id: orgId, connector: c.key });
    void load();
  };

  if (!list.length) return null;
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div>
        <p className="font-semibold flex items-center gap-2"><Plug className="w-4 h-4" /> Conectores prontos</p>
        <p className="text-xs text-muted-foreground">Você entra no próprio sistema e autoriza — sem copiar chave. Depois use o bloco “Conector” nos fluxos.</p>
      </div>
      {list.map((c) => {
        const on = c.connection?.status === "connected";
        return (
          <div key={c.key} className="rounded-md border p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{c.name}</span>
              {c.beta && <Badge variant="outline">beta</Badge>}
              {on ? <Badge>Conectado</Badge> : c.connection?.status === "error" ? <Badge variant="destructive">{c.connection.error ?? "Erro"}</Badge>
                : c.app_ready ? <Badge variant="outline">Não conectado</Badge> : <Badge variant="secondary">Aguardando ativação pela Clubetec</Badge>}
              <span className="text-xs text-muted-foreground">{c.description}</span>
              <div className="ml-auto flex gap-1">
                {c.app_ready && <Button size="sm" variant={on ? "ghost" : "default"} disabled={busy === c.key} onClick={() => connect(c)}>{on ? "Conectar de novo" : `Conectar ${c.name}`}</Button>}
                {on && <Button size="sm" variant="ghost" onClick={() => disconnect(c)}>Desconectar</Button>}
              </div>
            </div>
            {on && c.actions.map((a) => (
              <div key={a.key} className="flex flex-wrap items-center gap-2 text-sm">
                <span>{a.label}</span>
                <Input className="h-8 w-52" placeholder="Telefone de teste (55...)" value={phone} onChange={(e) => setPhone(e.target.value)} />
                <Button size="sm" variant="outline" disabled={!!busy || !phone} onClick={() => test(c, a.key)}>{busy === `t:${c.key}` ? "Testando..." : "Testar"}</Button>
              </div>
            ))}
            {result[c.key] && <p className="text-xs rounded bg-muted p-2">{result[c.key]}</p>}
          </div>
        );
      })}
    </div>
  );
}
