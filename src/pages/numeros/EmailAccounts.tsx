import { useCallback, useEffect, useState } from "react";
import { Mail, MoreHorizontal, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Account {
  id: string; name: string; address: string; username: string; imap_host: string; imap_port: number;
  smtp_host: string; smtp_port: number; department_id: string | null; signature: string | null; status: string; ai_reply: boolean;
  health_status: string | null; health_error: string | null; last_sync_at: string | null; has_password: boolean;
}
type Draft = Omit<Account, "id" | "status" | "health_status" | "health_error" | "last_sync_at" | "has_password"> & { id?: string; password: string };

/** Provedores comuns: o dono só escolhe e informa e-mail e senha. */
const PRESETS: Record<string, { label: string; imap: string; imapPort: number; smtp: string; smtpPort: number; tip?: string }> = {
  hostinger: { label: "Hostinger", imap: "imap.hostinger.com", imapPort: 993, smtp: "smtp.hostinger.com", smtpPort: 465 },
  gmail: { label: "Gmail / Google Workspace", imap: "imap.gmail.com", imapPort: 993, smtp: "smtp.gmail.com", smtpPort: 465,
    tip: "Use uma senha de app: Conta Google → Segurança → Verificação em duas etapas → Senhas de app." },
  outlook: { label: "Outlook / Microsoft 365", imap: "outlook.office365.com", imapPort: 993, smtp: "smtp.office365.com", smtpPort: 587,
    tip: "Algumas contas Microsoft 365 bloqueiam senha em apps; se o teste falhar, fale com o administrador ou com o time Clubetec." },
  locaweb: { label: "Locaweb", imap: "email-ssl.com.br", imapPort: 993, smtp: "email-ssl.com.br", smtpPort: 465 },
  zoho: { label: "Zoho Mail", imap: "imap.zoho.com", imapPort: 993, smtp: "smtp.zoho.com", smtpPort: 465 },
  outro: { label: "Outro (informar servidores)", imap: "", imapPort: 993, smtp: "", smtpPort: 465 },
};
const EMPTY: Draft = { name: "", address: "", username: "", password: "", imap_host: "", imap_port: 993, smtp_host: "", smtp_port: 465, department_id: null, signature: "", ai_reply: false };
const when = (d: string | null) => (d ? new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

/** Caixas de e-mail da empresa (canal de atendimento). O dono conecta sozinho. */
export function EmailAccounts({ orgId }: { orgId: string }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Account[]>([]);
  const [depts, setDepts] = useState<{ id: string; name: string }[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preset, setPreset] = useState("hostinger");
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ imap: { ok: boolean; error: string }; smtp: { ok: boolean; error: string } } | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);

  const load = useCallback(async () => {
    const [a, d] = await Promise.all([
      supabase.from("email_accounts").select("id, name, address, username, imap_host, imap_port, smtp_host, smtp_port, department_id, signature, ai_reply, status, health_status, health_error, last_sync_at, has_password")
        .eq("organization_id", orgId).order("created_at"),
      supabase.from("departments").select("id, name").eq("organization_id", orgId).order("name"),
    ]);
    setRows((a.data as Account[]) ?? []);
    setDepts(d.data ?? []);
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const applyPreset = (key: string) => {
    setPreset(key);
    const p = PRESETS[key];
    set({ imap_host: p.imap, imap_port: p.imapPort, smtp_host: p.smtp, smtp_port: p.smtpPort });
  };
  const openNew = () => {
    const p = PRESETS.hostinger;
    setPreset("hostinger"); setTest(null);
    setDraft({ ...EMPTY, imap_host: p.imap, imap_port: p.imapPort, smtp_host: p.smtp, smtp_port: p.smtpPort });
  };
  const openEdit = (a: Account) => {
    setPreset(Object.keys(PRESETS).find((k) => PRESETS[k].imap === a.imap_host) ?? "outro"); setTest(null);
    setDraft({ id: a.id, name: a.name, address: a.address, username: a.username, password: "", imap_host: a.imap_host, imap_port: a.imap_port,
      smtp_host: a.smtp_host, smtp_port: a.smtp_port, department_id: a.department_id, signature: a.signature ?? "", ai_reply: !!a.ai_reply });
  };

  const runTest = async () => {
    if (!draft) return;
    if (!draft.password && !draft.id) return toast({ variant: "destructive", title: "Informe a senha para testar" });
    setBusy(true); setTest(null);
    const r = await callFunction<{ imap: { ok: boolean; error: string }; smtp: { ok: boolean; error: string } }>("manage-email", {
      action: "test", organization_id: orgId, account_id: draft.id, password: draft.password || undefined,
      username: draft.username || draft.address, imap_host: draft.imap_host, imap_port: draft.imap_port,
      smtp_host: draft.smtp_host, smtp_port: draft.smtp_port,
    });
    setBusy(false);
    if (!r.ok) return toast({ variant: "destructive", title: r.message });
    setTest({ imap: r.data.imap, smtp: r.data.smtp });
  };

  const save = async () => {
    if (!draft) return;
    const address = draft.address.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return toast({ variant: "destructive", title: "E-mail inválido" });
    if (!draft.id && !draft.password) return toast({ variant: "destructive", title: "Informe a senha" });
    setBusy(true);
    const row = {
      name: draft.name.trim() || address, address, username: (draft.username || address).trim(),
      imap_host: draft.imap_host.trim(), imap_port: draft.imap_port, smtp_host: draft.smtp_host.trim(), smtp_port: draft.smtp_port,
      department_id: draft.department_id || null, signature: draft.signature?.trim() || null, ai_reply: !!draft.ai_reply,
    };
    const res = draft.id
      ? await supabase.from("email_accounts").update(row).eq("id", draft.id).select("id").single()
      : await supabase.from("email_accounts").insert({ ...row, organization_id: orgId }).select("id").single();
    if (res.error || !res.data) {
      setBusy(false);
      return toast({ variant: "destructive", title: "Não foi possível salvar", description: res.error?.code === "23505" ? "Esta caixa já está cadastrada." : "Confira os servidores e o e-mail." });
    }
    if (draft.password) {
      const { error } = await supabase.rpc("set_email_password", { account: res.data.id, secret_value: draft.password });
      if (error) { setBusy(false); return toast({ variant: "destructive", title: "Caixa salva, mas a senha não" }); }
    }
    setBusy(false);
    setDraft(null);
    toast({ title: "Caixa salva", description: "Os e-mails novos passam a chegar em até 1 minuto." });
    void load();
  };

  const toggle = async (a: Account) => {
    const { error } = await supabase.from("email_accounts").update({ status: a.status === "active" ? "disabled" : "active" }).eq("id", a.id);
    if (error) return toast({ variant: "destructive", title: "Sem permissão" });
    void load();
  };
  const remove = async () => {
    if (!deleting) return;
    const { error } = await supabase.from("email_accounts").delete().eq("id", deleting.id);
    setDeleting(null);
    if (error) return toast({ variant: "destructive", title: "Não foi possível excluir" });
    void load();
  };

  const tip = PRESETS[preset]?.tip;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">E-mails</h2>
          <p className="text-xs text-muted-foreground">E-mails recebidos viram atendimentos, como no WhatsApp. As respostas saem pela mesma caixa.</p>
        </div>
        <Button variant="outline" onClick={openNew}><Plus className="w-4 h-4 mr-1" /> Conectar e-mail</Button>
      </div>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma caixa conectada.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((a) => (
          <div key={a.id} className="rounded-lg border p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium truncate">{a.name}</p>
                  <p className="text-sm text-muted-foreground truncate">{a.address}</p>
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Ações"><MoreHorizontal className="w-4 h-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openEdit(a)}>Editar e testar</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => toggle(a)}>{a.status === "active" ? "Desativar" : "Reativar"}</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive" onClick={() => setDeleting(a)}>Excluir</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex flex-wrap gap-2">
              {a.status === "disabled" ? <Badge variant="outline">Desativada</Badge>
                : a.health_status === "critical" ? <Badge variant="destructive">Com problema</Badge>
                : a.health_status === "warning" ? <Badge variant="outline">Atenção</Badge>
                : a.last_sync_at ? <Badge variant="secondary">Recebendo</Badge> : <Badge variant="outline">Aguardando 1ª leitura</Badge>}
              {a.department_id && <Badge variant="outline">{depts.find((d) => d.id === a.department_id)?.name ?? "Departamento"}</Badge>}
            </div>
            {!a.department_id && a.status !== "disabled" && (
              <p className="text-xs rounded-md bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200 p-2">
                Sem setor: os e-mails desta caixa caem na Fila geral, sem dono. Em ⋯ → Editar, escolha o setor que atende esta caixa.
              </p>
            )}
            {a.status !== "disabled" && a.health_error && <p className="text-sm text-destructive">{a.health_error}</p>}
            <p className="text-xs text-muted-foreground">Última leitura: {when(a.last_sync_at)}</p>
          </div>
        ))}
      </div>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Editar caixa de e-mail" : "Conectar e-mail"}</DialogTitle>
            <DialogDescription>A senha fica guardada no cofre e não aparece de novo. A primeira leitura começa a partir de agora (e-mails antigos não são importados).</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Provedor</Label>
                <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={preset} onChange={(e) => applyPreset(e.target.value)}>
                  {Object.entries(PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
                </select>
                {tip && <p className="text-xs text-muted-foreground">{tip}</p>}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input placeholder="Nome (ex.: Contato)" maxLength={80} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
                <Input placeholder="E-mail (ex.: contato@empresa.com.br)" type="email" value={draft.address} onChange={(e) => set({ address: e.target.value })} />
                <Input placeholder="Usuário (vazio = o próprio e-mail)" value={draft.username} onChange={(e) => set({ username: e.target.value })} />
                <Input placeholder={draft.id ? "Senha (vazio = manter a atual)" : "Senha"} type="password" autoComplete="new-password"
                  value={draft.password} onChange={(e) => set({ password: e.target.value })} />
              </div>
              <div className="grid gap-2 grid-cols-[1fr_90px]">
                <Input placeholder="Servidor de entrada (IMAP)" value={draft.imap_host} onChange={(e) => set({ imap_host: e.target.value })} />
                <select className="h-9 rounded-md border bg-background px-2 text-sm" value={draft.imap_port} onChange={(e) => set({ imap_port: Number(e.target.value) })}>
                  <option value={993}>993</option><option value={143}>143</option>
                </select>
                <Input placeholder="Servidor de saída (SMTP)" value={draft.smtp_host} onChange={(e) => set({ smtp_host: e.target.value })} />
                <select className="h-9 rounded-md border bg-background px-2 text-sm" value={draft.smtp_port} onChange={(e) => set({ smtp_port: Number(e.target.value) })}>
                  <option value={465}>465</option><option value={587}>587</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Departamento que recebe os e-mails</Label>
                <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={draft.department_id ?? ""} onChange={(e) => set({ department_id: e.target.value || null })}>
                  <option value="">Fila geral</option>
                  {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <Textarea rows={3} placeholder="Assinatura (opcional)" maxLength={2000} value={draft.signature ?? ""} onChange={(e) => set({ signature: e.target.value })} />
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={!!draft.ai_reply} onChange={(e) => set({ ai_reply: e.target.checked })} />
                <span>
                  <span className="font-medium">IA responde os e-mails</span>
                  <span className="block text-xs text-muted-foreground">
                    A IA responde na hora, com as informações e documentos da empresa, e passa para a equipe quando precisa. Avisos
                    automáticos (cobrança, cadastro, newsletter) nunca são respondidos. Precisa do assistente de IA ligado.
                  </span>
                </span>
              </label>
              {test && (
                <div className="rounded-md border p-2 text-sm space-y-1">
                  <p>{test.imap.ok ? "✅ Recebimento (IMAP) ok" : `❌ Recebimento: ${test.imap.error}`}</p>
                  <p>{test.smtp.ok ? "✅ Envio (SMTP) ok" : `❌ Envio: ${test.smtp.error}`}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={runTest} disabled={busy}>{busy ? "Testando..." : "Testar conexão"}</Button>
            <Button onClick={save} disabled={busy}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir a caixa “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              As conversas e mensagens de e-mail desta caixa são apagadas do sistema (os e-mails continuam no seu provedor). Para só parar de receber, use “Desativar”.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
