import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getSecret, safeEqual } from "../_shared/secrets.ts";
import { forOrg } from "../_shared/tenant.ts";
import { brDate, historyItems, normalizeCall, NvoipError, nvoipFetch, nvoipToken } from "../_shared/nvoip.ts";

/**
 * Histórico de ligações da Nvoip → tabela calls (cron a cada 5 min, x-cron-secret).
 * Por empresa com integração ativa: hoje (e ontem, na primeira hora do dia).
 * Idempotente pelo id da ligação na central; perdida vira aviso (no banco).
 */
const ok = (body: unknown = { ok: true }, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const secret = await getSecret(admin, "platform:cron_secret");
  if (!secret || !safeEqual(req.headers.get("x-cron-secret") ?? "", secret)) return ok({ ok: false, error: "unauthorized" }, 401);

  const { data: list } = await admin.from("voice_integrations").select("organization_id")
    .eq("enabled", true).eq("has_credentials", true).eq("provider", "nvoip").limit(50);
  const hourBr = (new Date().getUTCHours() + 21) % 24;
  let saved = 0;
  for (const v of list ?? []) {
    const orgId: string = v.organization_id;
    const org = forOrg(admin, orgId);
    try {
      const token = await nvoipToken(admin, orgId);
      const { data: exts } = await org.select("pbx_extensions", "number, sip_user");
      const extNumbers = new Set<string>((exts ?? []).flatMap((e: { number: string; sip_user: string }) => [e.number, e.sip_user.replace(/\D/g, "")]));
      const days = hourBr < 1 ? [brDate(1), brDate(0)] : [brDate(0)];
      for (const day of days) {
        const body = await nvoipFetch(token, `/calls/history?date=${day}&type=all`);
        for (const it of historyItems(body)) {
          const c = normalizeCall(it, extNumbers);
          if (!c) continue;
          const { error } = await admin.rpc("service_upsert_call", {
            org: orgId, p_provider_call_id: `nvoip:${c.id}`, p_direction: c.direction, p_phone: c.phone, p_ext_number: c.ext,
            p_status: c.status, p_started_at: c.started_at, p_answered_at: c.answered_at, p_ended_at: c.ended_at,
            p_duration: c.duration, p_recording_url: c.recording,
          });
          if (!error) saved++;
        }
      }
      await admin.from("voice_integrations").update({ last_sync_at: new Date().toISOString(), last_error: null }).eq("organization_id", orgId);
    } catch (e) {
      const msg = e instanceof NvoipError ? e.message : "Falha ao sincronizar";
      if (!(e instanceof NvoipError)) console.error("calls-sync:", e);
      await admin.from("voice_integrations").update({ last_error: msg.slice(0, 200) }).eq("organization_id", orgId);
    }
  }
  return ok({ ok: true, saved });
});
