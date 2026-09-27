import { NumberHealthBanner } from "@/components/NumberHealthBanner";
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { LogOut, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { Logo } from "@/components/Logo";
import { MainNav } from "@/components/MainNav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { NEW_GRAPH } from "./fluxos/blocks";
import { FlowSecrets } from "./fluxos/FlowSecrets";

interface FlowRow { id: string; name: string; published: number | null }
interface NumberRow { id: string; name: string; flow_id: string | null }
type Hours = Record<string, { start: string; end: string }[]>;

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const DEFAULT_HOURS: Hours = Object.fromEntries([1, 2, 3, 4, 5].map((d) => [String(d), [{ start: "08:00", end: "18:00" }]]));
const selectCls = "h-9 rounded-md border bg-background px-2 text-sm";
const DEFAULT_OPT_OUT = ["SAIR", "PARAR"];
const DEFAULT_OPT_OUT_REPLY = "Pronto, você não vai mais receber mensagens automáticas. Se precisar, é só mandar mensagem.";

/** Fluxos de atendimento da organização (spec fluxo §5). */
export default function Fluxos() {
  const { signOut, user } = useAuth();
  const { org, can } = useOrg();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [flows, setFlows] = useState<FlowRow[]>([]);
  const [numbers, setNumbers] = useState<NumberRow[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState<FlowRow | null>(null);

  const load = useCallback(async () => {
    if (!org) return;
    const [f, v, n, o] = await Promise.all([
      supabase.from("flows").select("id, name").eq("organization_id", org.id).order("name"),
      supabase.from("flow_versions").select("flow_id, version").eq("organization_id", org.id).eq("status", "published"),
      supabase.from("whatsapp_instances").select("id, name, flow_id").eq("organization_id", org.id).order("name"),
      supabase.from("organizations").select("settings").eq("id", org.id).maybeSingle(),
    ]);
    const pub = new Map((v.data ?? []).map((r) => [r.flow_id, r.version]));
    setFlows((f.data ?? []).map((r) => ({ ...r, published: pub.get(r.id) ?? null })));
    setNumbers(n.data ?? []);
    setSettings((o.data?.settings ?? {}) as Record<string, unknown>);
  }, [org]);

  useEffect(() => { void load(); }, [load]);

  const saveSettings = async (patch: Record<string, unknown>) => {
    if (!org) return;
    // Relê antes de gravar para não apagar ajustes feitos em outra tela.
    const { data } = await supabase.from("organizations").select("settings").eq("id", org.id).maybeSingle();
    const next = { ...((data?.settings ?? {}) as Record<string, unknown>), ...patch };
    const { error } = await supabase.from("organizations").update({ settings: next as never }).eq("id", org.id);
    if (error) return toast({ variant: "destructive", title: "Sem permissão" });
    setSettings(next);
    toast({ title: "Salvo" });
  };

  const create = async () => {
    const name = newName.trim().slice(0, 80);
    if (!org || !name) return;
    const { data, error } = await supabase.from("flows").insert({ organization_id: org.id, name }).select("id").single();
    if (error || !data) return toast({ variant: "destructive", title: "Não foi possível criar" });
    await supabase.from("flow_versions").insert({
      organization_id: org.id, flow_id: data.id, status: "draft", graph: NEW_GRAPH as never, updated_by: user?.id,
    });
    navigate(`/fluxos/${data.id}`);
  };

  const remove = async () => {
    if (!deleting) return;
    const { error } = await supabase.from("flows").delete().eq("id", deleting.id);
    setDeleting(null);
    if (error) return toast({ variant: "destructive", title: "Não foi possível apagar" });
    if (settings.default_flow_id === deleting.id) await saveSettings({ default_flow_id: null });
    if (settings.post_close_flow_id === deleting.id) await saveSettings({ post_close_flow_id: null });
    void load();
  };

  const setNumberFlow = async (n: NumberRow, flowId: string) => {
    const { error } = await supabase.from("whatsapp_instances").update({ flow_id: flowId || null }).eq("id", n.id);
    if (error) return toast({ variant: "destructive", title: "Sem permissão" });
    setNumbers((ns) => ns.map((x) => (x.id === n.id ? { ...x, flow_id: flowId || null } : x)));
  };

  const hours = (settings.business_hours as Hours | undefined) ?? DEFAULT_HOURS;
  const [draftHours, setDraftHours] = useState<Hours | null>(null);
  const h = draftHours ?? hours;
  const setDay = (d: number, slot: { start: string; end: string } | null) =>
    setDraftHours({ ...h, [String(d)]: slot ? [slot] : [] });

  const [optWords, setOptWords] = useState<string | null>(null);
  const [optReply, setOptReply] = useState<string | null>(null);
  const words = optWords ?? ((settings.opt_out_words as string[] | undefined) ?? DEFAULT_OPT_OUT).join(", ");
  const reply = optReply ?? (typeof settings.opt_out_reply === "string" ? settings.opt_out_reply : DEFAULT_OPT_OUT_REPLY);
  const saveOptOut = async () => {
    const list = words.split(",").map((w) => w.trim().slice(0, 30)).filter(Boolean).slice(0, 10);
    if (!list.length) return toast({ variant: "destructive", title: "Informe ao menos uma palavra" });
    if (!reply.trim()) return toast({ variant: "destructive", title: "Escreva a confirmação" });
    await saveSettings({ opt_out_words: list, opt_out_reply: reply.trim().slice(0, 500) });
    setOptWords(null);
    setOptReply(null);
  };

  if (!org) return null;
  if (!can("org.settings")) return <Navigate to="/" replace />;

  const published = flows.filter((f) => f.published);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b px-4 h-14 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Logo horizontal width={26} height={26} />
          <MainNav active="fluxos" />
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" size="icon" title="Sair" onClick={async () => { await signOut(); navigate("/login"); }}>
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>
      <NumberHealthBanner />

      <main className="flex-1 w-full max-w-4xl mx-auto p-4 sm:p-6 space-y-8">
        <div>
          <h1 className="text-2xl font-semibold">Fluxos de atendimento</h1>
          <p className="text-sm text-muted-foreground">
            O fluxo recebe o cliente, faz perguntas e decide entre IA, departamento ou finalizar. Sem fluxo, a IA da empresa responde como hoje.
          </p>
        </div>

        <section className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Nome do novo fluxo" value={newName} maxLength={80}
              onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
            <Button onClick={create} disabled={!newName.trim()}><Plus className="w-4 h-4 mr-1" /> Criar</Button>
          </div>
          {flows.length === 0 && <p className="text-sm text-muted-foreground">Nenhum fluxo ainda.</p>}
          <div className="divide-y rounded-lg border">
            {flows.map((f) => (
              <div key={f.id} className="flex items-center justify-between p-3 gap-2">
                <Link to={`/fluxos/${f.id}`} className="font-medium hover:underline truncate">{f.name}</Link>
                <div className="flex items-center gap-2 shrink-0">
                  {settings.default_flow_id === f.id && <Badge>Padrão</Badge>}
                  {f.published ? <Badge variant="secondary">v{f.published}</Badge> : <Badge variant="outline">Rascunho</Badge>}
                  <Button variant="ghost" size="icon" title="Apagar" onClick={() => setDeleting(f)}><Trash2 className="w-4 h-4" /></Button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold">Qual fluxo cada número usa</h2>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm">Padrão da empresa</span>
            <select className={selectCls} value={String(settings.default_flow_id ?? "")}
              onChange={(e) => saveSettings({ default_flow_id: e.target.value || null })}>
              <option value="">Nenhum (IA da empresa)</option>
              {published.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          {numbers.map((n) => (
            <div key={n.id} className="flex items-center justify-between gap-2">
              <span className="text-sm truncate">{n.name}</span>
              <select className={selectCls} value={n.flow_id ?? ""} onChange={(e) => setNumberFlow(n, e.target.value)}>
                <option value="">Usar o padrão</option>
                {published.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          ))}
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm">Depois que um atendente finaliza (pesquisa)</span>
            <select className={selectCls} value={String(settings.post_close_flow_id ?? "")}
              onChange={(e) => saveSettings({ post_close_flow_id: e.target.value || null })}>
              <option value="">Nenhum</option>
              {published.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <p className="text-xs text-muted-foreground">
            Só fluxos publicados aparecem. A mudança vale para atendimentos novos. O fluxo pós-atendimento começa
            até 1 minuto depois de finalizar e não vai para quem pediu para sair.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold">Parar mensagens automáticas (LGPD)</h2>
          <p className="text-xs text-muted-foreground">
            Se o cliente mandar só uma destas palavras, deixa de receber follow-ups, esperas e pesquisas. Respostas ao que ele
            mesmo escrever continuam. O atendente vê o aviso na ficha e pode desfazer a pedido do cliente.
          </p>
          <div className="space-y-1">
            <span className="text-sm">Palavras (separe por vírgula)</span>
            <Input value={words} maxLength={300} onChange={(e) => setOptWords(e.target.value)} />
          </div>
          <div className="space-y-1">
            <span className="text-sm">Confirmação enviada ao cliente</span>
            <Textarea rows={2} value={reply} maxLength={500} onChange={(e) => setOptReply(e.target.value)} />
          </div>
          <Button variant="outline" disabled={optWords === null && optReply === null} onClick={saveOptOut}>Salvar</Button>
        </section>

        <FlowSecrets orgId={org.id} />

        <section className="space-y-3">
          <h2 className="font-semibold">Horário de atendimento</h2>
          <p className="text-xs text-muted-foreground">Usado pelo bloco “Horário”. Fuso: {String(settings.timezone || "America/Sao_Paulo")}.</p>
          <div className="space-y-2">
            {WEEKDAYS.map((w, d) => {
              const slot = h[String(d)]?.[0] ?? null;
              return (
                <div key={w} className="flex items-center gap-3">
                  <Switch checked={!!slot} onCheckedChange={(on) => setDay(d, on ? { start: "08:00", end: "18:00" } : null)} />
                  <span className="w-20 text-sm">{w}</span>
                  {slot ? (
                    <>
                      <Input type="time" className="w-28" value={slot.start} onChange={(e) => setDay(d, { ...slot, start: e.target.value })} />
                      <span className="text-sm">às</span>
                      <Input type="time" className="w-28" value={slot.end} onChange={(e) => setDay(d, { ...slot, end: e.target.value })} />
                    </>
                  ) : <span className="text-sm text-muted-foreground">Fechado</span>}
                </div>
              );
            })}
          </div>
          <Button variant="outline" disabled={!draftHours} onClick={async () => {
            const bad = Object.values(h).flat().some((s) => !s.start || !s.end || s.start >= s.end);
            if (bad) return toast({ variant: "destructive", title: "Horário inicial deve ser antes do final" });
            await saveSettings({ business_hours: h });
            setDraftHours(null);
          }}>Salvar horário</Button>
        </section>
      </main>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Todas as versões são apagadas e os números que usam este fluxo voltam para o padrão. Atendimentos em andamento neste fluxo passam a ser respondidos pela IA da empresa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Apagar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
