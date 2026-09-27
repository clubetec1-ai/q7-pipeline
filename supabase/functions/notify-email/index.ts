import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getSecret, safeEqual } from "../_shared/secrets.ts";
import { esc, sendSystemEmail } from "../_shared/email.ts";

/**
 * Alerta por e-mail a partir de uma notificação (pg_net + x-cron-secret).
 * Só tipos conhecidos; manda para o e-mail da própria pessoa notificada;
 * marca emailed_at para não repetir.
 */

function ok(body: unknown = { ok: true }, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const STATUS: Record<string, string> = { disconnected: "desconectado" };

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const expected = await getSecret(admin, "platform:cron_secret");
  if (!expected || !safeEqual(req.headers.get("x-cron-secret") ?? "", expected)) return ok({ ok: false, error: "unauthorized" }, 401);

  const { notification_id } = await req.json().catch(() => ({}));
  if (!/^[0-9a-f-]{36}$/i.test(String(notification_id ?? ""))) return ok({ ok: false }, 400);
  const { data: n } = await admin.from("notifications")
    .select("id, organization_id, user_id, kind, ref, emailed_at").eq("id", notification_id).maybeSingle();
  if (!n || n.emailed_at || n.kind !== "number_health") return ok({ ok: true, skipped: "nada a enviar" });

  const [{ data: p }, { data: o }, { data: appUrl }] = await Promise.all([
    admin.from("profiles").select("email").eq("user_id", n.user_id).maybeSingle(),
    admin.from("organizations").select("name").eq("id", n.organization_id).maybeSingle(),
    admin.from("app_settings").select("value").eq("key", "app_url").maybeSingle(),
  ]);
  const r = (n.ref ?? {}) as Record<string, string>;
  const problem = r.error || STATUS[r.status] || "precisa de atenção";
  const link = appUrl?.value ? `${String(appUrl.value).replace(/\/$/, "")}/numeros` : "";
  const subject = `[ClubeCRM] Número ${r.name ?? ""}: ${problem}`;
  const text = `Olá!\n\nO número "${r.name ?? ""}" da empresa ${o?.name ?? ""} ${problem.toLowerCase()}.\n` +
    `Veja os detalhes na tela Números${link ? `: ${link}` : " do ClubeCRM"}.\n\nClubeCRM`;
  const html = `<p>Olá!</p><p>O número <b>${esc(r.name)}</b> da empresa ${esc(o?.name)}: <b>${esc(problem)}</b>.</p>` +
    `<p>${link ? `<a href="${esc(link)}">Ver na tela Números</a>` : "Veja os detalhes na tela Números do ClubeCRM."}</p><p>ClubeCRM</p>`;

  const res = await sendSystemEmail(admin, { to: String(p?.email ?? ""), subject, text, html });
  if (res.ok) await admin.from("notifications").update({ emailed_at: new Date().toISOString() }).eq("id", n.id);
  else console.log("[notify-email]", { id: n.id, skipped: res.skipped, error: res.error });
  return ok({ ok: res.ok, skipped: res.skipped });
});
