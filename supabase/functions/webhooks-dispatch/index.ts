import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getSecret, hmacSha256Hex, safeEqual } from "../_shared/secrets.ts";
import { checkPublicHost } from "../_shared/flow/http.ts";

/**
 * Envio dos webhooks (cron a cada minuto, x-cron-secret). Pega até 50 entregas da fila,
 * confere que o endereço continua público (contra SSRF por DNS), assina com o segredo do
 * endpoint (HMAC-SHA256 de "timestamp.corpo") e grava o resultado; erro volta para a fila
 * com espera crescente (até 6 tentativas). Não segue redirecionamento.
 */
const ok = (body: unknown = { ok: true }, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const expected = await getSecret(admin, "platform:cron_secret");
  if (!expected || !safeEqual(req.headers.get("x-cron-secret") ?? "", expected)) return ok({ ok: false, error: "unauthorized" }, 401);

  const { data: due } = await admin.rpc("service_webhook_claim", { lim: 50 });
  const started = Date.now();
  let sent = 0, failed = 0;
  for (const d of (due ?? []) as { id: number; endpoint_id: string; url: string; event: string; payload: unknown }[]) {
    if (Date.now() - started > 50_000) {
      await admin.rpc("service_webhook_result", { delivery: d.id, ok: false, code: null, err: "adiado (tempo)" });
      continue;
    }
    try {
      const u = new URL(d.url);
      const bad = u.protocol === "https:" ? await checkPublicHost(u.hostname) : "só https";
      if (bad) throw new Error(`endereço recusado: ${bad}`);
      const secret = await getSecret(admin, `webhook:${d.endpoint_id}:secret`);
      if (!secret) throw new Error("endpoint sem segredo");
      const body = JSON.stringify(d.payload);
      const ts = Math.floor(Date.now() / 1000).toString();
      const sig = await hmacSha256Hex(secret, `${ts}.${body}`);
      const r = await fetch(d.url, {
        method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json", "User-Agent": "DeixaComAIA-Webhook/1", "X-DCA-Event": d.event, "X-DCA-Timestamp": ts, "X-DCA-Signature": `sha256=${sig}` },
        body,
      });
      await r.body?.cancel();
      const good = r.status >= 200 && r.status < 300;
      await admin.rpc("service_webhook_result", { delivery: d.id, ok: good, code: r.status, err: good ? null : `HTTP ${r.status}` });
      good ? sent++ : failed++;
    } catch (e) {
      failed++;
      await admin.rpc("service_webhook_result", { delivery: d.id, ok: false, code: null, err: (e as Error).message?.slice(0, 200) || "falha" });
    }
  }
  return ok({ ok: true, sent, failed });
});
