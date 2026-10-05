import { SectionTabs } from "@/components/layout/SectionTabs";
import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { BrandWriter } from "@/components/brand/BrandWriter";
import { Navigate, useNavigate } from "react-router-dom";
import { LogOut, Megaphone, Pause, Play, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { Logo } from "@/components/Logo";
import { MainNav } from "@/components/MainNav";
import { NumberHealthBanner } from "@/components/NumberHealthBanner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TagIcon } from "@/components/TagIcon";

interface Campaign {
  id: string; name: string; instance_id: string | null; group_ids: string[]; message: string | null;
  template_name: string | null; template_lang: string | null; status: string; scheduled_at: string | null;
  rate_per_min: number; window_start: number; window_end: number;
  total: number; sent: number; failed: number; skipped: number; created_at: string;
}
interface Inst { id: string; name: string; provider: string; status: string }
interface Group { id: string; name: string; color: string | null; icon?: string | null }
type Draft = Partial<Campaign> & { name: string };

const STATUS: Record<string, [string, "default" | "secondary" | "outline" | "destructive"]> = {
  draft: ["Rascunho", "outline"], running: ["Enviando", "default"], paused: ["Pausada", "secondary"],
  done: ["Concluída", "secondary"], canceled: ["Cancelada", "destructive"],
};
const EMPTY: Draft = { name: "", group_ids: [], message: "Oi {nome}! ...\n\nResponda SAIR para não receber mais mensagens.", rate_per_min: 20, window_start: 8, window_end: 20 };

/** Disparos para grupos de clientes (dono/admin): rascunho → iniciar → acompanhar. */
export default function Campanhas() {
  const { signOut } = useAuth();
  const { org, can } = useOrg();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [list, setList] = useState<Campaign[]>([]);
  const [insts, setInsts] = useState<Inst[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [audience, setAudience] = useState<{ total: number; optout: number; recebem: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!org) return;
    const [c, i, g] = await Promise.all([
      supabase.from("campaigns").select("*").eq("organization_id", org.id).order("created_at", { ascending: false }).limit(50),
      supabase.from("whatsapp_instances").select("id, name, provider, status").eq("organization_id", org.id).neq("status", "disabled").order("created_at"),
      supabase.from("contact_groups").select("id, name, color, icon").eq("organization_id", org.id).order("name"),
    ]);
    setList((c.data as unknown as Campaign[]) ?? []);
    setInsts((i.data as Inst[]) ?? []);
    setGroups((g.data as Group[]) ?? []);
  }, [org]);
  useEffect(() => { void load(); }, [load]);
  // Enquanto houver campanha enviando, atualiza o progresso.
  useEffect(() => {
    if (!list.some((c) => c.status === "running")) return;
    const t = window.setInterval(load, 15_000);
    return () => window.clearInterval(t);
  }, [list, load]);
  useEffect(() => {
    if (!org || !draft?.group_ids?.length) { setAudience(null); return; }
    void supabase.rpc("campaign_audience", { org: org.id, groups: draft.group_ids }).then(({ data }) => setAudience(data as never));
  }, [org, draft?.group_ids]);

  if (!org) return null;
  if (!can("campaigns.manage")) return <Navigate to="/" replace />;

  const inst = insts.find((i) => i.id === draft?.instance_id);
  const isMeta = inst?.provider === "cloud";
  const fail = (title: string, description?: string) => toast({ variant: "destructive", title, description });

  const save = async (): Promise<string | null> => {
    if (!draft) return null;
    const row = {
      name: draft.name.trim(), instance_id: draft.instance_id ?? null, group_ids: draft.group_ids ?? [],
      message: draft.message ?? null, template_name: isMeta ? draft.template_name?.trim() || null : null,
      template_lang: isMeta ? draft.template_lang?.trim() || "pt_BR" : null,
      scheduled_at: draft.scheduled_at || null, rate_per_min: draft.rate_per_min ?? 20,
      window_start: draft.window_start ?? 8, window_end: draft.window_end ?? 20,
    };
    const { data, error } = draft.id
      ? await supabase.from("campaigns").update(row).eq("id", draft.id).select("id").single()
      : await supabase.from("campaigns").insert({ ...row, organization_id: org.id, created_by: (await supabase.auth.getUser()).data.user?.id }).select("id").single();
    if (error) { fail("Não salvo", error.message); return null; }
    await load();
    return data.id;
  };

  const start = async () => {
    if (!draft) return;
    if (!window.confirm(`Iniciar o envio para ${audience?.recebem ?? "?"} contatos? Depois de iniciada, a campanha não pode ser editada (só pausada ou cancelada).`)) return;
    setBusy(true);
    const id = await save();
    if (!id) { setBusy(false); return; }
    const { data, error } = await supabase.rpc("start_campaign", { campaign: id });
    setBusy(false);
    if (error) return fail("Não iniciou", error.message);
    toast({ title: "Campanha iniciada", description: `${(data as { total: number }).total} contatos na lista. O envio começa no próximo minuto, dentro do horário.` });
    setDraft(null);
    void load();
  };

  const setStatus = async (c: Campaign, s: string) => {
    if (s === "canceled" && !window.confirm(`Cancelar "${c.name}"? Quem ainda não recebeu não vai receber.`)) return;
    const { error } = await supabase.rpc("set_campaign_status", { campaign: c.id, new_status: s });
    if (error) return fail("Não foi possível", error.message);
    void load();
  };

  const remove = async (c: Campaign) => {
    if (!window.confirm(`Apagar o rascunho "${c.name}"?`)) return;
    const { error } = await supabase.from("campaigns").delete().eq("id", c.id);
    if (error) return fail("Não apagado", error.message);
    void load();
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="campanhas" />
      <SectionTabs group="clientes" active="campanhas" />
      <NumberHealthBanner />

      <main className="flex-1 w-full max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-brand text-2xl leading-tight">Campanhas</h1>
            <p className="text-sm text-muted-foreground">Envio para grupos de clientes, aos poucos e só no horário. Quem pediu para sair nunca recebe.</p>
          </div>
          {!draft && <Button onClick={() => setDraft({ ...EMPTY, instance_id: insts[0]?.id })}><Plus className="w-4 h-4 mr-1" /> Nova campanha</Button>}
        </div>

        {draft && (
          <section className="rounded-lg border p-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold">{draft.id ? "Editar rascunho" : "Nova campanha"}</p>
              <Button variant="ghost" size="icon" onClick={() => setDraft(null)} title="Fechar"><X className="w-4 h-4" /></Button>
            </div>
            <Input placeholder="Nome (ex.: Promoção de outubro)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />

            <div className="space-y-1">
              <p className="text-xs font-medium">Número que envia</p>
              <div className="flex flex-wrap gap-1.5">
                {insts.map((i) => (
                  <button key={i.id} type="button" onClick={() => setDraft({ ...draft, instance_id: i.id })}
                    className={`rounded-full border px-3 py-1 text-xs ${draft.instance_id === i.id ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}>
                    {i.name} · {i.provider === "cloud" ? "Meta" : "QR"}
                  </button>
                ))}
                {!insts.length && <span className="text-xs text-muted-foreground">Conecte um número em Números.</span>}
              </div>
              {inst && !isMeta && (
                <p className="text-xs rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 p-2">
                  Número por QR (não oficial): disparo em massa pode fazer o WhatsApp bloquear o número. Use listas de quem já é cliente, velocidade baixa e mensagem com opção de sair. O monitor de saúde avisa se cair.
                </p>
              )}
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium">Para quais grupos de clientes</p>
              <div className="flex flex-wrap gap-1.5">
                {groups.map((g) => {
                  const on = draft.group_ids?.includes(g.id);
                  return (
                    <button key={g.id} type="button"
                      onClick={() => setDraft({ ...draft, group_ids: on ? draft.group_ids!.filter((x) => x !== g.id) : [...(draft.group_ids ?? []), g.id] })}
                      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs ${on ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}>
                      {g.icon ? <TagIcon icon={g.icon} color={on ? undefined : g.color} /> : <span className="w-2 h-2 rounded-full" style={{ background: g.color ?? "#94A3B8" }} />}{g.name}
                    </button>
                  );
                })}
                {!groups.length && <span className="text-xs text-muted-foreground">Crie grupos na ficha do cliente (Conversas → Ficha → Grupos).</span>}
              </div>
              {audience && <p className="text-xs text-muted-foreground">{audience.recebem} vão receber · {audience.optout} pediram para não receber (ficam de fora) · {audience.total} no total.</p>}
            </div>

            {isMeta ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Número da Meta só envia <b>modelo aprovado</b> para quem não falou nas últimas 24h. Informe o nome do modelo aprovado no gerenciador da Meta.</p>
                <div className="flex flex-wrap gap-2">
                  <Input className="flex-1 min-w-[12rem]" placeholder="nome_do_modelo" value={draft.template_name ?? ""} onChange={(e) => setDraft({ ...draft, template_name: e.target.value })} />
                  <Input className="w-28" placeholder="pt_BR" value={draft.template_lang ?? "pt_BR"} onChange={(e) => setDraft({ ...draft, template_lang: e.target.value })} />
                </div>
                <Textarea rows={3} placeholder="Texto do modelo (para conferência). Se tiver {{1}}, ele recebe o primeiro nome." value={draft.message ?? ""} onChange={(e) => setDraft({ ...draft, message: e.target.value })} />
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-xs font-medium">Mensagem <span className="text-muted-foreground font-normal">— {"{nome}"} vira o primeiro nome do cliente</span></p>
                <Textarea rows={5} maxLength={4000} value={draft.message ?? ""} onChange={(e) => setDraft({ ...draft, message: e.target.value })} />
                {org && <BrandWriter orgId={org.id} onUse={(t) => setDraft({ ...draft, message: t })} />}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-1">Até <Input type="number" min={1} max={60} className="h-8 w-16" value={draft.rate_per_min ?? 20}
                onChange={(e) => setDraft({ ...draft, rate_per_min: Math.min(60, Math.max(1, Number(e.target.value) || 20)) })} /> por minuto</label>
              <label className="flex items-center gap-1">das <Input type="number" min={0} max={23} className="h-8 w-14" value={draft.window_start ?? 8}
                onChange={(e) => setDraft({ ...draft, window_start: Math.min(23, Math.max(0, Number(e.target.value) || 0)) })} />
                às <Input type="number" min={1} max={24} className="h-8 w-14" value={draft.window_end ?? 20}
                onChange={(e) => setDraft({ ...draft, window_end: Math.min(24, Math.max(1, Number(e.target.value) || 20)) })} /> h</label>
              <label className="flex items-center gap-1">Começar em <Input type="datetime-local" className="h-8 w-52"
                value={draft.scheduled_at ? draft.scheduled_at.slice(0, 16) : ""}
                onChange={(e) => setDraft({ ...draft, scheduled_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                <span className="text-muted-foreground">(vazio = agora)</span></label>
            </div>

            <div className="flex flex-wrap gap-2 justify-end">
              <Button variant="outline" disabled={busy || draft.name.trim().length < 2} onClick={async () => { const id = await save(); if (id) { setDraft(null); toast({ title: "Rascunho salvo" }); } }}>Salvar rascunho</Button>
              <Button disabled={busy || draft.name.trim().length < 2 || !draft.instance_id || !draft.group_ids?.length || !audience?.recebem} onClick={start}>
                <Play className="w-4 h-4 mr-1" /> {busy ? "Iniciando..." : "Iniciar envio"}
              </Button>
            </div>
          </section>
        )}

        <section className="space-y-2">
          {!list.length && !draft && <p className="text-sm text-muted-foreground">Nenhuma campanha ainda.</p>}
          {list.map((c) => {
            const done = c.sent + c.failed + c.skipped;
            const pct = c.total ? Math.round((done / c.total) * 100) : 0;
            return (
              <div key={c.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  <Badge variant={STATUS[c.status]?.[1] ?? "outline"}>{STATUS[c.status]?.[0] ?? c.status}</Badge>
                  <span className="text-xs text-muted-foreground">{insts.find((i) => i.id === c.instance_id)?.name ?? ""}</span>
                  <div className="ml-auto flex gap-1">
                    {c.status === "draft" && <>
                      <Button size="sm" variant="outline" onClick={() => setDraft({ ...c })}>Editar</Button>
                      <Button size="icon" variant="ghost" title="Apagar" onClick={() => remove(c)}><Trash2 className="w-4 h-4" /></Button>
                    </>}
                    {c.status === "running" && <Button size="sm" variant="outline" onClick={() => setStatus(c, "paused")}><Pause className="w-4 h-4 mr-1" /> Pausar</Button>}
                    {c.status === "paused" && <Button size="sm" variant="outline" onClick={() => setStatus(c, "running")}><Play className="w-4 h-4 mr-1" /> Retomar</Button>}
                    {(c.status === "running" || c.status === "paused") && <Button size="sm" variant="ghost" onClick={() => setStatus(c, "canceled")}>Cancelar</Button>}
                  </div>
                </div>
                {c.status !== "draft" && (
                  <>
                    <div className="h-2 rounded bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
                    <p className="text-xs text-muted-foreground">
                      {c.sent} enviados · {c.failed} falharam · {c.skipped} fora da lista (pediram para sair) · {c.total} no total
                      {c.status === "running" ? ` · até ${c.rate_per_min}/min, das ${c.window_start}h às ${c.window_end}h` : ""}
                    </p>
                  </>
                )}
              </div>
            );
          })}
        </section>
      </main>
    </div>
  );
}
