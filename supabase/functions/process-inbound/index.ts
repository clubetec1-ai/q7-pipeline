import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getSecret, safeEqual } from "../_shared/secrets.ts";

/**
 * Reprocessa mensagens recebidas que falharam, ficaram presas ou esperaram o
 * limite de IA (fila inbound_events). Chamado pelo cron (process_inbound_tick,
 * pg_net + x-cron-secret). Cada evento é reivindicado com FOR UPDATE SKIP LOCKED
 * e reenviado ao whatsapp-webhook, que usa a MESMA lógica e não grava a
 * mensagem duas vezes (stage 'stored').
 */

const BATCH = 20;

function ok(body: unknown = { ok: true }, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const secret = await getSecret(admin, "platform:cron_secret");
  if (!secret || !safeEqual(req.headers.get("x-cron-secret") ?? "", secret)) return ok({ ok: false, error: "unauthorized" }, 401);

  const { data: base } = await admin.from("app_settings").select("value").eq("key", "functions_base_url").maybeSingle();
  if (!base?.value) return ok({ ok: false, error: "functions_base_url ausente" }, 500);
  const { data: events, error } = await admin.rpc("claim_inbound_events", { max_rows: BATCH });
  if (error) return ok({ ok: false, error: error.message }, 500);

  let done = 0;
  for (const ev of events ?? []) {
    try {
      const res = await fetch(`${String(base.value).replace(/\/$/, "")}/whatsapp-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cron-secret": secret, "x-replay-event": ev.id },
        body: JSON.stringify(ev.payload ?? {}),
        signal: AbortSignal.timeout(60_000),
      });
      await res.body?.cancel();
      done++;
    } catch (e) {
      // Continua 'processing'; o próximo ciclo reivindica de novo após 5 min.
      console.error("[process-inbound] falhou", { event: ev.id, message: e instanceof Error ? e.message.slice(0, 120) : String(e) });
    }
  }
  return ok({ ok: true, claimed: events?.length ?? 0, done });
});
