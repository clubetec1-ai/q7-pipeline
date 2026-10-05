import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getSecret, safeEqual } from "../_shared/secrets.ts";

/**
 * Avisos do Asaas da CLUBETEC sobre as assinaturas do Deixa com a IA. Só aceita com o
 * token que a gente cadastrou (cabeçalho asaas-access-token, comparação em tempo
 * constante). Cada aviso é processado uma vez (service_billing_event) e só mexe na
 * assinatura cujo id bate com o do pagamento.
 */
const ok = (body: unknown = { ok: true }, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const expected = await getSecret(admin, "platform:asaas_webhook_token");
  if (!expected || !safeEqual(req.headers.get("asaas-access-token") ?? "", expected)) return ok({ ok: false, error: "unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  const event = String(body?.event ?? "");
  const payment = body?.payment ?? {};
  const subId = String(payment?.subscription ?? body?.subscription?.id ?? "");
  if (!event || !/^[A-Za-z0-9_]{3,60}$/.test(subId)) return ok({ ok: true, ignored: true });
  const eventId = String(body?.id ?? `${event}:${payment?.id ?? subId}`).slice(0, 120);
  const due = /^\d{4}-\d{2}-\d{2}$/.test(String(payment?.dueDate ?? "")) ? String(payment.dueDate) : null;
  const { data, error } = await admin.rpc("service_billing_event", { event_id: eventId, sub: subId, ev: event, due });
  if (error) {
    console.error("[billing-webhook]", error.message);
    return ok({ ok: false }, 500); // Asaas tenta de novo
  }
  return ok({ ok: true, result: data });
});
