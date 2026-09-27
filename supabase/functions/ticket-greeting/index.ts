import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { forOrg } from "../_shared/tenant.ts";
import { getSecret, safeEqual, withInstanceToken } from "../_shared/secrets.ts";
import * as providers from "../_shared/providers/index.ts";

/**
 * Avisos automáticos ao cliente, disparados pelos eventos do atendimento
 * (pg_net, com x-cron-secret). Textos da organização em settings; vazio desliga:
 *  - created           → protocol_open_text      ({protocolo})
 *  - assigned/taken_over e transferência para pessoa (o "Assumir" de atendimento
 *    livre envia a saudação pela tela)
 *                      → claim_greeting          ({nome}) — padrão ligado
 *  - transferred       → protocol_transfer_text  ({protocolo}, {departamento})
 */

export const DEFAULT_GREETING = "Olá! Aqui é {nome}, vou continuar o seu atendimento. 😊";

function ok(body: unknown = { ok: true }, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const fill = (tpl: string, vars: Record<string, string>) =>
  Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), tpl).slice(0, 1000);

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const expected = await getSecret(admin, "platform:cron_secret");
  if (!expected || !safeEqual(req.headers.get("x-cron-secret") ?? "", expected)) {
    return ok({ ok: false, error: "unauthorized" }, 401);
  }
  try {
    const { ticket_id, event_id } = await req.json().catch(() => ({}));
    if (!/^[0-9a-f-]{36}$/i.test(String(ticket_id ?? ""))) return ok({ ok: false }, 400);

    const { data: t } = await admin.from("tickets")
      .select("id, organization_id, conversation_id, assigned_to, status, protocol, department_id, external_reply")
      .eq("id", ticket_id).maybeSingle();
    if (!t || t.status === "closed") return ok({ ok: true, skipped: "atendimento" });
    const org = forOrg(admin, t.organization_id);

    // Evento do mesmo atendimento (sem id = chamada antiga: só saudação).
    let ev: { type: string; meta: Record<string, string | null> } = { type: "assigned", meta: {} };
    if (event_id != null) {
      const { data } = await org.select("ticket_events", "type, meta")
        .eq("id", Number(event_id)).eq("ticket_id", t.id).maybeSingle();
      if (!data) return ok({ ok: true, skipped: "evento" });
      ev = data;
    }

    const { data: o } = await admin.from("organizations").select("settings").eq("id", t.organization_id).maybeSingle();
    const s = (o?.settings ?? {}) as Record<string, unknown>;
    const text = (k: string, fallback = "") => (typeof s[k] === "string" ? String(s[k]) : fallback);

    const texts: { body: string; human: boolean }[] = [];
    if (ev.type === "created") {
      if (!t.external_reply && text("protocol_open_text").trim()) {
        texts.push({ body: fill(text("protocol_open_text"), { protocolo: t.protocol }), human: false });
      }
    } else {
      const toPerson = ev.type !== "transferred" || !!ev.meta?.to_user;
      if (ev.type === "transferred" && text("protocol_transfer_text").trim()) {
        const { data: d } = t.department_id
          ? await org.select("departments", "name").eq("id", t.department_id).maybeSingle()
          : { data: null };
        texts.push({
          body: fill(text("protocol_transfer_text"), { protocolo: t.protocol, departamento: d?.name ?? "atendimento" }),
          human: false,
        });
      }
      const greeting = text("claim_greeting", DEFAULT_GREETING);
      if (toPerson && t.status === "open" && t.assigned_to && greeting.trim()) {
        // Nome da pessoa NESTA organização; reserva: início do e-mail.
        const [{ data: m }, { data: p }] = await Promise.all([
          org.select("organization_members", "display_name").eq("user_id", t.assigned_to).maybeSingle(),
          admin.from("profiles").select("email").eq("user_id", t.assigned_to).maybeSingle(),
        ]);
        const first = String(m?.display_name || p?.email?.split("@")[0] || "").trim().split(/\s+/)[0] || "um atendente";
        texts.push({ body: fill(greeting, { nome: first }), human: true });
      }
    }
    if (!texts.length) return ok({ ok: true, skipped: "aviso desligado" });

    const { data: conv } = await org.select("conversations", "id, instance_id, contact_phone, last_inbound_at")
      .eq("id", t.conversation_id).maybeSingle();
    if (!conv) return ok({ ok: true, skipped: "conversa" });
    if (!conv.instance_id) return ok({ ok: true, skipped: "canal sem aviso automático (e-mail)" });
    const { data: bare } = await org.select("whatsapp_instances").eq("id", conv.instance_id).maybeSingle();
    if (!bare || bare.status === "disabled") return ok({ ok: true, skipped: "numero" });
    const inst = await withInstanceToken(admin, bare);
    if (!providers.isWindowOpen(inst, conv.last_inbound_at)) return ok({ ok: true, skipped: "janela 24h" });

    for (const m of texts) {
      const sent = await providers.sendText(inst, conv.contact_phone, m.body);
      await org.insert("messages", {
        conversation_id: conv.id,
        ticket_id: t.id,
        direction: "outbound",
        sender: m.human ? "human" : "ai",
        sent_by: m.human ? t.assigned_to : null,
        content: m.body,
        status: sent.ok ? "sent" : "failed",
        provider_message_id: sent.messageId ?? null,
        error: sent.ok ? null : (sent.error ?? "falha").slice(0, 300),
      });
    }
    return ok({ ok: true, sent: texts.length });
  } catch (e) {
    console.error("[ticket-greeting] erro", e instanceof Error ? e.message : e);
    return ok({ ok: false }, 500);
  }
});
