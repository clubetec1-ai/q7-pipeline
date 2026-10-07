import { HowItWorks } from "./diagnostico/HowItWorks";
import { Globe } from "lucide-react";
import { MicTextarea } from "@/components/MicTextarea";
import { SectionTabs } from "@/components/layout/SectionTabs";
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Copy, Filter, Link2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { AppHeader } from "@/components/AppHeader";
import { NumberHealthBanner } from "@/components/NumberHealthBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Stage { id: string; name: string; color: string | null; position: number; count: number }
interface Origin { origem: string; leads: number; clientes: number }
interface Report { stages: Stage[]; origins: Origin[]; total: number }
interface Num { id: string; name: string; phone: string | null }

const PERIODS = [7, 30, 90];
const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/**
 * Funil de vendas: instala o funil pronto (etapas, etiquetas quente/morno/frio, campos do
 * cliente e o fluxo de qualificação), mostra quantos contatos estão em cada etapa e de onde
 * vieram, e gera links de captação para o WhatsApp que marcam a origem sozinhos.
 */
export default function Funil() {
  const { org, can } = useOrg();
  const { toast } = useToast();
  const [days, setDays] = useState(30);
  const [rep, setRep] = useState<Report | null>(null);
  const [nums, setNums] = useState<Num[]>([]);
  const [installing, setInstalling] = useState(false);
  const [link, setLink] = useState({ phone: "", origem: "instagram", msg: "Olá! Quero saber mais." });
  // Página de captação pública (/c/<empresa>): título, texto e o link do WhatsApp acima.
  const [orgSlug, setOrgSlug] = useState("");
  const [cap, setCap] = useState({ ativo: false, titulo: "", texto: "" });

  const load = useCallback(async () => {
    if (!org) return;
    const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const [{ data }, { data: n }] = await Promise.all([
      supabase.rpc("sales_funnel_report", { org: org.id, since }),
      supabase.from("whatsapp_instances").select("id, name, phone").eq("organization_id", org.id).order("name"),
    ]);
    setRep(data as unknown as Report);
    setNums((n as Num[]) ?? []);
    const { data: o } = await supabase.from("organizations").select("slug, settings").eq("id", org.id).maybeSingle();
    setOrgSlug(o?.slug ?? "");
    const c = ((o?.settings ?? {}) as Record<string, any>).captacao;
    if (c) setCap({ ativo: !!c.ativo, titulo: c.titulo ?? "", texto: c.texto ?? "" });
    setLink((l) => (l.phone || !n?.[0]?.phone ? l : { ...l, phone: String(n[0].phone).replace(/\D/g, "") }));
  }, [org, days]);
  useEffect(() => { void load(); }, [load]);

  if (!org) return null;
  const manage = can("org.settings");
  if (!manage && !can("reports.view")) return <Navigate to="/" replace />;

  const saveCapture = async (ativo: boolean) => {
    const phoneOk = link.phone.replace(/\D/g, "").length >= 10;
    if (ativo && (!phoneOk || !cap.titulo.trim())) return toast({ variant: "destructive", title: "Falta o título ou o número de WhatsApp" });
    const { data } = await supabase.from("organizations").select("settings").eq("id", org.id).maybeSingle();
    const next = { ...((data?.settings ?? {}) as Record<string, unknown>),
      captacao: { ativo, titulo: cap.titulo.trim().slice(0, 80), texto: cap.texto.trim().slice(0, 600), phone: link.phone.replace(/\D/g, ""), origem: link.origem || "site", msg: link.msg } };
    const { error } = await supabase.from("organizations").update({ settings: next as never }).eq("id", org.id);
    if (error) return toast({ variant: "destructive", title: "Não salvo", description: error.message });
    setCap({ ...cap, ativo });
    toast({ title: ativo ? "Página publicada" : "Página despublicada" });
  };
  const pageUrl = orgSlug ? `${window.location.origin}/c/${orgSlug}` : "";

  const install = async () => {
    setInstalling(true);
    const r = await callFunction<{ id: string; warnings?: string[] }>("implementer", { action: "install", organization_id: org.id, template: "funil_vendas" });
    setInstalling(false);
    if (!r.ok) return toast({ variant: "destructive", title: "Não foi possível instalar", description: r.message });
    toast({ title: "Funil instalado", description: "Revise e publique o fluxo de qualificação em Fluxos." });
    void load();
  };

  const code = slug(link.origem);
  const phone = link.phone.replace(/\D/g, "");
  const waLink = phone && code ? `https://wa.me/${phone}?text=${encodeURIComponent(`${link.msg.trim()} (cód. ${code})`)}` : "";
  const copy = async () => {
    try { await navigator.clipboard.writeText(waLink); toast({ title: "Link copiado" }); }
    catch { toast({ variant: "destructive", title: "Não consegui copiar", description: "Selecione o link e copie manualmente." }); }
  };

  const stages = rep?.stages ?? [];
  const max = Math.max(1, ...stages.map((s) => s.count));
  const hasFunnel = stages.some((s) => s.name.toLowerCase() === "qualificado");

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="funil" />
      <SectionTabs group="resultados" active="funil" />
      <NumberHealthBanner />
      <main className="flex-1 w-full max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-brand text-2xl leading-tight">Funil de vendas</h1>
            <HowItWorks guide="funil-vendas" className="" />
            <p className="text-sm text-muted-foreground">Quantos contatos estão em cada etapa e de onde vieram. Os contatos se movem pelo Kanban, pelo fluxo de qualificação ou pela IA.</p>
          </div>
          <div className="flex gap-1">
            {PERIODS.map((p) => <Button key={p} size="sm" variant={days === p ? "default" : "outline"} onClick={() => setDays(p)}>{p} dias</Button>)}
          </div>
        </div>

        {manage && !hasFunnel && (
          <section className="rounded-xl border-2 border-primary bg-card p-5 space-y-2">
            <p className="font-medium flex items-center gap-2"><Sparkles className="w-4 h-4" /> Instalar o funil de vendas pronto</p>
            <p className="text-sm text-muted-foreground">Cria as etapas (Novo lead → Qualificado → Diagnóstico ou demonstração → Proposta enviada → Teste grátis → Cliente / Perdido), as etiquetas Lead quente, morno e frio, os campos do cliente (origem, tipo de empresa, equipe, maior dificuldade) e um fluxo que faz 4 perguntas, classifica e passa para vendas. O fluxo fica em rascunho para você revisar.</p>
            <Button disabled={installing} onClick={() => void install()}>{installing ? "Instalando…" : "Instalar funil"}</Button>
          </section>
        )}

        <section className="rounded-xl border bg-card p-5 space-y-3">
          <p className="font-medium">Contatos por etapa <span className="text-sm font-normal text-muted-foreground">(chegaram nos últimos {days} dias · {rep?.total ?? 0} no total)</span></p>
          {!stages.length ? <p className="text-sm text-muted-foreground">Nenhuma etapa no Kanban ainda.</p> : (
            <ul className="space-y-2">
              {stages.map((s) => (
                <li key={s.id} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3 text-sm">
                  <span className="truncate">{s.name}</span>
                  <span className="h-6 rounded bg-muted overflow-hidden">
                    <span className="block h-full rounded" style={{ width: `${(s.count / max) * 100}%`, background: s.color ?? "hsl(var(--primary))", minWidth: s.count ? 6 : 0 }} />
                  </span>
                  <span className="tabular-nums w-20 text-right">{s.count} <span className="text-muted-foreground">({pct(s.count, rep?.total ?? 0)}%)</span></span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">Cada contato conta na etapa em que está agora. Mova os cards em <Link className="underline" to="/kanban">Kanban</Link>.</p>
        </section>

        <section className="rounded-xl border bg-card p-5 space-y-3">
          <p className="font-medium">De onde vieram</p>
          {!rep?.origins?.length ? <p className="text-sm text-muted-foreground">Sem contatos no período.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3 font-normal">Origem</th><th className="py-1 pr-3 font-normal text-right">Contatos</th><th className="py-1 pr-3 font-normal text-right">Viraram cliente</th><th className="py-1 font-normal text-right">Conversão</th></tr></thead>
                <tbody>
                  {rep.origins.map((o) => (
                    <tr key={o.origem} className="border-t"><td className="py-1 pr-3">{o.origem}</td><td className="py-1 pr-3 text-right tabular-nums">{o.leads}</td><td className="py-1 pr-3 text-right tabular-nums">{o.clientes}</td><td className="py-1 text-right tabular-nums">{pct(o.clientes, o.leads)}%</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {manage && (
          <section className="rounded-xl border bg-card p-5 space-y-3">
            <p className="font-medium flex items-center gap-2"><Link2 className="w-4 h-4" /> Link de captação para o WhatsApp</p>
            <p className="text-sm text-muted-foreground">Use um link por canal (Instagram, Google, anúncio, indicação, evento). Quem chegar por ele já entra com a origem marcada na ficha.</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="text-sm space-y-1">
                <span>Número de WhatsApp</span>
                {nums.some((n) => n.phone) ? (
                  <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={phone} onChange={(e) => setLink({ ...link, phone: e.target.value })}>
                    {nums.filter((n) => n.phone).map((n) => <option key={n.id} value={String(n.phone).replace(/\D/g, "")}>{n.name} · {n.phone}</option>)}
                  </select>
                ) : <Input placeholder="5511999999999" value={link.phone} onChange={(e) => setLink({ ...link, phone: e.target.value })} />}
              </label>
              <label className="text-sm space-y-1"><span>Origem (ex.: instagram)</span><Input value={link.origem} maxLength={30} onChange={(e) => setLink({ ...link, origem: e.target.value })} /></label>
              <label className="text-sm space-y-1"><span>Mensagem que já vem escrita</span><Input value={link.msg} maxLength={120} onChange={(e) => setLink({ ...link, msg: e.target.value })} /></label>
            </div>
            {waLink ? (
              <div className="flex flex-wrap items-center gap-2">
                <code className="text-xs break-all rounded bg-muted px-2 py-1 flex-1 min-w-0">{waLink}</code>
                <Button size="sm" variant="outline" onClick={() => void copy()}><Copy className="w-4 h-4 mr-1" /> Copiar</Button>
              </div>
            ) : <p className="text-xs text-muted-foreground">Informe o número e a origem para gerar o link.</p>}
          </section>
        )}

        {manage && (
          <section className="rounded-xl border bg-card p-5 space-y-3">
            <p className="font-medium flex items-center gap-2"><Globe className="w-4 h-4" /> Página de captação</p>
            <p className="text-sm text-muted-foreground">
              Uma página simples, pública, com o seu título, um texto curto e o botão "Falar no WhatsApp" — usa o número, a origem e a
              mensagem do link acima. Bom para colocar na bio do Instagram, em anúncios ou num QR Code. Só aparece o que você escrever aqui.
            </p>
            <label className="text-sm space-y-1 block"><span>Título</span>
              <Input value={cap.titulo} maxLength={80} placeholder="Ex.: Certidões sem fila: peça pelo WhatsApp" onChange={(e) => setCap({ ...cap, titulo: e.target.value })} /></label>
            <label className="text-sm space-y-1 block"><span>Texto curto</span>
              <MicTextarea orgId={org.id} rows={3} maxLength={600} value={cap.texto} onChange={(t) => setCap({ ...cap, texto: t })}
                placeholder="Ex.: Atendemos de segunda a sexta, das 9h às 17h. Clique e fale com a nossa equipe." /></label>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => void saveCapture(true)}>{cap.ativo ? "Salvar e manter publicada" : "Publicar página"}</Button>
              {cap.ativo && <Button size="sm" variant="ghost" onClick={() => void saveCapture(false)}>Despublicar</Button>}
              {cap.ativo && pageUrl && (
                <>
                  <code className="text-xs break-all rounded bg-muted px-2 py-1">{pageUrl}</code>
                  <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(pageUrl).then(() => toast({ title: "Endereço copiado" }), () => {})}><Copy className="w-4 h-4 mr-1" /> Copiar</Button>
                </>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
