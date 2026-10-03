import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Slot = "principal" | "reserva1" | "reserva2";
interface SlotRow { slot: Slot; provider: string; model: string | null; has_key: boolean; last_error: string | null; last_error_at: string | null }
interface Usage { organization_id: string; organization_name: string; provider: string; source: string; calls: number; tokens_in: number; tokens_out: number; audio_calls: number }

const SLOTS: { key: Slot; label: string; hint: string }[] = [
  { key: "principal", label: "Principal", hint: "Usada em todas as chamadas." },
  { key: "reserva1", label: "Reserva 1", hint: "Entra sozinha se a principal falhar." },
  { key: "reserva2", label: "Reserva 2", hint: "Entra se a principal e a reserva 1 falharem." },
];
// Modelo sugerido de cada fornecedor (pode trocar; vazio = este).
const PROVIDERS: { key: string; label: string; model: string; audio: boolean }[] = [
  { key: "openai", label: "OpenAI", model: "gpt-4o-mini", audio: true },
  { key: "groq", label: "Groq", model: "auto", audio: true },
  { key: "gemini", label: "Google Gemini", model: "gemini-2.5-flash", audio: false },
  { key: "anthropic", label: "Anthropic (Claude)", model: "claude-haiku-4-5", audio: false },
  { key: "openrouter", label: "OpenRouter", model: "openrouter/auto", audio: false },
  { key: "deepseek", label: "DeepSeek", model: "deepseek-chat", audio: false },
];
const label = (p: string) => PROVIDERS.find((x) => x.key === p)?.label ?? p;
const n = (v: number) => Number(v || 0).toLocaleString("pt-BR");

/**
 * IA da Clubetec (só operador): Principal + 2 reservas, cada uma com fornecedor,
 * modelo e chave (no cofre; nunca volta para a tela). Se a principal falhar, o
 * servidor passa sozinho para as reservas. Mostra a última falha e o consumo por empresa.
 */
export function PlatformAIPanel() {
  const { toast } = useToast();
  const [rows, setRows] = useState<SlotRow[]>([]);
  const [form, setForm] = useState<Record<Slot, { provider: string; model: string; key: string }>>({
    principal: { provider: "openai", model: "", key: "" }, reserva1: { provider: "groq", model: "", key: "" }, reserva2: { provider: "gemini", model: "", key: "" },
  });
  const [busy, setBusy] = useState<Slot | null>(null);
  const [usage, setUsage] = useState<Usage[]>([]);

  const load = useCallback(async () => {
    const [{ data }, { data: u }] = await Promise.all([
      supabase.rpc("platform_ai_status"),
      supabase.rpc("platform_ai_usage", { since: new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10) }),
    ]);
    const list = (data as unknown as SlotRow[] | null) ?? [];
    setRows(list);
    setForm((f) => {
      const next = { ...f };
      for (const r of list) next[r.slot] = { provider: r.provider, model: r.model ?? "", key: "" };
      return next;
    });
    setUsage((u as unknown as Usage[] | null) ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async (slot: Slot) => {
    const f = form[slot];
    setBusy(slot);
    const { error } = await supabase.rpc("platform_ai_set", { slot_name: slot, provider_name: f.provider, model_name: f.model.trim(), secret_value: f.key.trim() });
    setBusy(null);
    if (error) return toast({ variant: "destructive", title: "Não salvou", description: error.message });
    toast({ title: `${SLOTS.find((s) => s.key === slot)?.label} salva`, description: "A chave vai para o cofre e não aparece de novo." });
    setForm((x) => ({ ...x, [slot]: { ...x[slot], key: "" } }));
    void load();
  };
  const clear = async (slot: Slot) => {
    if (!window.confirm("Esvaziar esta reserva? A chave dela é apagada do cofre.")) return;
    const { error } = await supabase.rpc("platform_ai_clear", { slot_name: slot });
    if (error) return toast({ variant: "destructive", title: "Não foi possível", description: error.message });
    void load();
  };

  const anyAudio = rows.some((r) => r.has_key && PROVIDERS.find((p) => p.key === r.provider)?.audio);
  const totals = usage.reduce<Record<string, { name: string; calls: number; tin: number; tout: number; audio: number }>>((m, u) => {
    const t = (m[u.organization_id] ??= { name: u.organization_name, calls: 0, tin: 0, tout: 0, audio: 0 });
    t.calls += Number(u.calls); t.tin += Number(u.tokens_in); t.tout += Number(u.tokens_out); t.audio += Number(u.audio_calls);
    return m;
  }, {});

  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div>
        <h2 className="font-semibold flex items-center gap-2"><Sparkles className="w-4 h-4" /> IA da Clubetec (incluída)</h2>
        <p className="text-sm text-muted-foreground">
          Usada pelas empresas que não têm chave própria (Diagnóstico, agente, fluxos, áudio). Escolha o fornecedor de cada posição; trocar
          de IA é só trocar aqui. Se a principal falhar, o sistema passa sozinho para a reserva 1 e depois para a 2.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {SLOTS.map((s) => {
          const row = rows.find((r) => r.slot === s.key);
          const f = form[s.key];
          const prov = PROVIDERS.find((p) => p.key === f.provider);
          return (
            <div key={s.key} className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{s.label}</p>
                {row?.has_key ? <Badge>{label(row.provider)}</Badge> : <Badge variant="outline">Vazia</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">{s.hint}</p>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={f.provider}
                onChange={(e) => setForm((x) => ({ ...x, [s.key]: { ...x[s.key], provider: e.target.value } }))}>
                {PROVIDERS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              <Input placeholder={`Modelo (vazio = ${prov?.model})`} value={f.model} maxLength={80}
                onChange={(e) => setForm((x) => ({ ...x, [s.key]: { ...x[s.key], model: e.target.value } }))} />
              <Input type="password" autoComplete="off" placeholder={row?.has_key && row.provider === f.provider ? "Trocar chave (deixe vazio para manter)" : "Chave do fornecedor"}
                value={f.key} onChange={(e) => setForm((x) => ({ ...x, [s.key]: { ...x[s.key], key: e.target.value } }))} />
              {prov && !prov.audio && <p className="text-xs text-muted-foreground">Este fornecedor não transcreve áudio; o áudio usa outra posição com OpenAI ou Groq.</p>}
              {row?.last_error && (
                <p className="text-xs text-amber-700 dark:text-amber-400 flex gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  Última falha {row.last_error_at ? new Date(row.last_error_at).toLocaleString("pt-BR") : ""}: {row.last_error}
                </p>
              )}
              <div className="flex gap-2">
                <Button size="sm" disabled={busy === s.key || (!row?.has_key && f.key.trim().length < 20)} onClick={() => void save(s.key)}>
                  {busy === s.key ? "Salvando…" : "Salvar"}
                </Button>
                {s.key !== "principal" && row && <Button size="sm" variant="ghost" onClick={() => void clear(s.key)}>Esvaziar</Button>}
              </div>
            </div>
          );
        })}
      </div>
      {rows.some((r) => r.has_key) && !anyAudio && (
        <p className="text-sm text-amber-700 dark:text-amber-400">Nenhuma posição com OpenAI ou Groq: os áudios dos clientes não serão transcritos.</p>
      )}

      <div className="space-y-2">
        <p className="font-medium text-sm">Consumo de IA por empresa (últimos 30 dias)</p>
        {!Object.keys(totals).length ? (
          <p className="text-sm text-muted-foreground">Ainda sem consumo registrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3 font-normal">Empresa</th><th className="py-1 pr-3 font-normal text-right">Chamadas</th><th className="py-1 pr-3 font-normal text-right">Texto enviado</th><th className="py-1 pr-3 font-normal text-right">Texto recebido</th><th className="py-1 font-normal text-right">Áudios</th></tr></thead>
              <tbody>
                {Object.entries(totals).map(([id, t]) => (
                  <tr key={id} className="border-t"><td className="py-1 pr-3">{t.name}</td><td className="py-1 pr-3 text-right">{n(t.calls)}</td><td className="py-1 pr-3 text-right">{n(t.tin)}</td><td className="py-1 pr-3 text-right">{n(t.tout)}</td><td className="py-1 text-right">{n(t.audio)}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground mt-1">Texto em tokens (a unidade que o fornecedor cobra). O custo em reais e a franquia por plano entram com os planos.</p>
          </div>
        )}
      </div>
    </section>
  );
}
