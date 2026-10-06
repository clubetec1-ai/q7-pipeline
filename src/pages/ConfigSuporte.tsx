import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowLeft, BookOpen, LifeBuoy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface Ticket { id: string; protocol: string | null; topic: string; message: string; status: string; urgency: string; source: string; page: string | null; reply: string | null; created_at: string; updated_at: string }

const URGENCY: Record<string, [string, string, string]> = {
  baixa: ["Baixa", "bg-muted text-muted-foreground", "sugestão ou melhoria"],
  media: ["Média", "bg-info-soft text-info-text", "dúvida de configuração ou uso"],
  alta: ["Alta", "bg-warning-soft text-warning-text", "uma função importante não funciona"],
  urgente: ["Urgente", "bg-danger-soft text-danger-text", "atendimento parado, clientes sem resposta, cobrança ou segurança"],
};
const STATUS: Record<string, [string, string]> = {
  open: ["Aberto", "bg-warning-soft text-warning-text"], in_progress: ["Em andamento", "bg-info-soft text-info-text"],
  done: ["Resolvido", "bg-success-soft text-success-text"], canceled: ["Cancelado", "bg-muted text-muted-foreground"],
};
const when = (s: string) => new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** Configurações → Suporte: chamados da empresa (abertos pela pessoa ou pelo assistente) e resposta da equipe. */
export default function ConfigSuporte() {
  const { org, can } = useOrg();
  const { user } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<Ticket[]>([]);
  const [form, setForm] = useState({ topic: "", message: "", urgency: "media" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!org) return;
    const { data } = await supabase.from("service_requests")
      .select("id, protocol, topic, message, status, urgency, source, page, reply, created_at, updated_at")
      .eq("organization_id", org.id).order("created_at", { ascending: false }).limit(50);
    setRows((data ?? []) as Ticket[]);
  }, [org]);
  useEffect(() => { void load(); }, [load]);

  if (!org) return null;
  if (!can("org.settings")) return <Navigate to="/" replace />;

  const open = async () => {
    if (!form.topic.trim() || !form.message.trim()) return;
    setBusy(true);
    const { data, error } = await supabase.from("service_requests").insert({
      organization_id: org.id, topic: form.topic.trim().slice(0, 120), message: form.message.trim().slice(0, 2000),
      urgency: form.urgency, page: "/configuracoes/suporte", created_by: user?.id,
    }).select("protocol").single();
    setBusy(false);
    if (error) return toast({ variant: "destructive", title: "Não abriu o chamado", description: error.message });
    toast({ title: `Chamado ${data?.protocol ?? ""} aberto`, description: "A equipe Clubetec foi avisada. Você recebe a confirmação por e-mail e a resposta aparece aqui e no sino." });
    setForm({ topic: "", message: "", urgency: "media" });
    void load();
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="configuracoes" />
      <main className="flex-1 w-full max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="space-y-1">
          <Link to="/configuracoes" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"><ArrowLeft className="w-4 h-4" /> Configurações</Link>
          <h1 className="text-xl font-semibold flex items-center gap-2"><LifeBuoy className="w-5 h-5" /> Suporte</h1>
          <p className="text-sm text-muted-foreground">
            Antes de abrir um chamado, veja a <b>Ajuda</b> (o <b>?</b> no topo): ela tem o passo a passo e os vídeos de cada tela e responde dúvidas.
            Se a Ajuda não resolver, ela mesma abre o chamado com a conversa. Você também pode abrir aqui.
          </p>
          <Button size="sm" variant="outline" onClick={() => window.dispatchEvent(new Event("help:open"))}><BookOpen className="w-4 h-4 mr-1" /> Abrir a Ajuda</Button>
        </div>

        <section className="space-y-2 rounded-lg border p-4">
          <h2 className="font-semibold">Abrir um chamado</h2>
          <Input placeholder="Assunto (ex.: o número do WhatsApp desconectou)" maxLength={120} value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} aria-label="Assunto" />
          <Textarea rows={4} maxLength={2000} placeholder="O que aconteceu, em qual tela e o que você já tentou" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} aria-label="Descrição" />
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm">Urgência:</label>
            <select className="h-9 rounded-md border bg-background px-2 text-sm" value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })} aria-label="Urgência">
              {Object.entries(URGENCY).map(([k, [l, , d]]) => <option key={k} value={k}>{l} — {d}</option>)}
            </select>
            <Button className="ml-auto" disabled={busy || !form.topic.trim() || !form.message.trim()} onClick={() => void open()}>{busy ? "Abrindo..." : "Abrir chamado"}</Button>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">Chamados da empresa</h2>
          {rows.length === 0 && <p className="text-sm text-muted-foreground">Nenhum chamado ainda.</p>}
          {rows.map((t) => (
            <details key={t.id} className="rounded-md border p-3 text-sm">
              <summary className="cursor-pointer flex flex-wrap items-center gap-2">
                {t.protocol && <span className="font-mono text-xs text-muted-foreground">{t.protocol}</span>}
                <span className="font-medium">{t.topic}</span>
                <span className={`rounded px-1.5 py-0.5 text-xs ${URGENCY[t.urgency]?.[1] ?? ""}`}>{URGENCY[t.urgency]?.[0] ?? t.urgency}</span>
                <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS[t.status]?.[1] ?? ""}`}>{STATUS[t.status]?.[0] ?? t.status}</span>
                <span className="text-xs text-muted-foreground">{when(t.created_at)}{t.source === "assistente" ? " · aberto pela Ajuda" : ""}</span>
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{t.message}</p>
              {t.reply && <p className="mt-2 rounded-md bg-primary/10 p-2 whitespace-pre-wrap"><b>Resposta da equipe Clubetec:</b> {t.reply}</p>}
            </details>
          ))}
        </section>
      </main>
    </div>
  );
}
