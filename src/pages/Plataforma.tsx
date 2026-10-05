import { useCallback, useEffect, useState } from "react";
import { PlatformAIPanel } from "./plataforma/PlatformAIPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppHeader } from "@/components/AppHeader";
import { Navigate, useNavigate } from "react-router-dom";
import { LogOut, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { Logo } from "@/components/Logo";
import { RamaisPanel } from "./plataforma/RamaisPanel";
import { ModulesPanel } from "./plataforma/ModulesPanel";
import { BrainUsagePanel } from "./plataforma/BrainUsagePanel";
import { PlansPanel } from "./plataforma/PlansPanel";
import { NetworksPanel } from "./plataforma/NetworksPanel";
import { MainNav } from "@/components/MainNav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface OrgRow {
  id: string; name: string; status: string; template_key: string | null; created_at: string;
  members: number; numbers: number; mailboxes: number; conversations_30d: number;
  last_activity: string | null; support_until: string | null;
}
interface HelpRequest { id: string; organization_id: string; topic: string; message: string; status: string; created_at: string }
const REQ_STATUS: Record<string, string> = { open: "Novo", in_progress: "Em andamento", done: "Concluído", canceled: "Cancelado" };
const when = (d: string | null) => (d ? new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

/** Painel da plataforma (equipe Clubetec): empresas clientes, suporte e suspensão. Só contagens; nada de conversa. */
export default function Plataforma() {
  const { signOut } = useAuth();
  const { isOperator, reload: reloadOrgs } = useOrg();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [rows, setRows] = useState<OrgRow[]>([]);
  const [templates, setTemplates] = useState<{ key: string; name: string }[]>([]);
  const [creating, setCreating] = useState<{ name: string; template: string; email: string } | null>(null);
  const [support, setSupport] = useState<{ org: OrgRow; reason: string; minutes: number } | null>(null);
  const [confirm, setConfirm] = useState<OrgRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [requests, setRequests] = useState<HelpRequest[]>([]);
  const [apps, setApps] = useState<Record<string, boolean>>({});
  const [appForm, setAppForm] = useState({ id: "", secret: "" });
  const [gForm, setGForm] = useState({ id: "", secret: "" });
  const [meta, setMeta] = useState({ app_id: "", config_pages: "", config_whatsapp: "", secret: false, verify_token: false });
  useEffect(() => {
    void supabase.rpc("platform_meta_app").then(({ data }) => {
      const d = (data ?? {}) as { app_id?: string; config_pages?: string; config_whatsapp?: string; secret?: boolean; verify_token?: boolean };
      setMeta({ app_id: d.app_id ?? "", config_pages: d.config_pages ?? "", config_whatsapp: d.config_whatsapp ?? "", secret: !!d.secret, verify_token: !!d.verify_token });
    });
  }, []);

  const load = useCallback(async () => {
    const [o, t, rq] = await Promise.all([
      supabase.rpc("platform_org_overview"),
      supabase.from("org_templates").select("key, name").eq("active", true).order("name"),
      supabase.from("service_requests").select("id, organization_id, topic, message, status, created_at").order("created_at", { ascending: false }).limit(100),
    ]);
    setRequests((rq.data as HelpRequest[]) ?? []);
    const { data: ap } = await supabase.rpc("connector_apps_status");
    setApps((ap as Record<string, boolean> | null) ?? {});
    setRows((o.data as OrgRow[]) ?? []);
    setTemplates(t.data ?? []);
  }, []);
  useEffect(() => { if (isOperator) void load(); }, [isOperator, load]);

  if (!isOperator) return <Navigate to="/" replace />;

  const create = async () => {
    if (!creating) return;
    setBusy(true);
    const r = await callFunction<{ email_sent?: boolean; warning?: string }>("platform-orgs", {
      action: "create", name: creating.name, template_key: creating.template, owner_email: creating.email,
    });
    setBusy(false);
    if (!r.ok) return toast({ variant: "destructive", title: r.message });
    toast({ title: "Empresa criada", description: r.data.warning ?? (r.data.email_sent ? "Convite enviado ao dono por e-mail." : "O dono verá o convite ao entrar.") });
    setCreating(null);
    void load();
  };

  const openSupport = async () => {
    if (!support) return;
    const { error } = await supabase.rpc("platform_open_support", { org: support.org.id, reason: support.reason, minutes: support.minutes });
    if (error) return toast({ variant: "destructive", title: "Acesso não aberto", description: error.message });
    toast({ title: "Acesso de suporte aberto", description: "Escolha a empresa no seletor do topo. Fica registrado na auditoria da empresa." });
    setSupport(null);
    await reloadOrgs();
    void load();
  };
  const closeSupport = async (o: OrgRow) => {
    await supabase.rpc("platform_close_support", { org: o.id });
    await reloadOrgs();
    void load();
  };
  const toggleStatus = async () => {
    if (!confirm) return;
    const { error } = await supabase.rpc("platform_set_org_status", { org: confirm.id, new_status: confirm.status === "active" ? "suspended" : "active" });
    setConfirm(null);
    if (error) return toast({ variant: "destructive", title: "Não alterado", description: error.message });
    void load();
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="plataforma" />

      <main className="flex-1 w-full max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-brand text-2xl leading-tight">Plataforma</h1>
            <p className="text-sm text-muted-foreground">Empresas clientes do Deixa com a IA. Aqui só aparecem contagens; para ver dados de uma empresa, abra um acesso de suporte com motivo e prazo.</p>
          </div>
          <Button onClick={() => setCreating({ name: "", template: "generico", email: "" })}><Plus className="w-4 h-4 mr-1" /> Nova empresa</Button>
        </div>

        <Tabs defaultValue="empresas">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="empresas">Empresas</TabsTrigger>
            <TabsTrigger value="planos">Planos</TabsTrigger>
            <TabsTrigger value="modulos">Módulos</TabsTrigger>
            <TabsTrigger value="ramais">Ramais</TabsTrigger>
            <TabsTrigger value="conectores">Conectores</TabsTrigger>
            <TabsTrigger value="ajuda">Pedidos de ajuda{requests.filter((r) => r.status === "open").length ? ` (${requests.filter((r) => r.status === "open").length})` : ""}</TabsTrigger>
          </TabsList>
          <TabsContent value="empresas" className="pt-4">
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Pessoas</TableHead>
                <TableHead className="text-right">Números</TableHead>
                <TableHead className="text-right">E-mails</TableHead>
                <TableHead className="text-right">Conversas 30 d</TableHead>
                <TableHead>Última atividade</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <div className="font-medium">{o.name}</div>
                    <div className="text-xs text-muted-foreground">desde {when(o.created_at)}</div>
                  </TableCell>
                  <TableCell>
                    {o.status === "active" ? <Badge variant="secondary">Ativa</Badge> : <Badge variant="destructive">Suspensa</Badge>}
                    {o.support_until && <Badge variant="outline" className="ml-1">Suporte até {when(o.support_until).slice(-5)}</Badge>}
                  </TableCell>
                  <TableCell className="text-right">{o.members}</TableCell>
                  <TableCell className="text-right">{o.numbers}</TableCell>
                  <TableCell className="text-right">{o.mailboxes}</TableCell>
                  <TableCell className="text-right">{o.conversations_30d}</TableCell>
                  <TableCell className="text-sm">{when(o.last_activity)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap space-x-1">
                    {o.support_until
                      ? <Button size="sm" variant="outline" onClick={() => closeSupport(o)}>Encerrar suporte</Button>
                      : <Button size="sm" variant="outline" disabled={o.status !== "active"} onClick={() => setSupport({ org: o, reason: "", minutes: 60 })}>Suporte</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(o)}>{o.status === "active" ? "Suspender" : "Reativar"}</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
          </TabsContent>
          <TabsContent value="planos" className="pt-4 space-y-4"><PlansPanel orgs={rows} /><NetworksPanel orgs={rows} /></TabsContent>
          <TabsContent value="modulos" className="pt-4 space-y-4"><ModulesPanel orgs={rows} /><BrainUsagePanel /></TabsContent>
          <TabsContent value="ramais" className="pt-4"><RamaisPanel orgs={rows} /></TabsContent>
          <TabsContent value="conectores" className="pt-4 space-y-4">
            <PlatformAIPanel />
        <section className="space-y-2 rounded-lg border p-4">
          <h2 className="font-semibold">Aplicativo do conector Bling {apps.bling ? <Badge className="ml-2">Ativo</Badge> : <Badge variant="outline" className="ml-2">Não configurado</Badge>}</h2>
          <ol className="list-decimal pl-5 text-xs text-muted-foreground space-y-0.5">
            <li>Entre em developer.bling.com.br com a conta Bling da Clubetec e crie um aplicativo “Deixa com a IA” (tipo: aplicativo público/para terceiros).</li>
            <li>Em “Link de redirecionamento”, use: <code className="select-all">{`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/connectors-callback`}</code></li>
            <li>Escopos: contatos, pedidos de venda e situações (leitura).</li>
            <li>Copie o Client ID e o Client Secret e cole abaixo (vão para o cofre; não aparecem de novo).</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Input className="max-w-xs" placeholder="Client ID" value={appForm.id} onChange={(e) => setAppForm({ ...appForm, id: e.target.value })} />
            <Input className="max-w-xs" type="password" autoComplete="off" placeholder="Client Secret" value={appForm.secret} onChange={(e) => setAppForm({ ...appForm, secret: e.target.value })} />
            <Button variant="outline" disabled={appForm.id.length < 8 || appForm.secret.length < 8} onClick={async () => {
              const { error } = await supabase.rpc("platform_set_connector_app", { connector: "bling", client_id: appForm.id.trim(), client_secret: appForm.secret.trim() });
              if (error) return toast({ variant: "destructive", title: "Não salvo", description: error.message });
              setAppForm({ id: "", secret: "" });
              toast({ title: "Aplicativo do Bling salvo", description: "As empresas já podem conectar em Integrações." });
              void load();
            }}>Salvar</Button>
          </div>
        </section>
        <section className="space-y-2 rounded-lg border p-4">
          <h2 className="font-semibold">App da Meta — “Conectar com o Facebook” {meta.app_id && meta.secret ? <Badge className="ml-2">Ativo</Badge> : <Badge variant="outline" className="ml-2">Incompleto</Badge>}</h2>
          <ol className="list-decimal pl-5 text-xs text-muted-foreground space-y-0.5">
            <li>No app da Meta (developers.facebook.com), adicione o produto <b>Facebook Login for Business</b>. Em Configurações, “URIs de redirecionamento do OAuth válidos”: <code className="select-all">{`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-connect-callback`}</code></li>
            <li>Crie duas <b>configurações</b> de login, ambas com tipo de token <b>“Token de acesso do usuário do sistema”</b> (não vence): uma para Páginas/Instagram (permissões pages_show_list, pages_messaging, pages_manage_metadata, instagram_basic, instagram_manage_messages, business_management) e outra para o WhatsApp (whatsapp_business_management, whatsapp_business_messaging, business_management). Copie o ID de cada uma.</li>
            <li>Produtos Messenger e Instagram: webhook <code className="select-all">{`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/meta-webhook`}</code> com o mesmo token de verificação do WhatsApp; campos messages, messaging_postbacks e message_echoes.</li>
            <li>Peça as permissões acima em Análise do app. Até aprovar, só funciona para quem tem função no app (administrador, desenvolvedor ou testador).</li>
          </ol>
          <p className="text-xs">App Secret no cofre: {meta.secret ? "✓" : "✗ falta"} · token de verificação do webhook: {meta.verify_token ? "✓" : "✗ falta"}</p>
          <div className="flex flex-wrap gap-2">
            <Input className="max-w-[12rem]" placeholder="ID do app" value={meta.app_id} onChange={(e) => setMeta({ ...meta, app_id: e.target.value.trim() })} />
            <Input className="max-w-[14rem]" placeholder="ID da configuração (Páginas)" value={meta.config_pages} onChange={(e) => setMeta({ ...meta, config_pages: e.target.value.trim() })} />
            <Input className="max-w-[14rem]" placeholder="ID da configuração (WhatsApp)" value={meta.config_whatsapp} onChange={(e) => setMeta({ ...meta, config_whatsapp: e.target.value.trim() })} />
            <Button variant="outline" disabled={!/^\d{5,25}$/.test(meta.app_id)} onClick={async () => {
              const { error } = await supabase.rpc("platform_set_meta_app", { p_app_id: meta.app_id, p_config_pages: meta.config_pages, p_config_whatsapp: meta.config_whatsapp });
              if (error) return toast({ variant: "destructive", title: "Não salvo", description: error.message });
              toast({ title: "App da Meta salvo", description: "O botão Conectar com o Facebook já usa estes dados." });
            }}>Salvar</Button>
          </div>
        </section>
        <section className="space-y-2 rounded-lg border p-4">
          <h2 className="font-semibold">Aplicativo do Google Agenda {apps.google_agenda ? <Badge className="ml-2">Ativo</Badge> : <Badge variant="outline" className="ml-2">Não configurado</Badge>}</h2>
          <ol className="list-decimal pl-5 text-xs text-muted-foreground space-y-0.5">
            <li>No Google Cloud (console.cloud.google.com), com a conta da Clubetec, crie o projeto “Deixa com a IA” e ative a Google Calendar API.</li>
            <li>Tela de consentimento OAuth: tipo Externo, nome “Deixa com a IA”, e-mail de suporte, links da política de privacidade e dos termos; escopos <code>calendar.events</code> e <code>calendar.freebusy</code>. Para sair do modo de teste, o Google revisa o app.</li>
            <li>Credenciais → Criar ID do cliente OAuth → Aplicativo da Web. Em “URIs de redirecionamento autorizados”: <code className="select-all">{`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/connectors-callback`}</code></li>
            <li>Copie o ID do cliente e a chave secreta e cole abaixo (vão para o cofre; não aparecem de novo).</li>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Input className="max-w-xs" placeholder="ID do cliente" value={gForm.id} onChange={(e) => setGForm({ ...gForm, id: e.target.value })} />
            <Input className="max-w-xs" type="password" autoComplete="off" placeholder="Chave secreta do cliente" value={gForm.secret} onChange={(e) => setGForm({ ...gForm, secret: e.target.value })} />
            <Button variant="outline" disabled={gForm.id.length < 8 || gForm.secret.length < 8} onClick={async () => {
              const { error } = await supabase.rpc("platform_set_connector_app", { connector: "google_agenda", client_id: gForm.id.trim(), client_secret: gForm.secret.trim() });
              if (error) return toast({ variant: "destructive", title: "Não salvo", description: error.message });
              setGForm({ id: "", secret: "" });
              toast({ title: "Aplicativo do Google salvo", description: "As empresas já podem conectar o Google Agenda em Integrações." });
              void load();
            }}>Salvar</Button>
          </div>
        </section>
          </TabsContent>
          <TabsContent value="ajuda" className="pt-4">
        <section className="space-y-2">
          <h2 className="font-semibold">Pedidos de ajuda (serviço Clubetec)</h2>
          {requests.length === 0 && <p className="text-sm text-muted-foreground">Nenhum pedido.</p>}
          {requests.map((r) => (
            <div key={r.id} className="rounded-md border p-3 text-sm space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{rows.find((o) => o.id === r.organization_id)?.name ?? "Empresa"}</span>
                <span className="text-muted-foreground">· {r.topic} · {when(r.created_at)}</span>
                <select className="ml-auto h-8 rounded-md border bg-background px-2 text-xs" value={r.status}
                  onChange={async (e) => {
                    const { error } = await supabase.rpc("platform_set_request_status", { request: r.id, new_status: e.target.value });
                    if (error) return toast({ variant: "destructive", title: "Não alterado" });
                    void load();
                  }}>
                  {Object.entries(REQ_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <p className="whitespace-pre-wrap text-muted-foreground">{r.message}</p>
            </div>
          ))}
        </section>
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={!!creating} onOpenChange={(o) => !o && setCreating(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova empresa</DialogTitle>
            <DialogDescription>O modelo cria funil, departamentos e o prompt inicial da IA. O dono recebe um convite por e-mail e configura o resto sozinho.</DialogDescription>
          </DialogHeader>
          {creating && (
            <div className="space-y-2">
              <Input placeholder="Nome da empresa" maxLength={120} value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} />
              <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={creating.template}
                onChange={(e) => setCreating({ ...creating, template: e.target.value })}>
                {templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
              </select>
              <Input placeholder="E-mail do dono" type="email" value={creating.email} onChange={(e) => setCreating({ ...creating, email: e.target.value })} />
            </div>
          )}
          <DialogFooter><Button onClick={create} disabled={busy}>{busy ? "Criando..." : "Criar e convidar"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!support} onOpenChange={(o) => !o && setSupport(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Acesso de suporte — {support?.org.name}</DialogTitle>
            <DialogDescription>Você passa a ver os dados desta empresa (como admin, sem mexer em pessoas e cobrança) até o prazo acabar. O motivo fica na auditoria da empresa.</DialogDescription>
          </DialogHeader>
          {support && (
            <div className="space-y-2">
              <Textarea rows={3} maxLength={500} placeholder="Motivo (ex.: cliente pediu ajuda para montar o fluxo)" value={support.reason}
                onChange={(e) => setSupport({ ...support, reason: e.target.value })} />
              <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={support.minutes}
                onChange={(e) => setSupport({ ...support, minutes: Number(e.target.value) })}>
                <option value={30}>30 minutos</option><option value={60}>1 hora</option><option value={120}>2 horas</option>
              </select>
            </div>
          )}
          <DialogFooter><Button onClick={openSupport} disabled={(support?.reason.trim().length ?? 0) < 10}>Abrir acesso</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm?.status === "active" ? "Suspender" : "Reativar"} {confirm?.name}?</DialogTitle>
            <DialogDescription>
              {confirm?.status === "active"
                ? "Ninguém da empresa entra, e mensagens novas de WhatsApp e e-mail deixam de ser atendidas até reativar. Os dados ficam guardados."
                : "A empresa volta a funcionar normalmente."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancelar</Button>
            <Button variant={confirm?.status === "active" ? "destructive" : "default"} onClick={toggleStatus}>Confirmar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
