import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowLeft, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { AppHeader } from "@/components/AppHeader";
import { NumberHealthBanner } from "@/components/NumberHealthBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

type Hours = Record<string, { start: string; end: string }[]>;
const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const DEFAULT_HOURS: Hours = Object.fromEntries([1, 2, 3, 4, 5].map((d) => [String(d), [{ start: "08:00", end: "18:00" }]]));
const DEFAULT_OPT_OUT = ["SAIR", "PARAR"];
const DEFAULT_OPT_OUT_REPLY = "Pronto, você não vai mais receber mensagens automáticas. Se precisar, é só mandar mensagem.";

/**
 * Configurações → Horário e LGPD (dono/admin): horário de atendimento (usado pelo
 * bloco Horário dos fluxos e pela IA) e as palavras para parar mensagens automáticas.
 * Saiu de dentro de Fluxos: é configuração da empresa, não do fluxo.
 */
export default function ConfigAtendimento() {
  const { org, can } = useOrg();
  const { toast } = useToast();
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [draftHours, setDraftHours] = useState<Hours | null>(null);
  const [optWords, setOptWords] = useState<string | null>(null);
  const [optReply, setOptReply] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!org) return;
    const { data } = await supabase.from("organizations").select("settings").eq("id", org.id).maybeSingle();
    setSettings((data?.settings ?? {}) as Record<string, unknown>);
  }, [org]);
  useEffect(() => { void load(); }, [load]);

  const saveSettings = async (patch: Record<string, unknown>) => {
    if (!org) return false;
    // Relê antes de gravar para não apagar ajustes feitos em outra tela.
    const { data } = await supabase.from("organizations").select("settings").eq("id", org.id).maybeSingle();
    const next = { ...((data?.settings ?? {}) as Record<string, unknown>), ...patch };
    const { error } = await supabase.from("organizations").update({ settings: next as never }).eq("id", org.id);
    if (error) { toast({ variant: "destructive", title: "Sem permissão" }); return false; }
    setSettings(next);
    toast({ title: "Salvo" });
    return true;
  };

  const h = draftHours ?? (settings.business_hours as Hours | undefined) ?? DEFAULT_HOURS;
  const hasHours = !!settings.business_hours;
  const setDay = (d: number, slot: { start: string; end: string } | null) => setDraftHours({ ...h, [String(d)]: slot ? [slot] : [] });
  const saveHours = async () => {
    const bad = Object.values(h).flat().some((s) => !s.start || !s.end || s.start >= s.end);
    if (bad) return toast({ variant: "destructive", title: "Horário inicial deve ser antes do final" });
    if (await saveSettings({ business_hours: h })) setDraftHours(null);
  };

  const words = optWords ?? ((settings.opt_out_words as string[] | undefined) ?? DEFAULT_OPT_OUT).join(", ");
  const reply = optReply ?? (typeof settings.opt_out_reply === "string" ? settings.opt_out_reply : DEFAULT_OPT_OUT_REPLY);
  const saveOptOut = async () => {
    const list = words.split(",").map((w) => w.trim().slice(0, 30)).filter(Boolean).slice(0, 10);
    if (!list.length) return toast({ variant: "destructive", title: "Informe ao menos uma palavra" });
    if (!reply.trim()) return toast({ variant: "destructive", title: "Escreva a confirmação" });
    if (await saveSettings({ opt_out_words: list, opt_out_reply: reply.trim().slice(0, 500) })) { setOptWords(null); setOptReply(null); }
  };

  if (!org) return null;
  if (!can("org.settings")) return <Navigate to="/configuracoes" replace />;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="configuracoes" />
      <NumberHealthBanner />
      <main className="flex-1 w-full max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
        <Link to="/configuracoes" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:underline"><ArrowLeft className="w-4 h-4" /> Configurações</Link>
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Clock className="w-6 h-6" /> Horário e LGPD</h1>
          <p className="text-sm text-muted-foreground">Quando a empresa atende e como o cliente para de receber mensagens automáticas.</p>
        </div>

        <section className="rounded-xl border bg-card p-4 space-y-3">
          <h2 className="font-semibold">Horário de atendimento</h2>
          <p className="text-xs text-muted-foreground">
            Fora deste horário, o bloco “Horário” dos fluxos segue pelo caminho “Fechado” (ex.: mensagem de fora do expediente).
            Fuso: {String(settings.timezone || "America/Sao_Paulo")}.
            {!hasHours && " Ainda não salvo: confira e clique em Salvar horário."}
          </p>
          <div className="space-y-2">
            {WEEKDAYS.map((w, d) => {
              const slot = h[String(d)]?.[0] ?? null;
              return (
                <div key={d} className="flex flex-wrap items-center gap-2">
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
          <Button variant={hasHours ? "outline" : "default"} disabled={hasHours && !draftHours} onClick={saveHours}>Salvar horário</Button>
        </section>

        <section className="rounded-xl border bg-card p-4 space-y-3">
          <h2 className="font-semibold">Parar mensagens automáticas (LGPD)</h2>
          <p className="text-xs text-muted-foreground">
            Se o cliente mandar só uma destas palavras, deixa de receber follow-ups, esperas, pesquisas e campanhas. Respostas ao
            que ele mesmo escrever continuam. O atendente vê o aviso na ficha e pode desfazer a pedido do cliente.
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
      </main>
    </div>
  );
}
