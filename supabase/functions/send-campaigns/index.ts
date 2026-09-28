import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getSecret, safeEqual } from "../_shared/secrets.ts";
import { forOrg } from "../_shared/tenant.ts";
import * as providers from "../_shared/providers/index.ts";
import { instForSend } from "../_shared/flow/executor.ts";

/**
 * Disparos (cron a cada minuto, x-cron-secret). Para cada campanha em andamento,
 * dentro da janela de horário, envia até rate_per_min destinatários, com uma
 * pausa entre envios. Cada destinatário é reservado antes (sent_at) para duas
 * execuções nunca mandarem a mesma mensagem. Opt-out é conferido de novo na hora.
 * A mensagem fica na conversa do contato (resposta cai no atendimento normal).
 */

const ok = (body: unknown = { ok: true }, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const firstName = (n?: string | null) => String(n ?? "").trim().split(/\s+/)[0] ?? "";

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const secret = await getSecret(admin, "platform:cron_secret");
  if (!secret || !safeEqual(req.headers.get("x-cron-secret") ?? "", secret)) return ok({ ok: false, error: "unauthorized" }, 401);

  const hourBr = (new Date().getUTCHours() + 21) % 24; // Brasília (UTC-3)
  const { data: running } = await admin.from("campaigns")
    .select("*, organizations!inner(status)").eq("status", "running").eq("organizations.status", "active")
    .or(`scheduled_at.is.null,scheduled_at.lte.${new Date().toISOString()}`).limit(10);

  let sent = 0;
  const started = Date.now();
  for (const c of running ?? []) {
    if (hourBr < c.window_start || hourBr >= c.window_end) continue;
    const org = forOrg(admin, c.organization_id);
    const { data: bare } = await org.select("whatsapp_instances").eq("id", c.instance_id).maybeSingle();
    if (!bare || bare.status === "disabled") {
      await org.update("campaigns", { status: "paused" }).eq("id", c.id);
      continue;
    }
    const inst = await instForSend(admin, bare);
    const isCloud = providers.providerOf(inst) === "cloud";

    // Reserva o lote deste minuto.
    const { data: batch } = await org.select("campaign_recipients", "id").eq("campaign_id", c.id)
      .eq("status", "pending").is("sent_at", null).order("id").limit(c.rate_per_min);
    const ids = (batch ?? []).map((r: { id: number }) => r.id);
    const { data: claimed } = ids.length
      ? await org.update("campaign_recipients", { sent_at: new Date().toISOString() }).in("id", ids).is("sent_at", null)
        .select("id, contact_id, phone, name")
      : { data: [] };

    const gap = Math.min(2500, Math.floor(45_000 / Math.max(1, c.rate_per_min)));
    let okN = 0, failN = 0, skipN = 0;
    for (const r of claimed ?? []) {
      if (Date.now() - started > 110_000) { // não passa do tempo da função; o resto volta para a fila
        await org.update("campaign_recipients", { sent_at: null }).eq("id", r.id).eq("status", "pending");
        continue;
      }
      const { data: ct } = await org.select("contacts", "opted_out_at, anonymized_at").eq("id", r.contact_id).maybeSingle();
      if (!ct || ct.opted_out_at || ct.anonymized_at) {
        await org.update("campaign_recipients", { status: "skipped", error: "pediu para não receber" }).eq("id", r.id);
        skipN++;
        continue;
      }
      const nome = firstName(r.name);
      const text = String(c.message ?? "").replaceAll("{nome}", nome).replace(/\s+([,!.?])/g, "$1").trim();
      const res = isCloud
        ? await providers.sendTemplate(inst, r.phone, {
            name: c.template_name, language: c.template_lang,
            ...(String(c.message ?? "").includes("{{1}}") ? { bodyParams: [nome || "cliente"] } : {}),
          })
        : await providers.sendText(inst, r.phone, text);

      // Conversa do contato neste número (cria se não houver) + mensagem no histórico.
      let { data: conv } = await org.select("conversations", "id").eq("instance_id", inst.id).eq("contact_phone", r.phone).maybeSingle();
      if (!conv) {
        ({ data: conv } = await org.insert("conversations", {
          instance_id: inst.id, contact_phone: r.phone, contact_name: r.name, ai_enabled: true,
          last_message_at: new Date().toISOString(),
        }).select("id").single());
      }
      if (conv) {
        await org.insert("messages", {
          conversation_id: conv.id, direction: "outbound", sender: "human", sent_by: c.created_by,
          content: isCloud ? `[Campanha: ${c.name}] modelo ${c.template_name}` : text,
          status: res.ok ? "sent" : "failed", provider_message_id: res.messageId ?? null,
          error: res.ok ? null : String(res.error ?? "falha").slice(0, 300),
        });
      }
      await org.update("campaign_recipients", res.ok
        ? { status: "sent", error: null }
        : { status: "failed", error: String(res.error ?? "falha").slice(0, 300) }).eq("id", r.id);
      if (res.ok) { okN++; sent++; } else failN++;
      await sleep(gap + Math.floor(Math.random() * 800));
    }

    // Contadores sempre recontados dos destinatários (não se perdem se pausar no meio).
    const count = async (status: string) => (await admin.from("campaign_recipients").select("id", { count: "exact", head: true })
      .eq("organization_id", c.organization_id).eq("campaign_id", c.id).eq("status", status)).count ?? 0;
    const [done, failed, skipped, left] = await Promise.all([count("sent"), count("failed"), count("skipped"), count("pending")]);
    await org.update("campaigns", { sent: done, failed, skipped }).eq("id", c.id);
    if (left === 0) await org.update("campaigns", { status: "done", finished_at: new Date().toISOString() }).eq("id", c.id).eq("status", "running");
    console.log("[send-campaigns]", { campaign: c.id, ok: okN, fail: failN, skip: skipN, left });
  }
  return ok({ ok: true, sent });
});
