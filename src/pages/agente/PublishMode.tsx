import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type Mode = "sombra" | "assistido" | "automatico";
interface Event { kind: string; detail: string; created_at: string }

const MODES: { key: Mode; title: string; desc: string }[] = [
  { key: "sombra", title: "1. Sombra — a IA sugere, você envia", desc: "Nada vai para o cliente sem uma pessoa. A sugestão aparece na conversa com o botão Usar sugestão. É onde todo agente começa." },
  { key: "assistido", title: "2. Assistido — a IA envia o simples", desc: "Respostas diretas (horário, preço da tabela, como funciona) saem sozinhas; reclamação, negociação e exceção vão para uma pessoa. Precisa do Atendente geral (IA) aprovado e com a prova em dia." },
  { key: "automatico", title: "3. Automático — a IA atende sozinha", desc: "Libera depois de 14 dias no assistido sem nenhum tropeço. A trava de segurança e o disjuntor continuam valendo." },
];
const KIND: Record<string, string> = { guard_block: "Trava segurou uma resposta", avaliacao_ruim: "Atendimento mal avaliado", manual: "Registro manual", stepdown: "Voltou um degrau" };
const GUARD: Record<string, string> = { nao_promete: "prometia o que não pode", nao_pede_senha: "pedia senha ou cartão", nao_revela_dados: "expunha dado pessoal" };

/**
 * Degraus de publicação (desenho 07, fatia 7): sombra → assistido → automático, sempre por decisão do dono.
 * O disjuntor volta um degrau sozinho depois de 3 tropeços em 24 h; parar é a chave "Agente ligado" acima.
 */
export function PublishMode({ orgId }: { orgId: string }) {
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>("sombra");
  const [since, setSince] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: c }, { data: e }] = await Promise.all([
      supabase.from("agent_configs").select("publish_mode, publish_mode_since").eq("organization_id", orgId).maybeSingle(),
      supabase.from("ai_breaker_events").select("kind, detail, created_at").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(6),
    ]);
    const row = c as { publish_mode?: Mode; publish_mode_since?: string } | null;
    setMode(row?.publish_mode ?? "sombra");
    setSince(row?.publish_mode_since ?? null);
    setEvents((e as Event[]) ?? []);
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);

  const choose = async (m: Mode) => {
    if (m === mode) return;
    setBusy(true);
    const { error } = await supabase.rpc("set_publish_mode", { org: orgId, p_mode: m });
    setBusy(false);
    if (error) return toast({ variant: "destructive", title: "Ainda não dá para mudar", description: error.message });
    toast({ title: "Modo atualizado" });
    void load();
  };

  return (
    <section data-demo="degraus" className="rounded-xl border bg-card p-4 space-y-3">
      <div>
        <p className="font-medium flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Como a IA publica as respostas</p>
        <p className="text-xs text-muted-foreground">
          Sobe um degrau por vez, sempre por decisão sua. Para parar tudo na hora, desligue a chave "Agente ligado" acima.
          Antes de subir, monte o <Link to="/organograma" className="underline">Time de IA</Link> e rode a prova do Atendente geral (IA).
        </p>
      </div>
      <div className="grid gap-2">
        {MODES.map((m) => (
          <button key={m.key} type="button" disabled={busy} onClick={() => void choose(m.key)}
            data-demo={`modo-${m.key}`}
            className={`rounded-lg border p-3 text-left text-sm transition ${mode === m.key ? "border-primary bg-primary/5" : "hover:bg-muted"}`}>
            <span className="flex items-center justify-between gap-2"><b>{m.title}</b>{mode === m.key && <span className="text-xs text-primary-text">em uso{since ? ` desde ${new Date(since).toLocaleDateString("pt-BR")}` : ""}</span>}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{m.desc}</span>
          </button>
        ))}
      </div>
      <div data-demo="disjuntor" className="rounded-md bg-muted/50 p-2 text-xs space-y-1">
        <p><b>Disjuntor:</b> se em 24 horas a IA tropeçar 3 vezes (a trava segurou uma resposta ou um atendimento foi mal avaliado), ela volta um degrau sozinha e você recebe um aviso.</p>
        {events.length > 0 ? (
          <ul className="space-y-0.5">
            {events.map((e, i) => (
              <li key={i}>{new Date(e.created_at).toLocaleString("pt-BR")} — {KIND[e.kind] ?? e.kind}{e.detail ? `: ${e.detail.split(",").map((x) => GUARD[x] ?? x).join(", ")}` : ""}</li>
            ))}
          </ul>
        ) : <p className="text-muted-foreground">Nenhum tropeço registrado.</p>}
      </div>
    </section>
  );
}
