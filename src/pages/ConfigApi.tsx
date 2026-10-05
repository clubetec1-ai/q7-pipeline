import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowLeft, Copy, KeyRound, Plus, Send, Trash2, Webhook } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface ApiKey { id: string; name: string; prefix: string; scopes: string[]; created_at: string; last_used_at: string | null; revoked_at: string | null }
interface Endpoint { id: string; url: string; events: string[]; active: boolean; failures: number; last_status: number | null; last_at: string | null }
interface Delivery { id: number; endpoint_id: string; event: string; status: string; attempts: number; response_code: number | null; error: string | null; created_at: string }

const SCOPES: [string, string][] = [
  ["contacts:read", "Consultar contatos"],
  ["contacts:write", "Criar e atualizar contatos"],
  ["conversations:read", "Listar conversas"],
  ["funnel:write", "Mudar a etapa no funil"],
  ["messages:send", "Enviar mensagem pelo WhatsApp"],
];
const EVENTS: [string, string][] = [
  ["contact.created", "Novo contato"],
  ["conversation.created", "Nova conversa"],
  ["conversation.stage_changed", "Mudou de etapa no funil"],
  ["ticket.closed", "Atendimento encerrado"],
  ["message.received", "Mensagem recebida"],
];
const DELIVERY: Record<string, [string, string]> = {
  pending: ["Na fila", "bg-muted text-muted-foreground"],
  sending: ["Enviando", "bg-info-soft text-info-text"],
  sent: ["Entregue", "bg-success-soft text-success-text"],
  failed: ["Falhou", "bg-danger-soft text-danger-text"],
};
const API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api`;
const when = (s: string | null) => (s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

function Checks({ options, value, onChange }: { options: [string, string][]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {options.map(([k, label]) => (
        <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={value.includes(k)}
            onChange={(e) => onChange(e.target.checked ? [...value, k] : value.filter((x) => x !== k))} />
          {label}
        </label>
      ))}
    </div>
  );
}

/** Mostra um segredo uma única vez, com botão de copiar. */
function OneTimeSecret({ title, value, onClose }: { title: string; value: string | null; onClose: () => void }) {
  const { toast } = useToast();
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Copie agora e guarde no sistema que vai usar. Por segurança, ela não aparece de novo — se perder, crie outra.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input readOnly value={value ?? ""} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
          <Button variant="outline" onClick={() => { void navigator.clipboard.writeText(value ?? ""); toast({ title: "Copiado" }); }}>
            <Copy className="w-4 h-4" />
          </Button>
        </div>
        <DialogFooter><Button onClick={onClose}>Já guardei</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Configurações → API e webhooks (dono/admin). Chaves para outros sistemas (n8n, Make,
 * Zapier, sistema próprio) usarem a API e endereços que recebem os acontecimentos.
 * A chave e o segredo do webhook aparecem uma vez só; o banco guarda só o hash / o cofre.
 */
export default function ConfigApi() {
  const { org, can } = useOrg();
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [eps, setEps] = useState<Endpoint[]>([]);
  const [dels, setDels] = useState<Delivery[]>([]);
  const [newKey, setNewKey] = useState<{ name: string; scopes: string[] } | null>(null);
  const [newEp, setNewEp] = useState<{ id: string | null; url: string; events: string[]; active: boolean } | null>(null);
  const [secret, setSecret] = useState<{ title: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!org) return;
    const [k, e, d] = await Promise.all([
      supabase.from("api_keys").select("id, name, prefix, scopes, created_at, last_used_at, revoked_at").eq("organization_id", org.id).order("created_at", { ascending: false }),
      supabase.from("webhook_endpoints").select("id, url, events, active, failures, last_status, last_at").eq("organization_id", org.id).order("created_at"),
      supabase.from("webhook_deliveries").select("id, endpoint_id, event, status, attempts, response_code, error, created_at").eq("organization_id", org.id).order("created_at", { ascending: false }).limit(20),
    ]);
    setKeys((k.data ?? []) as ApiKey[]);
    setEps((e.data ?? []) as Endpoint[]);
    setDels((d.data ?? []) as Delivery[]);
  }, [org]);
  useEffect(() => { void load(); }, [load]);

  if (!org) return null;
  if (!can("org.settings")) return <Navigate to="/configuracoes" replace />;

  const fail = (msg: string) => toast({ variant: "destructive", title: "Não deu certo", description: msg });

  const createKey = async () => {
    if (!newKey) return;
    if (newKey.name.trim().length < 2) return fail("Dê um nome para a chave (ex.: n8n, site).");
    if (!newKey.scopes.length) return fail("Marque pelo menos uma permissão.");
    setBusy(true);
    const { data, error } = await supabase.rpc("create_api_key", { org: org.id, p_name: newKey.name.trim(), p_scopes: newKey.scopes });
    setBusy(false);
    if (error) return fail(error.message);
    setNewKey(null);
    setSecret({ title: "Sua chave de API", value: (data as { key: string }).key });
    void load();
  };
  const revokeKey = async (k: ApiKey) => {
    if (!window.confirm(`Revogar a chave "${k.name}"? Os sistemas que usam essa chave param de funcionar na hora.`)) return;
    const { error } = await supabase.rpc("revoke_api_key", { key_id: k.id });
    if (error) return fail(error.message);
    toast({ title: "Chave revogada" });
    void load();
  };

  const saveEp = async () => {
    if (!newEp) return;
    const url = newEp.url.trim();
    if (!/^https:\/\/[^\s/]+\.[^\s/]+/.test(url)) return fail("Use um endereço https:// público (ex.: o link do webhook do n8n).");
    if (!newEp.events.length) return fail("Marque pelo menos um acontecimento.");
    setBusy(true);
    const { data, error } = await supabase.rpc("save_webhook_endpoint", { org: org.id, endpoint: newEp.id as string, p_url: url, p_events: newEp.events, p_active: newEp.active });
    setBusy(false);
    if (error) return fail(error.message.includes("check") ? "Endereço recusado: precisa ser https:// público (não pode ser IP, localhost ou rede interna)." : error.message);
    setNewEp(null);
    const sec = (data as { secret?: string }).secret;
    if (sec) setSecret({ title: "Segredo de assinatura do webhook", value: sec });
    else toast({ title: "Endereço salvo" });
    void load();
  };
  const deleteEp = async (e: Endpoint) => {
    if (!window.confirm(`Excluir o endereço ${e.url}? O histórico de entregas dele também é apagado.`)) return;
    const { error } = await supabase.rpc("delete_webhook_endpoint", { endpoint: e.id });
    if (error) return fail(error.message);
    toast({ title: "Endereço excluído" });
    void load();
  };
  const testEp = async (e: Endpoint) => {
    const { error } = await supabase.rpc("test_webhook_endpoint", { endpoint: e.id });
    if (error) return fail(error.message);
    toast({ title: "Teste na fila", description: "Sai em até 1 minuto. Veja o resultado em Últimas entregas." });
    void load();
  };

  const active = keys.filter((k) => !k.revoked_at);
  const revoked = keys.filter((k) => k.revoked_at);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="configuracoes" />
      <main className="flex-1 w-full max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
        <div>
          <Link to="/configuracoes" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"><ArrowLeft className="w-4 h-4" /> Configurações</Link>
          <h1 className="font-brand text-2xl leading-tight mt-1">API e webhooks</h1>
          <p className="text-sm text-muted-foreground">
            Para ligar o Deixa com a IA a outros sistemas — n8n, Make, Zapier ou o sistema da sua empresa. Quem configura costuma ser a pessoa de TI.
          </p>
        </div>

        {/* ------------------------------------------------------------ chaves */}
        <section className="rounded-xl border bg-card p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium inline-flex items-center gap-2"><KeyRound className="w-4 h-4" /> Chaves de API</p>
            <Button size="sm" onClick={() => setNewKey({ name: "", scopes: ["contacts:read", "contacts:write"] })} disabled={active.length >= 20}>
              <Plus className="w-4 h-4 mr-1" /> Nova chave
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Cada sistema com a sua chave e só as permissões que precisa. Limite de 60 chamadas por minuto por empresa. Nunca coloque a chave em site ou aplicativo aberto ao público.
          </p>
          {active.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma chave ativa.</p>}
          <ul className="divide-y">
            {active.map((k) => (
              <li key={k.id} className="py-2 flex flex-wrap items-center gap-2 justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{k.name} <span className="font-mono text-xs text-muted-foreground">{k.prefix}…</span></p>
                  <p className="text-xs text-muted-foreground">
                    {k.scopes.map((s) => SCOPES.find(([x]) => x === s)?.[1] ?? s).join(" · ")} — último uso: {when(k.last_used_at)}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => void revokeKey(k)}>Revogar</Button>
              </li>
            ))}
          </ul>
          {revoked.length > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">{revoked.length} chave(s) revogada(s)</summary>
              <ul className="mt-1 space-y-0.5">{revoked.map((k) => <li key={k.id}>{k.name} ({k.prefix}…) — revogada em {when(k.revoked_at)}</li>)}</ul>
            </details>
          )}
        </section>

        {/* ---------------------------------------------------------- webhooks */}
        <section className="rounded-xl border bg-card p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium inline-flex items-center gap-2"><Webhook className="w-4 h-4" /> Webhooks (avisos para outro sistema)</p>
            <Button size="sm" onClick={() => setNewEp({ id: null, url: "", events: ["conversation.stage_changed"], active: true })} disabled={eps.length >= 10}>
              <Plus className="w-4 h-4 mr-1" /> Novo endereço
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Quando algo acontece aqui (ex.: cliente mudou de etapa), enviamos um aviso para o endereço. Se o endereço falhar, tentamos de novo até 6 vezes; depois de 20 falhas seguidas ele é pausado e você recebe um aviso no sino.
          </p>
          {eps.length === 0 && <p className="text-sm text-muted-foreground">Nenhum endereço cadastrado.</p>}
          <ul className="divide-y">
            {eps.map((e) => (
              <li key={e.id} className="py-2 flex flex-wrap items-center gap-2 justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-mono break-all">{e.url}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.active ? <span className="text-success-text">Ativo</span> : <span className="text-warning-text">Pausado</span>}
                    {" · "}{e.events.map((v) => EVENTS.find(([x]) => x === v)?.[1] ?? v).join(", ")}
                    {e.last_at && <> · último envio {when(e.last_at)} (HTTP {e.last_status ?? "—"})</>}
                    {e.failures > 0 && <> · {e.failures} falha(s) seguidas</>}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => void testEp(e)} disabled={!e.active} title="Enviar um teste"><Send className="w-4 h-4" /></Button>
                  <Button size="sm" variant="outline" onClick={() => setNewEp({ id: e.id, url: e.url, events: e.events, active: e.active })}>Editar</Button>
                  <Button size="sm" variant="outline" onClick={() => void deleteEp(e)} aria-label="Excluir"><Trash2 className="w-4 h-4" /></Button>
                </div>
              </li>
            ))}
          </ul>
          {dels.length > 0 && (
            <details className="text-sm" open={dels.some((d) => d.status === "failed")}>
              <summary className="cursor-pointer text-muted-foreground text-xs">Últimas entregas</summary>
              <ul className="mt-2 space-y-1">
                {dels.map((d) => (
                  <li key={d.id} className="text-xs flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 ${DELIVERY[d.status]?.[1] ?? ""}`}>{DELIVERY[d.status]?.[0] ?? d.status}</span>
                    <span>{EVENTS.find(([x]) => x === d.event)?.[1] ?? (d.event === "ping" ? "Teste" : d.event)}</span>
                    <span className="text-muted-foreground">{when(d.created_at)}{d.attempts > 1 ? ` · ${d.attempts} tentativas` : ""}{d.error ? ` · ${d.error}` : ""}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        {/* -------------------------------------------------------------- guia */}
        <section className="rounded-xl border bg-card p-5 space-y-3 text-sm">
          <p className="font-medium">Como usar (para a pessoa de TI)</p>
          <p className="text-muted-foreground">Endereço da API:</p>
          <code className="block rounded bg-muted px-3 py-2 text-xs break-all">{API_URL}</code>
          <p className="text-muted-foreground">Envie a chave no cabeçalho <code className="text-xs">Authorization: Bearer dca_…</code>. Respostas em JSON.</p>
          <ul className="text-xs space-y-1 font-mono">
            <li>GET /contacts?phone=5511999999999 <span className="font-sans text-muted-foreground">— achar contato (ou ?email=)</span></li>
            <li>POST /contacts {"{ phone, name, email, custom: { campo: valor } }"} <span className="font-sans text-muted-foreground">— criar ou atualizar</span></li>
            <li>GET /conversations?since=2026-10-01T00:00:00Z <span className="font-sans text-muted-foreground">— conversas recentes</span></li>
            <li>POST /conversations/ID/stage {"{ stage: \"Proposta\" }"} <span className="font-sans text-muted-foreground">— mudar etapa</span></li>
            <li>POST /messages {"{ phone, text }"} <span className="font-sans text-muted-foreground">— enviar WhatsApp</span></li>
          </ul>
          <p className="text-xs text-muted-foreground">
            Envio de mensagem respeita quem pediu para não receber. No número oficial da Meta, fora das 24h após a última mensagem do cliente, só vai com modelo aprovado: inclua <code>template: {"{ name, language, params }"}</code>.
          </p>
          <p className="text-muted-foreground pt-2">Webhooks chegam como POST com JSON <code className="text-xs">{"{ event, organization_id, created_at, data }"}</code> e os cabeçalhos:</p>
          <ul className="text-xs space-y-1">
            <li><code>X-DCA-Event</code> — o acontecimento</li>
            <li><code>X-DCA-Timestamp</code> — hora do envio (segundos)</li>
            <li><code>X-DCA-Signature: sha256=…</code> — HMAC-SHA256 de <code>timestamp + "." + corpo</code> com o segredo do endereço. Confira antes de confiar no aviso e recuse se a hora tiver mais de 5 minutos.</li>
          </ul>
          <p className="text-xs text-muted-foreground">No n8n: nó “Webhook” (POST) para receber e nó “HTTP Request” com o cabeçalho de autorização para chamar a API. No Make e no Zapier: “Custom webhook” e “HTTP / Webhooks by Zapier”.</p>
        </section>
      </main>

      <Dialog open={!!newKey} onOpenChange={(o) => !o && setNewKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova chave de API</DialogTitle>
            <DialogDescription>Dê um nome que lembre onde ela vai ser usada e marque só o que esse sistema precisa fazer.</DialogDescription>
          </DialogHeader>
          {newKey && (
            <div className="space-y-3">
              <Input placeholder="Ex.: n8n, site, ERP" maxLength={60} value={newKey.name} onChange={(e) => setNewKey({ ...newKey, name: e.target.value })} />
              <Checks options={SCOPES} value={newKey.scopes} onChange={(scopes) => setNewKey({ ...newKey, scopes })} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewKey(null)}>Cancelar</Button>
            <Button onClick={() => void createKey()} disabled={busy}>Criar chave</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!newEp} onOpenChange={(o) => !o && setNewEp(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{newEp?.id ? "Editar endereço" : "Novo endereço de webhook"}</DialogTitle>
            <DialogDescription>O endereço https:// que vai receber os avisos (ex.: o “Production URL” do nó Webhook do n8n).</DialogDescription>
          </DialogHeader>
          {newEp && (
            <div className="space-y-3">
              <Input placeholder="https://..." maxLength={500} value={newEp.url} onChange={(e) => setNewEp({ ...newEp, url: e.target.value })} />
              <Checks options={EVENTS} value={newEp.events} onChange={(events) => setNewEp({ ...newEp, events })} />
              {newEp.id && (
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={newEp.active} onChange={(e) => setNewEp({ ...newEp, active: e.target.checked })} />
                  Ativo (religar zera a contagem de falhas)
                </label>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewEp(null)}>Cancelar</Button>
            <Button onClick={() => void saveEp()} disabled={busy}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <OneTimeSecret title={secret?.title ?? ""} value={secret?.value ?? null} onClose={() => setSecret(null)} />
    </div>
  );
}
