import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getSecret, safeEqual } from "../_shared/secrets.ts";
import { brDate, brl } from "../_shared/asaas.ts";
import { forOrg } from "../_shared/tenant.ts";
import { sendToConversation } from "../_shared/send-conv.ts";

/**
 * Lembretes de cobrança (cron diário, x-cron-secret): um dia antes do
 * vencimento e um dia depois (se ainda em aberto). Uma vez cada; respeita o
 * opt-out do contato e a chave "lembretes" da empresa.
 */

const ok = (body: unknown = { ok: true }, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const day = (offset: number) => new Date(Date.now() - 3 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10); // Brasília

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const secret = await getSecret(admin, "platform:cron_secret");
  if (!secret || !safeEqual(req.headers.get("x-cron-secret") ?? "", secret)) return ok({ ok: false, error: "unauthorized" }, 401);

  const [{ data: before }, { data: after }] = await Promise.all([
    admin.from("charges").select("id, organization_id, conversation_id, value, due_date, invoice_url, organizations!inner(status, settings)")
      .eq("status", "pending").eq("due_date", day(1)).eq("reminded_before", false).eq("organizations.status", "active").limit(200),
    admin.from("charges").select("id, organization_id, conversation_id, value, due_date, invoice_url, organizations!inner(status, settings)")
      .in("status", ["pending", "overdue"]).lte("due_date", day(-1)).gte("due_date", day(-7)).eq("reminded_after", false)
      .eq("organizations.status", "active").limit(200),
  ]);

  let sent = 0;
  const run = async (list: any[] | null, flag: "reminded_before" | "reminded_after") => {
    for (const c of list ?? []) {
      await forOrg(admin, c.organization_id).update("charges", { [flag]: true }).eq("id", c.id);
      if (c.organizations?.settings?.payments?.reminders === false || !c.conversation_id) continue;
      const text = flag === "reminded_before"
        ? `Lembrete: a cobrança de ${brl(Number(c.value))} vence amanhã (${brDate(c.due_date)}).${c.invoice_url ? `\nPagar: ${c.invoice_url}` : ""}`
        : `Oi! A cobrança de ${brl(Number(c.value))} venceu em ${brDate(c.due_date)} e ainda consta em aberto.${c.invoice_url ? `\nPagar: ${c.invoice_url}` : ""}\nSe já pagou, desconsidere.`;
      if (await sendToConversation(admin, c.organization_id, c.conversation_id, text, { respectOptOut: true })) sent++;
    }
  };
  await run(before, "reminded_before");
  await run(after, "reminded_after");
  return ok({ ok: true, sent });
});
