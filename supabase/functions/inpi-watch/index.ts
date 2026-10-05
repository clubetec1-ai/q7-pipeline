import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { HttpError, isPlatformOperator, requireUser } from "../_shared/auth.ts";
import { getSecret, safeEqual } from "../_shared/secrets.ts";
import { inpiGuidance, scanRpiZip } from "../_shared/inpi-rpi.ts";
import { esc, sendSystemEmail } from "../_shared/email.ts";

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

interface NewEvent { numero: string; label?: string; despacho: string; nivel?: string; orientacao?: string; complemento?: string; prazo?: string }
interface NewConflict { numero: string; marca: string; titulares?: string; classes?: string; despacho?: string; prazo?: string }
const dBR = (s?: string) => (s ? s.split("-").reverse().join("/") : "");

/** Um e-mail por revista (ou por falha), para os destinatários escolhidos em Plataforma. */
// deno-lint-ignore no-explicit-any
async function mailInpi(admin: any, subject: string, lines: string[], force = false) {
  const { data: r } = await admin.rpc("service_inpi_recipients");
  const cfg = (r ?? {}) as { on?: boolean; to?: string[] };
  if (!force && cfg.on === false) return { sent: 0, skipped: "e-mail desligado" };
  const to = (cfg.to ?? []).filter(Boolean);
  if (!to.length) return { sent: 0, skipped: "sem destinatário" };
  const { data: appUrl } = await admin.from("app_settings").select("value").eq("key", "app_url").maybeSingle();
  const link = appUrl?.value ? `${String(appUrl.value).replace(/\/$/, "")}/plataforma` : "";
  const text = `Olá!\n\n${lines.join("\n\n")}\n\n${link ? `Detalhes em Plataforma → Planos → Marca no INPI: ${link}` : "Veja em Plataforma → Planos → Marca no INPI."}\n\nDeixa com a IA`;
  const html = `<p>Olá!</p>${lines.map((l) => `<p>${esc(l).replace(/\n/g, "<br>")}</p>`).join("")}` +
    `<p>${link ? `<a href="${esc(link)}">Ver em Plataforma → Marca no INPI</a>` : "Veja em Plataforma → Planos → Marca no INPI."}</p><p>Deixa com a IA</p>`;
  let sent = 0, skipped = "";
  for (const t of to) {
    const res = await sendSystemEmail(admin, { to: t, subject: `[Deixa com a IA] ${subject}`, text, html });
    if (res.ok) sent++; else skipped = res.skipped ?? res.error ?? "falhou";
  }
  if (skipped) console.log("[inpi-watch] e-mail", { sent, skipped });
  return { sent, ...(skipped ? { skipped } : {}) };
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
      if (body?.action === "test_email") {
        const r = await mailInpi(admin, "Teste do aviso do INPI", [
          "Este é um e-mail de teste do monitor da marca no INPI.",
          "Quando a revista do INPI publicar algo nos nossos pedidos (ou uma marca parecida com a nossa), o aviso chega assim, com o que fazer e o prazo.",
        ], true);
        if (!r.sent) throw new HttpError(409, `Não enviei: ${r.skipped ?? "sem destinatário"}`);
        return json({ ok: true, sent: r.sent });
      }
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
    const fail = async (msg: string) => {
      const { data: f } = await admin.rpc("service_inpi_record", { p_rpi: ed.numero, p_date: iso(ed.dataPublicacao), p_processes: [], p_conflicts: [], p_error: msg });
      // Avisa só na primeira falha desta revista (o cron tenta de novo todo dia).
      if ((f as { first_error?: boolean } | null)?.first_error) {
        await mailInpi(admin, `INPI: não consegui ler a revista ${ed.numero}`, [
          `A leitura da RPI ${ed.numero} (${ed.dataPublicacao}) falhou: ${msg}`,
          "Vou tentar de novo sozinho todos os dias. Se continuar, use \"Verificar agora\" em Plataforma ou confira os processos no pePI.",
        ]);
      }
    };
    if (!zip) {
      const msg = `A revista ${ed.numero} não baixou (${why.slice(0, 120)}); tento de novo amanhã.`;
      await fail(msg);
      throw new HttpError(502, msg);
    }

    let scan;
    try {
      scan = await scanRpiZip(zip, { numbers: watch.numbers, titulares: watch.titulares, terms: watch.terms });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await fail(msg.slice(0, 200));
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
    const out = rec as { events: number; conflicts: number; new_events?: NewEvent[]; new_conflicts?: NewConflict[] };
    const evs = out.new_events ?? [];
    const cfs = out.new_conflicts ?? [];
    let mail = null;
    if (evs.length || cfs.length) {
      const urgent = evs.some((e) => e.nivel === "urgente");
      const lines = [
        `Saiu a Revista da Propriedade Industrial nº ${ed.numero} (${ed.dataPublicacao}).`,
        ...evs.map((e) => `${e.nivel === "urgente" ? "⚠ AÇÃO NECESSÁRIA — " : ""}${e.label || "Processo"} (nº ${e.numero}): ${e.despacho}.` +
          (e.orientacao ? `\n${e.orientacao}` : "") + (e.prazo ? `\nPrazo estimado: ${dBR(e.prazo)}.` : "") +
          (e.complemento ? `\nTexto do despacho: ${e.complemento}` : "")),
        ...cfs.map((c) => `Marca parecida com a nossa: "${c.marca}" (nº ${c.numero}, ${c.titulares || "titular não informado"}, classe ${c.classes || "?"}): ${c.despacho ?? ""}.` +
          (c.prazo ? `\nSe for do mesmo ramo, dá para apresentar oposição até ${dBR(c.prazo)}.` : "")),
      ];
      const subject = urgent ? `URGENTE — INPI: ação necessária (RPI ${ed.numero})`
        : evs.length ? `INPI: novidade nos pedidos da marca (RPI ${ed.numero})` : `INPI: marca parecida com a nossa (RPI ${ed.numero})`;
      mail = await mailInpi(admin, subject, lines);
    }
    return json({ ok: true, rpi: ed.numero, data: iso(ed.dataPublicacao), events: out.events, conflicts: out.conflicts, pending: pending.length - 1, ...(mail ? { mail } : {}) });
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    console.error("[inpi-watch]", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Erro interno" }, 500);
  }
});
