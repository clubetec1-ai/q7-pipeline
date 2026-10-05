import { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw, Stamp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Proc { numero: string; label: string; protocolo: string | null; filed_at: string | null; source: string; marca: string | null; last_status: string | null; last_rpi: number | null; last_at: string | null }
interface Ev { id: string; numero: string; rpi: number; rpi_date: string; codigo: string; nome: string; complemento: string | null; nivel: string; orientacao: string | null; prazo: string | null }
interface Conflict { id: string; numero: string; rpi: number; rpi_date: string; marca: string; titulares: string | null; classes: string | null; despacho: string | null; prazo: string | null; reviewed_at: string | null }
interface Scan { rpi: number; rpi_date: string | null; events: number; conflicts: number; error: string | null; scanned_at: string }

const d = (s: string | null) => (s ? s.split("-").reverse().join("/") : "—");
const NIVEL: Record<string, string> = {
  urgente: "bg-danger-soft text-danger-text", atencao: "bg-warning-soft text-warning-text",
  info: "bg-info-soft text-info-text", ok: "bg-success-soft text-success-text",
};
const PEPI = "https://busca.inpi.gov.br/pePI/";

/** Plataforma → Marca no INPI: pedidos da Clubetec, despachos da RPI, prazos e marcas parecidas. */
export function InpiPanel() {
  const { toast } = useToast();
  const [procs, setProcs] = useState<Proc[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [scan, setScan] = useState<Scan | null>(null);
  const [watch, setWatch] = useState({ terms: "", titulares: "" });
  const [form, setForm] = useState({ numero: "", label: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [p, e, c, s, w] = await Promise.all([
      supabase.from("inpi_processes").select("*").order("filed_at", { ascending: true, nullsFirst: false }),
      supabase.from("inpi_events").select("*").order("rpi", { ascending: false }).limit(200),
      supabase.from("inpi_conflicts").select("*").order("rpi", { ascending: false }).limit(50),
      supabase.from("inpi_scans").select("*").order("rpi", { ascending: false }).limit(1),
      supabase.from("inpi_settings").select("terms, titulares").maybeSingle(),
    ]);
    setProcs((p.data ?? []) as Proc[]);
    setEvents((e.data ?? []) as Ev[]);
    setConflicts((c.data ?? []) as Conflict[]);
    setScan(((s.data ?? [])[0] ?? null) as Scan | null);
    if (w.data) setWatch({ terms: (w.data.terms ?? []).join(", "), titulares: (w.data.titulares ?? []).join(", ") });
  }, []);
  useEffect(() => { void load(); }, [load]);

  const check = async () => {
    setBusy(true);
    const r = await callFunction<{ nothing?: boolean; rpi?: number; events?: number; conflicts?: number; pending?: number }>("inpi-watch", { action: "scan" });
    setBusy(false);
    if (!r.ok) return toast({ variant: "destructive", title: "Não verificou", description: r.message });
    toast(r.data.nothing
      ? { title: "Nenhuma revista nova", description: "A RPI sai toda terça. Nada novo desde a última leitura." }
      : { title: `RPI ${r.data.rpi} lida`, description: `${r.data.events ?? 0} despacho(s) nos nossos processos, ${r.data.conflicts ?? 0} marca(s) parecida(s).${r.data.pending ? ` Faltam ${r.data.pending} revista(s): clique de novo.` : ""}` });
    void load();
  };
  const rpc = async (fn: string, args: Record<string, unknown>, ok: string) => {
    const { error } = await supabase.rpc(fn as never, args as never);
    if (error) return toast({ variant: "destructive", title: "Não salvo", description: error.message });
    toast({ title: ok });
    void load();
  };
  const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold flex items-center gap-2"><Stamp className="w-4 h-4" /> Marca no INPI</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" asChild><a href={PEPI} target="_blank" rel="noreferrer"><ExternalLink className="w-4 h-4 mr-1" /> Consulta pePI</a></Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void check()}><RefreshCw className="w-4 h-4 mr-1" /> {busy ? "Lendo a revista..." : "Verificar agora"}</Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Lê sozinho a Revista da Propriedade Industrial (sai toda terça) e avisa no sino e por e-mail quando sair algo nos nossos
        pedidos ou uma marca parecida com a nossa. Prazos são estimados a partir da data da revista — confira no despacho.
        {scan && ` Última revista lida: RPI ${scan.rpi} de ${d(scan.rpi_date)}.`}
        {scan?.error && <span className="text-danger-text"> Erro na última leitura: {scan.error}</span>}
      </p>

      <div className="space-y-2">
        {procs.map((p) => {
          const evs = events.filter((e) => e.numero === p.numero);
          const urgent = evs.find((e) => e.nivel === "urgente" && e.prazo && e.prazo >= new Date().toISOString().slice(0, 10));
          return (
            <details key={p.numero} className={`rounded-md border p-2 text-sm ${urgent ? "border-danger" : ""}`}>
              <summary className="cursor-pointer">
                <b>{p.label || p.marca || "Processo"}</b> · nº {p.numero}{p.protocolo ? ` · protocolo ${p.protocolo}` : ""}{p.filed_at ? ` · depositado em ${d(p.filed_at)}` : ""}
                <div className="text-xs text-muted-foreground">
                  {p.last_status ? `Último despacho: ${p.last_status} (RPI ${p.last_rpi}, ${d(p.last_at)})` : "Aguardando a primeira publicação na RPI (exame formal)."}
                  {urgent && <span className="text-danger-text"> · ⚠ prazo até {d(urgent.prazo)}</span>}
                </div>
              </summary>
              <ul className="mt-2 space-y-2">
                {evs.length === 0 && <li className="text-xs text-muted-foreground">Nenhum despacho ainda.</li>}
                {evs.map((e) => (
                  <li key={e.id} className="text-xs">
                    <span className={`rounded px-1.5 py-0.5 mr-1 ${NIVEL[e.nivel] ?? ""}`}>RPI {e.rpi} · {d(e.rpi_date)}</span>
                    <b>{e.nome}</b> ({e.codigo}){e.prazo && <> · prazo estimado <b>{d(e.prazo)}</b></>}
                    {e.orientacao && <div className="text-muted-foreground">{e.orientacao}</div>}
                    {e.complemento && <div className="italic">{e.complemento}</div>}
                  </li>
                ))}
              </ul>
              <Button size="sm" variant="ghost" className="mt-1 h-7 text-xs"
                onClick={() => { if (confirm(`Parar de acompanhar o processo ${p.numero}? O histórico dele aqui será apagado (no INPI nada muda).`)) void rpc("platform_inpi_remove_process", { p_numero: p.numero }, "Processo removido"); }}>
                Parar de acompanhar
              </Button>
            </details>
          );
        })}
      </div>

      {conflicts.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Marcas parecidas publicadas por outros</h3>
          {conflicts.map((c) => (
            <div key={c.id} className={`rounded-md border p-2 text-xs ${c.reviewed_at ? "opacity-60" : ""}`}>
              <b>"{c.marca}"</b> · nº {c.numero} · {c.titulares || "titular não informado"} · classe {c.classes || "—"} · RPI {c.rpi} ({d(c.rpi_date)})
              <div>{c.despacho}{c.prazo && !c.reviewed_at && <span className="text-warning-text"> · oposição até {d(c.prazo)}</span>}</div>
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => void rpc("platform_inpi_review_conflict", { p_id: c.id }, c.reviewed_at ? "Reaberta" : "Marcada como vista")}>
                {c.reviewed_at ? "Reabrir" : "Marcar como vista"}
              </Button>
            </div>
          ))}
        </div>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Acompanhar outro processo e o que vigiar</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <Input placeholder="Nº do processo (9 dígitos)" inputMode="numeric" maxLength={9} value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value.replace(/\D/g, "") })} aria-label="Número do processo" />
          <Input placeholder="Descrição (ex.: Clubetec — classe 42)" maxLength={120} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} aria-label="Descrição" />
          <Button variant="outline" disabled={form.numero.length !== 9}
            onClick={() => void rpc("platform_inpi_save_process", { p_numero: form.numero, p_label: form.label, p_protocolo: null, p_filed_at: null }, "Processo adicionado").then(() => setForm({ numero: "", label: "" }))}>
            Acompanhar
          </Button>
          <Input className="sm:col-span-3" placeholder="Marcas parecidas a vigiar, separadas por vírgula" value={watch.terms} onChange={(e) => setWatch({ ...watch, terms: e.target.value })} aria-label="Marcas a vigiar" />
          <Input className="sm:col-span-2" placeholder="Titulares (processos novos entram sozinhos)" value={watch.titulares} onChange={(e) => setWatch({ ...watch, titulares: e.target.value })} aria-label="Titulares" />
          <Button variant="outline" onClick={() => void rpc("platform_inpi_set_watch", { p_terms: split(watch.terms), p_titulares: split(watch.titulares) }, "Vigilância salva")}>Salvar vigilância</Button>
        </div>
      </details>
    </section>
  );
}
