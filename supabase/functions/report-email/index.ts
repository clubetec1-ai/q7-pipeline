import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getSecret, safeEqual } from "../_shared/secrets.ts";
import { esc, sendSystemEmail } from "../_shared/email.ts";
import { KIND_LABEL, renderSection } from "../_shared/report-format.ts";

/**
 * Relatórios por e-mail (cron diário 8h de Brasília, x-cron-secret). Semanal: os
 * últimos 7 dias, toda segunda. Mensal: o mês anterior, todo dia 1. Cada relatório
 * é calculado COMO a pessoa que recebe (mesmo escopo da tela) e vai só para o
 * e-mail dela. Cada envio é comparado com o período anterior de mesmo tamanho.
 */
const ok = (body: unknown = { ok: true }, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const TZ = "America/Sao_Paulo";
/** Meia-noite de Brasília do dia (y, m, d) — Brasília não tem horário de verão desde 2019 (UTC−3). */
const brMidnight = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d, 3));
const dateBR = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: TZ });

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const expected = await getSecret(admin, "platform:cron_secret");
  if (!expected || !safeEqual(req.headers.get("x-cron-secret") ?? "", expected)) return ok({ ok: false, error: "unauthorized" }, 401);

  const { data: due, error } = await admin.rpc("service_report_emails_due");
  if (error) { console.error("report-email:", error.message); return ok({ ok: false }, 500); }
  const { data: appUrl } = await admin.from("app_settings").select("value").eq("key", "app_url").maybeSingle();
  const base = appUrl?.value ? String(appUrl.value).replace(/\/$/, "") : "";

  const [y, m, d] = new Date().toLocaleDateString("en-CA", { timeZone: TZ }).split("-").map(Number);
  const today = brMidnight(y, m - 1, d);
  let sent = 0, skipped = 0;
  for (const r of (due ?? []) as { organization_id: string; user_id: string; frequency: string; kinds: string[]; email: string; org_name: string }[]) {
    const weekly = r.frequency === "weekly";
    const until = weekly ? today : brMidnight(y, m - 1, 1);
    const since = weekly ? new Date(today.getTime() - 7 * 86_400_000) : brMidnight(y, m - 2, 1);
    const prevSince = weekly ? new Date(since.getTime() - 7 * 86_400_000) : brMidnight(y, m - 3, 1);
    const at = (kind: string, a: Date, b: Date) =>
      admin.rpc("service_report_as", { org: r.organization_id, uid: r.user_id, kind, since: a.toISOString(), until: b.toISOString() })
        .then((x: { data: unknown }) => x.data as Record<string, unknown> | null);

    const parts: { html: string; text: string }[] = [];
    for (const kind of r.kinds) {
      const [cur, prev] = await Promise.all([at(kind, since, until), at(kind, prevSince, since)]);
      if (cur) parts.push(renderSection(kind, cur, prev));
    }
    if (!parts.length) { skipped++; continue; }

    const periodo = `${dateBR(since)} a ${dateBR(new Date(until.getTime() - 1))}`;
    const titulo = `Relatório ${weekly ? "da semana" : "do mês"} — ${r.org_name}`;
    const link = base ? `${base}/relatorios` : "";
    const res = await sendSystemEmail(admin, {
      to: r.email,
      subject: `[Deixa com a IA] ${titulo}`,
      text: `${titulo}\nPeríodo: ${periodo} (comparado com o período anterior)\n\n${parts.map((p) => p.text).join("\n\n")}\n\n` +
        `${link ? `Ver na tela: ${link}\n` : ""}Para parar de receber: Resultados → Relatórios → Receber por e-mail.\nDeixa com a IA`,
      html: `<div style="font-family:Arial,sans-serif;color:#0f172a;max-width:640px">` +
        `<h2 style="margin:0 0 4px;font-size:18px">${esc(titulo)}</h2>` +
        `<p style="margin:0;color:#64748b;font-size:13px">Período: ${esc(periodo)} · comparado com o período anterior · ${esc(r.kinds.map((k) => KIND_LABEL[k] ?? k).join(", "))}</p>` +
        parts.map((p) => p.html).join("") +
        `<p style="margin-top:20px">${link ? `<a href="${esc(link)}">Ver os relatórios completos</a>` : ""}</p>` +
        `<p style="color:#64748b;font-size:12px">Você recebe porque ligou "Receber por e-mail" em Resultados → Relatórios. Para parar, desligue lá.</p></div>`,
    });
    if (res.ok) sent++; else { skipped++; console.log("[report-email]", { org: r.organization_id, skipped: res.skipped, error: res.error }); }
  }
  return ok({ ok: true, sent, skipped });
});
