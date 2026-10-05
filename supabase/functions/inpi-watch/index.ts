import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { HttpError, isPlatformOperator, requireUser } from "../_shared/auth.ts";
import { getSecret, safeEqual } from "../_shared/secrets.ts";
import { inpiGuidance, scanRpiZip } from "../_shared/inpi-rpi.ts";

/**
 * Acompanhamento dos pedidos de marca na RPI (revista semanal do INPI, seção Marcas).
 * Cron diário (x-cron-secret) ou a Clubetec em Plataforma ("Verificar agora"). A cada
 * chamada lê no máximo UMA edição nova (o XML é grande; limite de CPU da função) e grava
 * os despachos dos nossos processos e as marcas parecidas com a nossa.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const RPI = "https://revistas.inpi.gov.br";
const UA = { "User-Agent": "Mozilla/5.0 (DeixaComAIA monitor de marca)" };
interface Edition { numero: number; nomeArquivoEscritorio: string; dataPublicacao: string }
const br = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
const iso = (s: string) => s.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, "$3-$2-$1");

async function editions(from: Date): Promise<Edition[]> {
  const q = new URLSearchParams({ "revista.dataInicial": br(from), "revista.dataFinal": br(new Date()), "revista.tipoRevista.id": "5" });
  const res = await fetch(`${RPI}/rpi/busca/data?${q}`, { headers: UA, signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!res?.ok) throw new HttpError(502, `A lista de revistas do INPI não respondeu (HTTP ${res?.status ?? "sem resposta"})`);
  const list = await res.json().catch(() => []) as Edition[];
  return (Array.isArray(list) ? list : [])
    .filter((e) => Number.isInteger(e.numero) && /^RM\d{3,5}\.zip$/.test(e.nomeArquivoEscritorio ?? "") && /^\d{2}\/\d{2}\/\d{4}$/.test(e.dataPublicacao ?? ""))
    .sort((a, b) => a.numero - b.numero);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const body = await req.json().catch(() => ({}));
    const cron = req.headers.get("x-cron-secret");
    if (cron) {
      const expected = await getSecret(admin, "platform:cron_secret");
      if (!expected || !safeEqual(cron, expected)) return json({ ok: false, error: "unauthorized" }, 401);
    } else {
      const ctx = await requireUser(req);
      if (!(await isPlatformOperator(ctx))) throw new HttpError(403, "Só a Clubetec");
    }

    const { data: w, error: we } = await admin.rpc("service_inpi_watch");
    if (we || !w) throw new Error(we?.message ?? "sem configuração");
    const watch = w as { numbers: string[]; terms: string[]; titulares: string[]; last_rpi: number | null; since: string | null };

    // Pode reler uma edição específica (ex.: conferir uma revista antiga).
    const only = Number.isInteger(body?.rpi) && body.rpi > 0 ? Number(body.rpi) : null;
    const since = new Date(watch.since ? `${watch.since}T00:00:00Z` : Date.now() - 14 * 864e5);
    const from = only ? new Date(Date.now() - 400 * 864e5) : new Date(Math.max(since.getTime() - 864e5, Date.now() - 120 * 864e5));
    const list = await editions(from);
    const pending = only ? list.filter((e) => e.numero === only)
      : list.filter((e) => (watch.last_rpi ? e.numero > watch.last_rpi : iso(e.dataPublicacao) >= (watch.since ?? "")));
    const ed = pending[0];
    if (!ed) return json({ ok: true, nothing: true, last_rpi: watch.last_rpi });

    // O servidor do INPI às vezes corta a conexão no meio: até 3 tentativas.
    let zip: Uint8Array | null = null;
    let why = "";
    for (let i = 0; i < 3 && !zip; i++) {
      try {
        const res = await fetch(`${RPI}/txt/${ed.nomeArquivoEscritorio}`, { headers: UA, signal: AbortSignal.timeout(60_000) });
        if (!res.ok) { why = `HTTP ${res.status}`; await res.body?.cancel(); continue; }
        zip = new Uint8Array(await res.arrayBuffer());
      } catch (e) {
        why = e instanceof Error ? e.message : String(e);
      }
    }
    if (!zip) throw new HttpError(502, `A revista ${ed.numero} não baixou (${why.slice(0, 120)}); tento de novo amanhã.`);

    let scan;
    try {
      scan = await scanRpiZip(zip, { numbers: watch.numbers, titulares: watch.titulares, terms: watch.terms });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await admin.rpc("service_inpi_record", { p_rpi: ed.numero, p_date: iso(ed.dataPublicacao), p_processes: [], p_conflicts: [], p_error: msg });
      throw new HttpError(502, `Não consegui ler a revista ${ed.numero}: ${msg}`);
    }
    const ours = scan.hits.filter((h) => h.motivo !== "marca");
    const processes = ours.map((h) => ({
      numero: h.numero, marca: h.marca, motivo: h.motivo,
      despachos: h.despachos.map((d) => {
        const g = inpiGuidance(d.nome);
        return { ...d, nivel: g.nivel, orientacao: g.texto, ...(g.dias ? { dias: g.dias } : {}) };
      }),
    }));
    const conflicts = scan.hits.filter((h) => h.motivo === "marca").map((h) => ({
      numero: h.numero, marca: h.marca, termo: h.termo,
      titulares: h.titulares.join("; ").slice(0, 500),
      classes: h.classes.map((c) => c.codigo).join(", ").slice(0, 200),
      despacho: h.despachos.map((d) => d.nome).join("; ").slice(0, 300),
    }));
    const { data: rec, error: re } = await admin.rpc("service_inpi_record", {
      p_rpi: ed.numero, p_date: iso(ed.dataPublicacao), p_processes: processes, p_conflicts: conflicts, p_error: null,
    });
    if (re) throw new Error(re.message);
    return json({ ok: true, rpi: ed.numero, data: iso(ed.dataPublicacao), ...(rec as object), pending: pending.length - 1 });
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    console.error("[inpi-watch]", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Erro interno" }, 500);
  }
});
