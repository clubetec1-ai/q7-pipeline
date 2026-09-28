import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { forOrg } from "../_shared/tenant.ts";
import { getSecret, safeEqual } from "../_shared/secrets.ts";
import { brl, mapStatus } from "../_shared/asaas.ts";
import { sendToConversation } from "../_shared/send-conv.ts";

/**
 * Aviso de pagamento do Asaas: /payments-webhook?org=<organização>. Só aceita
 * com o token cadastrado por nós no Asaas (cabeçalho asaas-access-token),
 * guardado no Vault daquela organização. Atualiza a cobrança da MESMA
 * organização e, se pago, agradece ao cliente e avisa quem cobrou.
 */

const ok = (body: unknown = { ok: true }, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const orgId = new URL(req.url).searchParams.get("org") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) return ok({ ok: false }, 400);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const expected = await getSecret(admin, `org:${orgId}:asaas_webhook_token`);
  if (!expected || !safeEqual(req.headers.get("asaas-access-token") ?? "", expected)) return ok({ ok: false, error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const payment = body?.payment ?? {};
  if (!payment?.id) return ok({ ok: true, skipped: "sem cobrança" });
  const org = forOrg(admin, orgId);
  const { data: ch } = await org.select("charges").eq("provider_id", String(payment.id)).maybeSingle();
  if (!ch) return ok({ ok: true, skipped: "cobrança de fora do CRM" });

  const status = body?.event === "PAYMENT_DELETED" ? "canceled" : mapStatus(String(payment.status ?? ""));
  if (status === ch.status) return ok({ ok: true, skipped: "sem mudança" });
  await org.update("charges", { status, ...(status === "paid" ? { paid_at: new Date().toISOString() } : {}) }).eq("id", ch.id);

  if (status === "paid") {
    const { data: o } = await admin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
    if (o?.settings?.payments?.notify_paid !== false && ch.conversation_id) {
      await sendToConversation(admin, orgId, ch.conversation_id,
        `Pagamento de ${brl(Number(ch.value))} recebido. Obrigado! ✅`, { respectOptOut: false });
    }
    if (ch.created_by) {
      await org.insert("notifications", {
        user_id: ch.created_by, kind: "charge_paid",
        ref: { conversation_id: ch.conversation_id, charge_id: ch.id, value: String(ch.value) },
      });
    }
  }
  return ok({ ok: true, status });
});
