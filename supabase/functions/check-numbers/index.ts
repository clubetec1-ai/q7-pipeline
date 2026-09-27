import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { forOrg } from "../_shared/tenant.ts";
import { getSecret, safeEqual } from "../_shared/secrets.ts";
import { GRAPH_VERSION } from "../_shared/providers/cloud.ts";
import { instForSend } from "../_shared/flow/executor.ts";

/**
 * Saúde dos números (spec números §9). Chamado pelo cron a cada 15 min
 * (private.check_numbers_tick, pg_net + x-cron-secret). Grava o resultado em
 * whatsapp_instances; o gatilho notify_number_health avisa owner/admin quando
 * piora — uma vez por mudança de estado.
 */

type Health = { health_status: "ok" | "warning" | "critical"; health_error: string | null; [k: string]: unknown };

function ok(body: unknown = { ok: true }, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const BAD_STATUS = /FLAGGED|RESTRICTED|BANNED|BLOCKED|DISCONNECTED|DELETED|UNVERIFIED/i;

// deno-lint-ignore no-explicit-any
async function checkCloud(inst: any): Promise<Health> {
  if (!inst.phone_number_id || !inst.instance_token) return { health_status: "critical", health_error: "Número sem token da Meta" };
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${inst.phone_number_id}?fields=quality_rating,messaging_limit_tier,status,name_status`,
      { headers: { Authorization: `Bearer ${inst.instance_token}` }, signal: AbortSignal.timeout(10_000) },
    );
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || data?.error?.code === 190) return { health_status: "critical", health_error: "Token da Meta inválido ou expirado" };
    if (!res.ok) return { health_status: "warning", health_error: `A Meta respondeu HTTP ${res.status}` };
    const base = { quality_rating: data.quality_rating ?? null, messaging_limit_tier: data.messaging_limit_tier ?? null };
    if (BAD_STATUS.test(String(data.status ?? ""))) return { ...base, health_status: "critical", health_error: `Número ${String(data.status).toLowerCase()} pela Meta` };
    if (data.quality_rating === "RED") return { ...base, health_status: "critical", health_error: "Qualidade baixa: risco de bloqueio" };
    if (data.quality_rating === "YELLOW") return { ...base, health_status: "warning", health_error: "Qualidade média: reveja as mensagens enviadas" };
    if (data.name_status === "DECLINED") return { ...base, health_status: "warning", health_error: "Nome de exibição recusado pela Meta" };
    return { ...base, health_status: "ok", health_error: null };
  } catch {
    return { health_status: "warning", health_error: "Não consegui falar com a Meta" };
  }
}

// deno-lint-ignore no-explicit-any
async function checkUazapi(inst: any): Promise<Health> {
  if (!inst.server_url || !inst.instance_token) return { health_status: "critical", health_error: "Número sem configuração da Uazapi" };
  try {
    const res = await fetch(`${String(inst.server_url).replace(/\/$/, "")}/instance/status`, {
      headers: { token: inst.instance_token }, signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401) return { health_status: "critical", health_error: "Token da Uazapi inválido" };
    if (!res.ok) return { health_status: "warning", health_error: `A Uazapi respondeu HTTP ${res.status}` };
    const data = await res.json().catch(() => ({}));
    const s = data?.status;
    const connected = (typeof s === "object" && s?.connected === true) ||
      ["open", "connected"].includes(String(typeof s === "string" ? s : data?.instance?.status ?? "").toLowerCase()) ||
      data?.loggedIn === true || data?.instance?.loggedIn === true;
    return connected
      ? { status: "connected", health_status: "ok", health_error: null }
      : { status: "disconnected", health_status: "critical", health_error: "Número desconectado: leia o QR Code de novo" };
  } catch {
    return { health_status: "warning", health_error: "Não consegui falar com a Uazapi" };
  }
}

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const expected = await getSecret(admin, "platform:cron_secret");
  if (!expected || !safeEqual(req.headers.get("x-cron-secret") ?? "", expected)) {
    return ok({ ok: false, error: "unauthorized" }, 401);
  }
  const { data: rows, error } = await admin.from("whatsapp_instances")
    .select("id, organization_id, provider, status, phone_number_id, server_url, health_status, health_error")
    .neq("status", "disabled").limit(500);
  if (error) return ok({ ok: false, error: error.message }, 500);

  let checked = 0;
  for (const row of rows ?? []) {
    try {
      const inst = await instForSend(admin, row);
      const h = row.provider === "cloud" ? await checkCloud(inst) : await checkUazapi(inst);
      const patch: Record<string, unknown> = { ...h, last_health_check_at: new Date().toISOString() };
      if (patch.status === row.status) delete patch.status; // só grava status quando muda
      await forOrg(admin, row.organization_id).update("whatsapp_instances", patch).eq("id", row.id);
      checked++;
    } catch (e) {
      console.error("[check-numbers] falhou", { id: row.id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return ok({ ok: true, checked });
});
