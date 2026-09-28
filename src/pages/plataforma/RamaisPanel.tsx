import { useCallback, useEffect, useState } from "react";
import { Phone, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Ext {
  id: string; number: string; label: string | null; sip_user: string; sip_domain: string; wss_url: string | null;
  provider: string; has_password: boolean; user_id: string | null; mode: string;
}
type Form = { id: string | null; number: string; label: string; sip_user: string; sip_domain: string; wss_url: string; provider: string; password: string };
const MODE: Record<string, string> = { webrtc: "Navegador", sip: "MicroSIP/aparelho", off: "Desligado" };

/**
 * Ramais do PBX contratado com a Clubetec: a equipe cadastra número, usuário,
 * servidor e senha (a senha vai direto para o cofre e nunca volta para esta tela).
 * O dono da empresa escolhe o atendente de cada ramal em Equipe.
 */
export function RamaisPanel({ orgs }: { orgs: { id: string; name: string }[] }) {
  const { toast } = useToast();
  const [orgId, setOrgId] = useState("");
  const [rows, setRows] = useState<Ext[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) { setRows([]); return; }
    const { data } = await supabase.from("pbx_extensions")
      .select("id, number, label, sip_user, sip_domain, wss_url, provider, has_password, user_id, mode")
      .eq("organization_id", orgId).order("number");
    setRows((data as Ext[]) ?? []);
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);

  const novo = () => {
    const last = rows[rows.length - 1];
    setForm({ id: null, number: "", label: "", sip_user: "", sip_domain: last?.sip_domain ?? "",
      wss_url: last?.wss_url ?? "", provider: last?.provider ?? "handphone", password: "" });
  };
  const save = async () => {
    if (!form) return;
    setBusy(true);
    const { error } = await supabase.rpc("operator_save_extension", {
      org: orgId, ext: form.id, p_number: form.number.trim(), p_sip_user: (form.sip_user || form.number).trim(),
      p_sip_domain: form.sip_domain.trim(), p_wss_url: form.wss_url.trim(), p_provider: form.provider,
      p_label: form.label.trim(), p_password: form.password,
    });
    setBusy(false);
    if (error) {
      toast({ variant: "destructive", title: "Não salvou", description: error.message.includes("check") ? "Confira número (só dígitos), servidor e endereço wss://" : error.message });
      return;
    }
    toast({ title: "Ramal salvo" });
    setForm(null);
    void load();
  };
  const remove = async (e: Ext) => {
    if (!window.confirm(`Excluir o ramal ${e.number}? O histórico de ligações continua.`)) return;
    const { error } = await supabase.rpc("operator_delete_extension", { ext: e.id });
    if (error) toast({ variant: "destructive", title: "Não excluiu", description: error.message });
    void load();
  };
  const set = (k: keyof Form) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => (f ? { ...f, [k]: ev.target.value } : f));

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="font-semibold flex items-center gap-2"><Phone className="w-4 h-4" /> Ramais (PBX contratado com a Clubetec)</h2>
      <p className="text-sm text-muted-foreground">Cadastre os ramais da empresa; eles chegam prontos. O dono escolhe o atendente de cada ramal em Equipe,
        e cada atendente usa no navegador (WebRTC), no MicroSIP/aparelho, ou desliga.</p>
      <div className="flex flex-wrap gap-2 items-center">
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={orgId} onChange={(e) => { setOrgId(e.target.value); setForm(null); }}>
          <option value="">Escolha a empresa…</option>
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        {orgId && <Button size="sm" onClick={novo}><Plus className="w-4 h-4 mr-1" /> Novo ramal</Button>}
      </div>

      {form && (
        <div className="grid gap-2 sm:grid-cols-4 rounded-md border p-3 bg-muted/30">
          <Input placeholder="Número (ex.: 201)" value={form.number} onChange={set("number")} />
          <Input placeholder="Nome (ex.: Recepção)" value={form.label} onChange={set("label")} />
          <Input placeholder="Usuário SIP (vazio = número)" value={form.sip_user} onChange={set("sip_user")} />
          <Input type="password" autoComplete="new-password" placeholder={form.id ? "Senha (vazio = manter)" : "Senha do ramal"} value={form.password} onChange={set("password")} />
          <Input className="sm:col-span-2" placeholder="Servidor/domínio SIP (ex.: pbx.handphone.com.br)" value={form.sip_domain} onChange={set("sip_domain")} />
          <Input className="sm:col-span-2" placeholder="WebRTC: wss://servidor:porta/ws (vazio = só MicroSIP/aparelho)" value={form.wss_url} onChange={set("wss_url")} />
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={form.provider} onChange={set("provider")}>
            <option value="handphone">Handphone</option><option value="nvoip">Nvoip</option><option value="outro">Outra central</option>
          </select>
          <div className="sm:col-span-3 flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setForm(null)}>Cancelar</Button>
            <Button size="sm" disabled={busy || !form.number || !form.sip_domain} onClick={save}>{busy ? "Salvando…" : "Salvar ramal"}</Button>
          </div>
        </div>
      )}

      {orgId && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Ramal</TableHead><TableHead>Usuário / servidor</TableHead><TableHead>WebRTC</TableHead>
              <TableHead>Senha</TableHead><TableHead>Atendente</TableHead><TableHead>Modo</TableHead><TableHead />
            </TableRow></TableHeader>
            <TableBody>
              {rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground">Nenhum ramal ainda.</TableCell></TableRow>}
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.number}{e.label ? ` · ${e.label}` : ""}</TableCell>
                  <TableCell className="text-xs">{e.sip_user}@{e.sip_domain}</TableCell>
                  <TableCell>{e.wss_url ? <Badge>Pronto</Badge> : <Badge variant="outline">Só SIP</Badge>}</TableCell>
                  <TableCell>{e.has_password ? "✓ no cofre" : <span className="text-destructive">falta</span>}</TableCell>
                  <TableCell>{e.user_id ? "Atribuído" : <span className="text-muted-foreground">Livre</span>}</TableCell>
                  <TableCell className="text-xs">{MODE[e.mode] ?? e.mode}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setForm({ id: e.id, number: e.number, label: e.label ?? "", sip_user: e.sip_user,
                      sip_domain: e.sip_domain, wss_url: e.wss_url ?? "", provider: e.provider, password: "" })}>Editar</Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(e)} title="Excluir"><Trash2 className="w-4 h-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
