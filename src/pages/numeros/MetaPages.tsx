import { useCallback, useEffect, useState } from "react";
import { Facebook, Instagram } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { FacebookButton } from "./MetaConnect";

interface Page {
  id: string; page_id: string; name: string; ig_account_id: string | null; ig_username: string | null;
  messenger: boolean; instagram: boolean; ai_reply: boolean; department_id: string | null; status: string; last_error: string | null;
}

/**
 * Números → Facebook e Instagram: a Página do Facebook (e o Instagram ligado a ela)
 * entra no atendimento como mais um canal. Dono/admin conecta com o ID e o token da
 * Página (o token vai para o cofre e não aparece de novo).
 */
export function MetaPages({ orgId }: { orgId: string }) {
  const { can, hasModule } = useOrg();
  const { toast } = useToast();
  const [pages, setPages] = useState<Page[]>([]);
  const [depts, setDepts] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState<{ page_id: string; token: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const manage = can("org.settings");

  const load = useCallback(async () => {
    const [p, d] = await Promise.all([
      supabase.from("meta_pages").select("id, page_id, name, ig_account_id, ig_username, messenger, instagram, ai_reply, department_id, status, last_error")
        .eq("organization_id", orgId).neq("status", "disconnected").order("created_at"),
      supabase.from("departments").select("id, name").eq("organization_id", orgId).order("name"),
    ]);
    setPages((p.data as Page[]) ?? []);
    setDepts(d.data ?? []);
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);
  if (!hasModule("canais") || (!manage && !pages.length)) return null;

  const connect = async () => {
    if (!form) return;
    setBusy(true);
    const r = await callFunction<{ name: string; instagram: string | null; subscribed: boolean }>("meta-pages", {
      action: "connect", organization_id: orgId, page_id: form.page_id.trim(), token: form.token.trim(),
    });
    setBusy(false);
    if (!r.ok) return toast({ variant: "destructive", title: "Não conectou", description: r.message });
    toast({ title: `Página ${r.data.name} conectada`, description: r.data.instagram ? `Instagram @${r.data.instagram} também.` : "Sem Instagram ligado a esta Página." });
    setForm(null);
    void load();
  };
  const update = async (p: Page, patch: Partial<Page>) => {
    const n = { ...p, ...patch };
    const { error } = await supabase.rpc("set_meta_page", {
      page: p.id, p_department: n.department_id as string, p_ai_reply: n.ai_reply, p_messenger: n.messenger, p_instagram: n.instagram,
    });
    if (error) return toast({ variant: "destructive", title: "Não salvou", description: error.message });
    void load();
  };
  const disconnect = async (p: Page) => {
    if (!window.confirm(`Desconectar a Página ${p.name}? As mensagens novas param de chegar; o histórico continua.`)) return;
    const r = await callFunction("meta-pages", { action: "disconnect", page: p.id });
    if (!r.ok) return toast({ variant: "destructive", title: "Não desconectou", description: r.message });
    void load();
  };

  return (
    <section className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium inline-flex items-center gap-2"><Facebook className="w-4 h-4" /><Instagram className="w-4 h-4" /> Facebook e Instagram</p>
        {manage && !form && (
          <span className="flex flex-wrap gap-2">
            <FacebookButton orgId={orgId} kind="pages" />
            <Button size="sm" variant="ghost" onClick={() => setForm({ page_id: "", token: "" })}>Manual (avançado)</Button>
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Mensagens do Messenger e do Instagram Direct chegam em Conversas, como o WhatsApp. A Meta só deixa responder até 24 h depois da última mensagem da pessoa.
      </p>
      {form && (
        <div className="rounded-md border p-3 space-y-2 bg-muted/30">
          <ol className="list-decimal pl-5 text-xs text-muted-foreground space-y-0.5">
            <li>No Gerenciador de Negócios da Meta, em Configurações do negócio → Usuários do sistema, gere um token para a Página com as permissões de mensagens.</li>
            <li>O ID da Página está em Página → Sobre → Transparência da Página (só números).</li>
            <li>Para o Instagram, a conta profissional precisa estar ligada a esta Página.</li>
          </ol>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="ID da Página (só números)" value={form.page_id} onChange={(e) => setForm({ ...form, page_id: e.target.value })} />
            <Input type="password" autoComplete="off" placeholder="Token da Página" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
          </div>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setForm(null)}>Cancelar</Button>
            <Button size="sm" disabled={busy || !form.page_id.trim() || form.token.trim().length < 20} onClick={() => void connect()}>{busy ? "Conferindo..." : "Conectar"}</Button>
          </div>
        </div>
      )}
      {pages.map((p) => (
        <div key={p.id} className="rounded-md border p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">{p.name}{p.ig_username ? ` · @${p.ig_username}` : ""}</span>
            <span className={`text-xs rounded-full px-2 py-0.5 ${p.status === "connected" ? "bg-success-soft text-success-text" : "bg-danger-soft text-danger-text"}`}>
              {p.status === "connected" ? "Conectada" : "Com problema"}
            </span>
          </div>
          {p.last_error && p.status !== "connected" && <p className="text-xs text-danger-text">{p.last_error}</p>}
          {manage && (
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2"><Switch checked={p.messenger} onCheckedChange={(v) => void update(p, { messenger: v })} /> Messenger</label>
              <label className="flex items-center gap-2" title={p.ig_account_id ? "" : "Nenhuma conta do Instagram ligada a esta Página"}>
                <Switch checked={p.instagram} disabled={!p.ig_account_id} onCheckedChange={(v) => void update(p, { instagram: v })} /> Instagram
              </label>
              <label className="flex items-center gap-2"><Switch checked={p.ai_reply} onCheckedChange={(v) => void update(p, { ai_reply: v })} /> IA responde</label>
              <select className="h-8 rounded-md border bg-background px-2 text-sm" value={p.department_id ?? ""} aria-label="Setor"
                onChange={(e) => void update(p, { department_id: e.target.value || null })}>
                <option value="">Fila geral</option>
                {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void disconnect(p)}>Desconectar</Button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
