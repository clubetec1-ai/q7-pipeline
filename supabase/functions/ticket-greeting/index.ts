import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { forOrg } from "../_shared/tenant.ts";
import { getSecret, safeEqual, withInstanceToken } from "../_shared/secrets.ts";
import * as providers from "../_shared/providers/index.ts";

/**
 * Avisa o cliente de quem assumiu o atendimento quando isso acontece sem o
 * botão "Assumir": distribuição automática ou transferência para uma pessoa.
 * Chamada só pelo banco (pg_net) com x-cron-secret. Texto da organização em
 * settings.claim_greeting ({nome}); vazio desliga.
 */

export const DEFAULT_GREETING = "Olá! Aqui é {nome}, vou continuar o seu atendimento. 😊";

function ok(body: unknown = { ok: true }, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const expected = await getSecret(admin, "platform:cron_secret");
  if (!expected || !safeEqual(req.headers.get("x-cron-secret") ?? "", expected)) {
    return ok({ ok: false, error: "unauthorized" }, 401);
  }
  try {
    const { ticket_id } = await req.json().catch(() => ({}));
    if (!/^[0-9a-f-]{36}$/i.test(String(ticket_id ?? ""))) return ok({ ok: false }, 400);

    const { data: t } = await admin.from("tickets")
      .select("id, organization_id, conversation_id, assigned_to, status").eq("id", ticket_id).maybeSingle();
    if (!t || t.status !== "open" || !t.assigned_to) return ok({ ok: true, skipped: "sem responsável" });
    const org = forOrg(admin, t.organization_id);

    const { data: o } = await admin.from("organizations").select("settings").eq("id", t.organization_id).maybeSingle();
    const template: string = o?.settings?.claim_greeting ?? DEFAULT_GREETING;
    if (!template.trim()) return ok({ ok: true, skipped: "aviso desligado" });

    const { data: p } = await admin.from("profiles").select("full_name, email").eq("user_id", t.assigned_to).maybeSingle();
    const first = String(p?.full_name || p?.email?.split("@")[0] || "").trim().split(/\s+/)[0] || "um atendente";
    const text = template.replaceAll("{nome}", first).slice(0, 1000);

    const { data: conv } = await org.select("conversations", "id, instance_id, contact_phone, last_inbound_at")
      .eq("id", t.conversation_id).maybeSingle();
    if (!conv) return ok({ ok: true, skipped: "conversa" });
    const { data: bare } = await org.select("whatsapp_instances").eq("id", conv.instance_id).maybeSingle();
    if (!bare || bare.status === "disabled") return ok({ ok: true, skipped: "numero" });
    const inst = await withInstanceToken(admin, bare);
    if (!providers.isWindowOpen(inst, conv.last_inbound_at)) return ok({ ok: true, skipped: "janela 24h" });

    const sent = await providers.sendText(inst, conv.contact_phone, text);
    await org.insert("messages", {
      conversation_id: conv.id,
      ticket_id: t.id,
      direction: "outbound",
      sender: "human",
      sent_by: t.assigned_to,
      content: text,
      status: sent.ok ? "sent" : "failed",
      provider_message_id: sent.messageId ?? null,
      error: sent.ok ? null : (sent.error ?? "falha").slice(0, 300),
    });
    return ok({ ok: sent.ok });
  } catch (e) {
    console.error("[ticket-greeting] erro", e instanceof Error ? e.message : e);
    return ok({ ok: false }, 500);
  }
});
