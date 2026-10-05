import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getSecret, safeEqual } from "../_shared/secrets.ts";
import { esc, sendSystemEmail } from "../_shared/email.ts";

/**
 * Alerta por e-mail a partir de uma notificação (pg_net + x-cron-secret).
 * Só tipos conhecidos; manda para o e-mail da própria pessoa notificada;
 * marca emailed_at para não repetir. Os do cérebro só chegam aqui quando a
 * empresa ligou "Receber o cérebro por e-mail" (filtro no gatilho do banco).
 */

function ok(body: unknown = { ok: true }, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const STATUS: Record<string, string> = { disconnected: "desconectado" };
const KINDS = ["number_health", "email_health", "security_alert", "brain_weekly", "brain_goal", "brain_reminder"];

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const expected = await getSecret(admin, "platform:cron_secret");
  if (!expected || !safeEqual(req.headers.get("x-cron-secret") ?? "", expected)) return ok({ ok: false, error: "unauthorized" }, 401);

  const { notification_id } = await req.json().catch(() => ({}));
  if (!/^[0-9a-f-]{36}$/i.test(String(notification_id ?? ""))) return ok({ ok: false }, 400);
  const { data: n } = await admin.from("notifications")
    .select("id, organization_id, user_id, kind, ref, emailed_at").eq("id", notification_id).maybeSingle();
  if (!n || n.emailed_at || !KINDS.includes(n.kind)) return ok({ ok: true, skipped: "nada a enviar" });

  const [{ data: p }, { data: o }, { data: appUrl }] = await Promise.all([
    admin.from("profiles").select("email").eq("user_id", n.user_id).maybeSingle(),
    admin.from("organizations").select("name").eq("id", n.organization_id).maybeSingle(),
    admin.from("app_settings").select("value").eq("key", "app_url").maybeSingle(),
  ]);
  const base = appUrl?.value ? String(appUrl.value).replace(/\/$/, "") : "";
  const r = (n.ref ?? {}) as Record<string, string>;
  let subject: string, text: string, html: string;

  if (n.kind.startsWith("brain_")) {
    const link = base ? `${base}/cerebro` : "";
    const empresa = o?.name ?? "";
    let titulo: string, corpo: string;
    if (n.kind === "brain_weekly") {
      // Resumo da análise (texto da IA, já anonimizado), só da própria empresa.
      const { data: run } = await admin.from("brain_runs").select("summary")
        .eq("id", String(r.run_id ?? "")).eq("organization_id", n.organization_id).maybeSingle();
      const s = (run?.summary ?? {}) as { resumo?: string; prioridades?: { titulo: string }[]; propostas?: number };
      titulo = "Cérebro: o resumo da semana está pronto";
      corpo = [s.resumo ?? "", ...(s.prioridades ?? []).map((x, i) => `${i + 1}. ${x.titulo}`),
        s.propostas ? `${s.propostas} sugestão(ões) esperando aprovação.` : ""].filter(Boolean).join("\n");
    } else if (n.kind === "brain_goal") {
      titulo = `Cérebro: meta fora do rumo — ${r.title ?? ""}`;
      corpo = `A meta "${r.title ?? ""}" está fora do rumo com os números desta semana.`;
    } else {
      titulo = `Cérebro: proposta parada — ${r.title ?? ""}`;
      corpo = `A proposta "${r.title ?? ""}" está parada há dias (${r.status === "aprovada" ? "aprovada, falta colocar no ar" : "esperando aprovação"}) e já foi cobrada do responsável.`;
    }
    subject = `[Deixa com a IA] ${titulo}`;
    text = `Olá!\n\n${empresa}\n\n${corpo}\n\n${link ? `Abrir o cérebro: ${link}` : "Veja em Resultados → Cérebro."}\n\nSugestões da IA — a decisão é sempre sua.\nDeixa com a IA`;
    html = `<p>Olá!</p><p><b>${esc(empresa)}</b></p><p>${esc(corpo).replace(/\n/g, "<br>")}</p>` +
      `<p>${link ? `<a href="${esc(link)}">Abrir o cérebro</a>` : "Veja em Resultados → Cérebro."}</p>` +
      `<p style="color:#64748b">Sugestões da IA — a decisão é sempre sua.</p><p>Deixa com a IA</p>`;
  } else {
    const security = n.kind === "security_alert";
    const what = security ? "Alerta de segurança:" : n.kind === "email_health" ? "A caixa de e-mail" : "O número";
    const page = security ? "Painel do supervisor" : n.kind === "email_health" ? "Números → E-mails" : "Números";
    const problem = security ? "tentou exportar os contatos sem permissão (bloqueado)"
      : r.error || STATUS[r.status] || "precisa de atenção";
    const link = base ? `${base}/${security ? "supervisor" : "numeros"}` : "";
    subject = `[Deixa com a IA] ${what} ${r.name ?? ""}: ${problem}`;
    text = `Olá!\n\n${what} "${r.name ?? ""}" da empresa ${o?.name ?? ""}: ${problem}\n` +
      `Veja os detalhes em ${page}${link ? `: ${link}` : " no sistema"}.\n\nDeixa com a IA`;
    html = `<p>Olá!</p><p>${what} <b>${esc(r.name)}</b> da empresa ${esc(o?.name)}: <b>${esc(problem)}</b>.</p>` +
      `<p>${link ? `<a href="${esc(link)}">Ver em ${esc(page)}</a>` : `Veja os detalhes em ${esc(page)} no sistema.`}</p><p>Deixa com a IA</p>`;
  }

  const res = await sendSystemEmail(admin, { to: String(p?.email ?? ""), subject, text, html });
  if (res.ok) await admin.from("notifications").update({ emailed_at: new Date().toISOString() }).eq("id", n.id);
  else console.log("[notify-email]", { id: n.id, skipped: res.skipped, error: res.error });
  return ok({ ok: res.ok, skipped: res.skipped });
});
