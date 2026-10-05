import { useCallback, useEffect, useState } from "react";
import { Download, Phone, Plus, Trash2, Upload, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { extStatus } from "@/lib/extStatus";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Ext {
  id: string; number: string; label: string | null; sip_user: string; sip_domain: string; wss_url: string | null;
  provider: string; has_password: boolean; user_id: string | null; mode: string;
  reg_state: string | null; reg_detail: string | null; reg_at: string | null;
}
type Form = { id: string | null; number: string; label: string; sip_user: string; sip_domain: string; wss_url: string; provider: string; password: string; user_id: string };
interface Member { user_id: string; name: string; email: string; role: string }
const ROLE: Record<string, string> = { owner: "dono", admin: "admin", supervisor: "supervisor", agent: "atendente" };

/** Planilha: colunas numero; usuario_sip; senha; email_atendente (separador ; , ou tab — colar do Excel funciona). */
function parseSheet(text: string) {
  return text.split(/\r?\n/).map((l) => l.split(/\t|;|,/).map((c) => c.trim().replace(/^"|"$/g, "")))
    .filter((c) => /^\d{2,12}$/.test(c[0] ?? ""))
    .map((c) => ({ number: c[0], sip_user: c[1] || c[0], password: c[2] ?? "", email: (c[3] ?? "").toLowerCase() }));
}
type TestResult = { ok: boolean; text: string } | null;

/** Centrais pré-configuradas: o dono só informa o servidor e as credenciais. */
export const CENTRAIS: { key: string; label: string; domain: string; wss: string; tip: string }[] = [
  { key: "asterisk", label: "Asterisk / FreePBX / Issabel", domain: "pbx.suaempresa.com.br", wss: "wss://pbx.suaempresa.com.br:8089/ws",
    tip: "Na central: ative WebRTC no ramal (transport WSS, ICE, DTLS) e use a porta 8089 com certificado válido. Sem WebRTC, use o MicroSIP." },
  { key: "3cx", label: "3CX", domain: "suaempresa.3cx.com.br", wss: "",
    tip: "Use o usuário e a senha de autenticação do ramal (em Ramal → Telefone IP). O telefone do navegador do 3CX é próprio: aqui o ramal funciona pelo MicroSIP/aparelho." },
  { key: "nvoip", label: "Nvoip", domain: "app.nvoip.com.br", wss: "",
    tip: "Os mesmos dados do MicroSIP. Para o histórico e o clique-para-ligar, conecte a Nvoip no cartão acima." },
  { key: "handphone", label: "Handphone", domain: "pbx.handphone.com.br", wss: "", tip: "Os mesmos dados que a Handphone enviou para o MicroSIP." },
  { key: "outro", label: "Outra central SIP", domain: "", wss: "",
    tip: "Qualquer central SIP: servidor, usuário e senha do ramal. Para o telefone no navegador, a central precisa oferecer WebRTC (endereço wss://)." },
];
const presetOf = (k: string) => CENTRAIS.find((c) => c.key === k) ?? CENTRAIS[CENTRAIS.length - 1];


/** Liga na central só para conferir os dados digitados (não salva nada). */
async function testExtension(f: Form): Promise<{ ok: boolean; text: string }> {
  const wss = f.wss_url.trim();
  if (!wss) return { ok: false, text: "Sem endereço WebRTC (wss): o atendente usa o MicroSIP. Teste no MicroSIP com os mesmos usuário, senha e servidor." };
  if (!f.password) {
    // Sem a senha só dá para ver se o servidor WebRTC responde.
    return new Promise((resolve) => {
      let ws: WebSocket;
      const done = (r: { ok: boolean; text: string }) => { clearTimeout(t); try { ws.close(); } catch { /* fechado */ } resolve(r); };
      const t = setTimeout(() => done({ ok: false, text: "O servidor WebRTC não respondeu em 8 s." }), 8000);
      try { ws = new WebSocket(wss, "sip"); } catch { return done({ ok: false, text: "Endereço wss inválido." }); }
      ws.onopen = () => done({ ok: true, text: "Servidor WebRTC respondeu. Para testar usuário e senha, digite a senha e teste de novo." });
      ws.onerror = () => done({ ok: false, text: "Não conectou ao servidor WebRTC (endereço, porta ou certificado)." });
    });
  }
  const { Softphone } = await import("@/lib/softphone");
  return new Promise((resolve) => {
    let sp: InstanceType<typeof Softphone> | null = null;
    const done = (r: { ok: boolean; text: string }) => { clearTimeout(t); void sp?.stop(); resolve(r); };
    const t = setTimeout(() => done({ ok: false, text: "A central não respondeu em 12 s." }), 12000);
    try {
      sp = new Softphone({ wss, domain: f.sip_domain.trim(), user: (f.sip_user || f.number).trim(), password: f.password }, {
        onPhone: (s, d) => {
          if (s === "ready") done({ ok: true, text: "Registrou na central: usuário, senha e servidor estão certos. ✓" });
          if (s === "error") done({ ok: false, text: d || "A central recusou." });
        },
        onCall: () => undefined,
      });
      void sp.start();
    } catch (e) { done({ ok: false, text: (e as Error).message }); }
  });
}

/**
 * Ramais do PBX contratado com a Clubetec: a equipe cadastra número, usuário,
 * servidor e senha (a senha vai direto para o cofre e nunca volta para esta tela).
 * O dono da empresa escolhe o atendente de cada ramal em Configurar → Ramais.
 */
export function RamaisPanel({ orgs, self }: { orgs: { id: string; name: string }[]; self?: boolean }) {
  const { toast } = useToast();
  const [orgId, setOrgId] = useState(self ? orgs[0]?.id ?? "" : "");
  const [rows, setRows] = useState<Ext[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [imp, setImp] = useState<{ text: string; domain: string; wss: string; provider: string } | null>(null);
  const [report, setReport] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    if (!orgId) { setRows([]); return; }
    const { data } = await supabase.from("pbx_extensions")
      .select("id, number, label, sip_user, sip_domain, wss_url, provider, has_password, user_id, mode, reg_state, reg_detail, reg_at")
      .eq("organization_id", orgId).order("number");
    setRows((data as Ext[]) ?? []);
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setMembers([]);
    if (!orgId) return;
    if (!self) { void supabase.rpc("operator_org_members", { org: orgId }).then(({ data }) => setMembers((data as Member[]) ?? [])); return; }
    // Dono/admin: a própria equipe (nome nesta empresa + e-mail).
    void (async () => {
      const { data: ms } = await supabase.from("organization_members").select("user_id, display_name, role").eq("organization_id", orgId).eq("status", "active");
      const ids = (ms ?? []).map((m) => m.user_id);
      const { data: ps } = ids.length ? await supabase.from("profiles").select("user_id, email").in("user_id", ids) : { data: [] };
      const mail = new Map((ps ?? []).map((p) => [p.user_id, p.email ?? ""]));
      setMembers((ms ?? []).map((m) => ({ user_id: m.user_id, role: m.role, email: mail.get(m.user_id) ?? "",
        name: m.display_name || (mail.get(m.user_id) ?? "").split("@")[0] || "Sem nome" })));
    })();
  }, [orgId, self]);
  const memberName = (id: string | null) => (id ? members.find((m) => m.user_id === id)?.name ?? "Atribuído" : null);
  // Status ao vivo: atualiza a cada 30 s.
  useEffect(() => {
    if (!orgId) return;
    const t = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(t);
  }, [orgId, load]);
  useEffect(() => { if (orgs.length === 1 && !orgId) setOrgId(orgs[0].id); }, [orgs, orgId]);

  const edit = (f: Form | null) => { setForm(f); setResult(null); };
  const novo = () => {
    const last = rows[rows.length - 1];
    edit({ id: null, number: "", label: "", sip_user: "", sip_domain: last?.sip_domain ?? "",
      wss_url: last?.wss_url ?? "", provider: last?.provider ?? (self ? "asterisk" : "handphone"), password: "", user_id: "" });
  };
  const save = async () => {
    if (!form) return;
    setBusy(true);
    const { data: id, error } = await supabase.rpc("save_extension", {
      org: orgId, ext: form.id as string, p_number: form.number.trim(), p_sip_user: (form.sip_user || form.number).trim(),
      p_sip_domain: form.sip_domain.trim(), p_wss_url: form.wss_url.trim(), p_provider: form.provider,
      p_label: form.label.trim(), p_password: form.password,
    });
    const before = rows.find((r) => r.id === form.id)?.user_id ?? "";
    const assignErr = !error && id && form.user_id !== before
      ? (await supabase.rpc("assign_extension", { ext: id as string, member: (form.user_id || null) as string })).error : null;
    setBusy(false);
    if (assignErr) toast({ variant: "destructive", title: "Ramal salvo, mas o atendente não foi associado", description: assignErr.message });
    if (error) {
      toast({ variant: "destructive", title: "Não salvou", description: error.message.includes("check") ? "Confira número (só dígitos), servidor e endereço wss://" : error.message });
      return;
    }
    toast({ title: "Ramal salvo" });
    edit(null);
    void load();
  };
  const test = async () => {
    if (!form) return;
    setTesting(true); setResult(null);
    setResult(await testExtension(form));
    setTesting(false);
  };
  // Modelo da planilha já com a equipe da empresa (só falta número e senha).
  const downloadTemplate = () => {
    const org = orgs.find((o) => o.id === orgId)?.name ?? "empresa";
    const lines = ["numero;usuario_sip;senha;email_atendente;nome (so para conferir)",
      ...members.map((m) => `;;;${m.email};${m.name}`)];
    const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ramais-${org.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const runImport = async () => {
    if (!imp) return;
    const items = parseSheet(imp.text);
    if (!items.length) { toast({ variant: "destructive", title: "Nenhuma linha com número de ramal" }); return; }
    setBusy(true);
    const out: string[] = [];
    for (const it of items) {
      const existing = rows.find((r) => r.number === it.number);
      const { data: id, error } = await supabase.rpc("save_extension", {
        org: orgId, ext: (existing?.id ?? null) as string, p_number: it.number, p_sip_user: it.sip_user,
        p_sip_domain: imp.domain.trim(), p_wss_url: imp.wss.trim(), p_provider: imp.provider, p_label: existing?.label ?? "",
        p_password: it.password,
      });
      if (error) { out.push(`✗ ${it.number}: ${error.message}`); continue; }
      let who = "";
      if (it.email) {
        const m = members.find((x) => x.email.toLowerCase() === it.email);
        if (!m) who = ` · e-mail ${it.email} não é da equipe`;
        else {
          const r = await supabase.rpc("assign_extension", { ext: id as string, member: m.user_id });
          who = r.error ? ` · não associou: ${r.error.message}` : ` → ${m.name}`;
        }
      }
      out.push(`✓ ${it.number}${existing ? " (atualizado)" : ""}${who}`);
    }
    setBusy(false);
    setReport(out);
    setImp(null);
    void load();
  };
  // Ramais livres → pessoas sem ramal (atendentes primeiro, depois por nome).
  const autoAssign = async () => {
    const free = rows.filter((r) => !r.user_id).sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
    const taken = new Set(rows.map((r) => r.user_id).filter(Boolean));
    const order = ["agent", "supervisor", "admin", "owner"];
    const people = members.filter((m) => !taken.has(m.user_id))
      .sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.name.localeCompare(b.name));
    const pairs = free.slice(0, people.length).map((r, i) => ({ r, m: people[i] }));
    if (!pairs.length) { toast({ title: free.length ? "Todos já têm ramal" : "Nenhum ramal livre" }); return; }
    if (!window.confirm(`Associar automaticamente?\n\n${pairs.map((p) => `${p.r.number} → ${p.m.name} (${ROLE[p.m.role] ?? p.m.role})`).join("\n")}`)) return;
    setBusy(true);
    const out: string[] = [];
    for (const p of pairs) {
      const { error } = await supabase.rpc("assign_extension", { ext: p.r.id, member: p.m.user_id });
      out.push(error ? `✗ ${p.r.number}: ${error.message}` : `✓ ${p.r.number} → ${p.m.name}`);
    }
    setBusy(false);
    setReport(out);
    void load();
  };
  const remove = async (e: Ext) => {
    if (!window.confirm(`Excluir o ramal ${e.number}? O histórico de ligações continua.`)) return;
    const { error } = await supabase.rpc("delete_extension", { ext: e.id });
    if (error) toast({ variant: "destructive", title: "Não excluiu", description: error.message });
    void load();
  };
  const set = (k: keyof Form) => (ev: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => (f ? { ...f, [k]: ev.target.value } : f));

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="font-semibold flex items-center gap-2"><Phone className="w-4 h-4" /> {self ? "Central de telefonia e ramais" : "Ramais (PBX contratado com a Clubetec)"}</h2>
      <details className="rounded-md bg-muted/40 p-3 text-sm" open={rows.length === 0}>
        <summary className="cursor-pointer font-medium">Como funciona</summary>
        <ol className="list-decimal pl-5 mt-2 space-y-1 text-muted-foreground">
          <li><b>Cadastre o ramal</b> com os mesmos dados que você põe no MicroSIP: número, usuário, <b>servidor/domínio</b> (ex.: Nvoip:
            <code> app.nvoip.com.br</code>) e senha. A senha vai para o cofre e não aparece mais.</li>
          <li><b>Telefone no navegador (opcional):</b> informe o <b>endereço WebRTC</b> (<code>wss://…</code>) que a central fornece.
            Sem ele, o ramal funciona no <b>MicroSIP/aparelho</b> e o sistema identifica o cliente pelo número.</li>
          <li><b>Teste</b> antes de salvar: com a senha digitada, o botão Testar registra na central e diz se está tudo certo.</li>
          <li><b>Associe o atendente</b> já no cadastro — ou, para muitos ramais, <b>baixe o modelo da planilha</b> (vem com os e-mails da equipe),
            preencha número e senha, e <b>importe</b>. Ou use <b>Associar automaticamente</b> (ramais livres → pessoas sem ramal).
            O dono também pode trocar depois em Configurar → Ramais. O atendente vê o botão 📞 no canto da tela.</li>
          <li>O <b>status</b> aparece aqui: 🟢 online (telefone do navegador registrado), 🔴 erro, ⚪ desconectado, 🔵 MicroSIP (fora do navegador).</li>
          <li><b>Histórico de ligações de qualquer central:</b> em Configurações → API e webhooks, crie uma chave com “Registrar ligações” e configure a
            central (ou o n8n) para enviar cada ligação para <code>POST /calls</code>. Ligação perdida vira aviso para o atendente do ramal.</li>
        </ol>
      </details>
      <div className="flex flex-wrap gap-2 items-center">
        {!self && (
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={orgId} onChange={(e) => { setOrgId(e.target.value); edit(null); }}>
            <option value="">Escolha a empresa…</option>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
        {orgId && <>
          <Button size="sm" onClick={novo}><Plus className="w-4 h-4 mr-1" /> Novo ramal</Button>
          <Button size="sm" variant="outline" onClick={downloadTemplate} disabled={!members.length}><Download className="w-4 h-4 mr-1" /> Modelo da planilha</Button>
          <Button size="sm" variant="outline" onClick={() => { setReport(null); setImp({ text: "", domain: rows[rows.length - 1]?.sip_domain ?? "",
            wss: rows[rows.length - 1]?.wss_url ?? "", provider: rows[rows.length - 1]?.provider ?? "handphone" }); }}><Upload className="w-4 h-4 mr-1" /> Importar planilha</Button>
          <Button size="sm" variant="outline" onClick={autoAssign} disabled={busy}><Wand2 className="w-4 h-4 mr-1" /> Associar automaticamente</Button>
        </>}
      </div>

      {imp && (
        <div className="space-y-2 rounded-md border p-3 bg-muted/30">
          <p className="text-sm">Cole as linhas da planilha (ou escolha o arquivo .csv). Colunas: <b>número; usuário SIP; senha; e-mail do atendente</b>.
            Servidor e WebRTC valem para todas as linhas. Ramal que já existe é atualizado (senha vazia = mantém).</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <Input placeholder="Servidor/domínio SIP" value={imp.domain} onChange={(e) => setImp({ ...imp, domain: e.target.value })} />
            <Input placeholder="wss://… (vazio = só MicroSIP)" value={imp.wss} onChange={(e) => setImp({ ...imp, wss: e.target.value })} />
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={imp.provider} onChange={(e) => setImp({ ...imp, provider: e.target.value })}>
              {CENTRAIS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <input type="file" accept=".csv,.txt" className="text-sm" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setImp({ ...imp, text: await f.text() });
          }} />
          <textarea className="w-full h-32 rounded-md border bg-background p-2 font-mono text-xs" value={imp.text}
            placeholder={"201;201;senha201;maria@empresa.com\n202;202;senha202;joao@empresa.com"}
            onChange={(e) => setImp({ ...imp, text: e.target.value })} />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">{parseSheet(imp.text).length} ramal(is) encontrados. Depois de importar, apague a planilha com as senhas do seu computador.</span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setImp(null)}>Cancelar</Button>
              <Button size="sm" disabled={busy || !imp.domain.trim() || !parseSheet(imp.text).length} onClick={runImport}>{busy ? "Importando…" : "Importar"}</Button>
            </div>
          </div>
        </div>
      )}
      {report && (
        <div className="rounded-md border p-2 text-xs space-y-0.5">
          {report.map((l, i) => <div key={i} className={l.startsWith("✗") ? "text-destructive" : ""}>{l}</div>)}
          <button type="button" className="underline text-muted-foreground" onClick={() => setReport(null)}>fechar</button>
        </div>
      )}

      {form && (
        <div className="grid gap-2 sm:grid-cols-4 rounded-md border p-3 bg-muted/30">
          <Input placeholder="Número (ex.: 201)" value={form.number} onChange={set("number")} />
          <Input placeholder="Nome (ex.: Recepção)" value={form.label} onChange={set("label")} />
          <Input placeholder="Usuário SIP (vazio = número)" value={form.sip_user} onChange={set("sip_user")} />
          <Input type="password" autoComplete="new-password" placeholder={form.id ? "Senha (vazio = manter)" : "Senha do ramal"} value={form.password} onChange={set("password")} />
          <select className="h-9 rounded-md border bg-background px-2 text-sm sm:col-span-4" value={form.provider} aria-label="Central"
            onChange={(ev) => setForm((f) => (f ? { ...f, provider: ev.target.value } : f))}>
            {CENTRAIS.map((c) => <option key={c.key} value={c.key}>Central: {c.label}</option>)}
          </select>
          <p className="sm:col-span-4 text-xs text-muted-foreground">{presetOf(form.provider).tip}</p>
          <Input className="sm:col-span-2" placeholder={`Servidor/domínio SIP${presetOf(form.provider).domain ? ` (ex.: ${presetOf(form.provider).domain})` : ""}`} value={form.sip_domain} onChange={set("sip_domain")} />
          <Input className="sm:col-span-2" placeholder={presetOf(form.provider).wss ? `WebRTC (ex.: ${presetOf(form.provider).wss})` : "WebRTC: wss://… (vazio = só MicroSIP/aparelho)"} value={form.wss_url} onChange={set("wss_url")} />
          <select className="h-9 rounded-md border bg-background px-2 text-sm sm:col-span-2" value={form.user_id} onChange={set("user_id")}>
            <option value="">Atendente: — livre —</option>
            {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.name} ({ROLE[m.role] ?? m.role}) · {m.email}</option>)}
          </select>
          <div className="sm:col-span-1 flex flex-wrap gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => edit(null)}>Cancelar</Button>
            <Button size="sm" variant="outline" disabled={testing || !form.sip_domain} onClick={test}>{testing ? "Testando…" : "Testar"}</Button>
            <Button size="sm" disabled={busy || !form.number || !form.sip_domain} onClick={save}>{busy ? "Salvando…" : "Salvar ramal"}</Button>
          </div>
          {result && (
            <p className={`sm:col-span-4 text-sm rounded-md p-2 ${result.ok ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300"}`}>
              {result.text}
            </p>
          )}
        </div>
      )}

      {orgId && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Status</TableHead><TableHead>Ramal</TableHead><TableHead>Atendente</TableHead><TableHead>Usuário / servidor</TableHead><TableHead>WebRTC</TableHead>
              <TableHead>Senha</TableHead><TableHead />
            </TableRow></TableHeader>
            <TableBody>
              {rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground">Nenhum ramal ainda.</TableCell></TableRow>}
              {rows.map((e) => {
                const st = extStatus(e);
                return (
                  <TableRow key={e.id}>
                    <TableCell title={st.hint}>
                      <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap"><span className={`w-2.5 h-2.5 rounded-full ${st.dot}`} />{st.label}</span>
                      {st.hint && <div className="text-xs text-muted-foreground max-w-[14rem]">{st.hint}</div>}
                    </TableCell>
                    <TableCell className="font-medium">{e.number}{e.label ? ` · ${e.label}` : ""}</TableCell>
                    <TableCell className="text-sm">{memberName(e.user_id) ?? <span className="text-muted-foreground">Livre</span>}</TableCell>
                    <TableCell className="text-xs">{e.sip_user}@{e.sip_domain}<div className="text-muted-foreground">{e.provider}</div></TableCell>
                    <TableCell>{e.wss_url ? <Badge>Configurado</Badge> : <Badge variant="outline">Só MicroSIP</Badge>}</TableCell>
                    <TableCell>{e.has_password ? "✓ no cofre" : <span className="text-destructive">falta</span>}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => edit({ id: e.id, number: e.number, label: e.label ?? "", sip_user: e.sip_user,
                        sip_domain: e.sip_domain, wss_url: e.wss_url ?? "", provider: e.provider, password: "", user_id: e.user_id ?? "" })}>Editar</Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(e)} title="Excluir"><Trash2 className="w-4 h-4" /></Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
