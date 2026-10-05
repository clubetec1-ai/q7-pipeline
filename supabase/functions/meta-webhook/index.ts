import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getSecret, hmacSha256Hex, safeEqual } from "../_shared/secrets.ts";
import { forOrg } from "../_shared/tenant.ts";
import { moduleOn } from "../_shared/modules.ts";
import { metaProfileName, pageToken } from "../_shared/meta-messaging.ts";
import { replyMetaByAI } from "../_shared/meta-ai.ts";

/**
 * Webhook do Messenger e do Instagram Direct (app da Meta da Clubetec).
 *  * GET: verificação da Meta (hub.verify_token = app_settings.meta_verify_token).
 *  * POST: só com assinatura X-Hub-Signature-256 válida (App Secret no Vault); nunca
 *    aceita sem assinatura. Cada evento vai para a empresa dona da Página; mensagem
 *    repetida (mesmo mid) não entra duas vezes. Resposta enviada pela própria Página
 *    (eco) entra como mensagem da equipe e tira o atendimento da IA.
 */
const ok = (body: unknown = { ok: true }, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);
const ID = /^[0-9]{5,40}$/;

// deno-lint-ignore no-explicit-any
type Any = any;

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (req.method === "GET") {
    const url = new URL(req.url);
    const { data } = await admin.from("app_settings").select("value").eq("key", "meta_verify_token").maybeSingle();
    const expected = String(data?.value ?? "").trim();
    const token = url.searchParams.get("hub.verify_token") ?? "";
    const challenge = url.searchParams.get("hub.challenge") ?? "";
    if (url.searchParams.get("hub.mode") !== "subscribe" || !expected || !challenge || !safeEqual(token, expected)) {
      return new Response("forbidden", { status: 403 });
    }
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  if (req.method !== "POST") return ok({ ok: false }, 405);

  const raw = await req.text();
  const secret = await getSecret(admin, "platform:meta_app_secret");
  if (!secret) {
    console.error("[meta-webhook] App Secret da Meta não configurado; recusado");
    return ok({ ok: false, error: "unauthorized" }, 401);
  }
  const sig = req.headers.get("x-hub-signature-256") ?? "";
  if (!safeEqual(sig, "sha256=" + (await hmacSha256Hex(secret, raw)))) return ok({ ok: false, error: "unauthorized" }, 401);

  let body: Any;
  try { body = JSON.parse(raw); } catch { return ok({ ok: false }, 400); }
  const channel = body?.object === "page" ? "messenger" : body?.object === "instagram" ? "instagram" : null;
  if (!channel) return ok({ ok: true, ignored: true });

  let handled = 0;
  for (const entry of (Array.isArray(body.entry) ? body.entry : []).slice(0, 20)) {
    const entryId = String(entry?.id ?? "");
    if (!ID.test(entryId)) continue;
    const { data: page } = await admin.from("meta_pages").select("*")
      .eq(channel === "messenger" ? "page_id" : "ig_account_id", entryId).eq("status", "connected").maybeSingle();
    if (!page || !(channel === "messenger" ? page.messenger : page.instagram)) continue;
    if (!(await moduleOn(admin, page.organization_id, "canais"))) continue;
    for (const ev of (Array.isArray(entry.messaging) ? entry.messaging : []).slice(0, 50)) {
      try {
        if (await handleEvent(admin, page, channel, entryId, ev)) handled++;
      } catch (e) {
        console.error("[meta-webhook] evento falhou", e instanceof Error ? e.message.slice(0, 200) : e);
      }
    }
  }
  return ok({ ok: true, handled });
});

async function handleEvent(admin: Any, page: Any, channel: "messenger" | "instagram", entryId: string, ev: Any): Promise<boolean> {
  const msg = ev?.message;
  if (!msg?.mid) return false;
  const echo = !!msg.is_echo;
  // No eco, quem mandou foi a Página; a pessoa é o destinatário.
  const personId = String(echo ? ev?.recipient?.id : ev?.sender?.id ?? "");
  if (!ID.test(personId) || personId === entryId) return false;
  const org = forOrg(admin, page.organization_id);

  const seen = async () => !!(await org.select("messages", "id").eq("provider_message_id", clip(msg.mid, 200)).maybeSingle()).data;
  if (await seen()) return false;
  // Eco do que o próprio sistema mandou (IA ou equipe pela tela): quem enviou já grava a mensagem.
  // Pelo id do nosso app (app_settings.meta_app_id) ou, sem ele, esperando a gravação terminar.
  if (echo && msg.app_id) {
    const { data: appId } = await admin.from("app_settings").select("value").eq("key", "meta_app_id").maybeSingle();
    if (appId?.value && String(appId.value).trim() === String(msg.app_id)) return false;
    if (!appId?.value) {
      await new Promise((r) => setTimeout(r, 3000));
      if (await seen()) return false;
    }
  }

  const now = new Date().toISOString();
  const token = await pageToken(admin, page.id);
  let { data: conv } = await org.select("conversations", "id, meta_page_id, contact_external_id, contact_name")
    .eq("meta_page_id", page.id).eq("channel", channel).eq("contact_external_id", personId).maybeSingle();
  if (!conv) {
    const name = token ? await metaProfileName(token, personId, channel) : null;
    const { data: created, error } = await org.insert("conversations", {
      channel, meta_page_id: page.id, contact_external_id: personId, contact_name: name,
      ai_enabled: false, last_message_at: now, last_inbound_at: echo ? null : now, stage_id: null,
    }).select("id, meta_page_id, contact_external_id, contact_name").single();
    conv = created ?? (await org.select("conversations", "id, meta_page_id, contact_external_id, contact_name")
      .eq("meta_page_id", page.id).eq("channel", channel).eq("contact_external_id", personId).maybeSingle()).data;
    if (error && !conv) throw new Error(error.message);
  } else {
    await org.update("conversations", echo ? { last_message_at: now } : { last_message_at: now, last_inbound_at: now }).eq("id", conv.id);
  }

  const { data: ticket } = await admin.rpc("service_ticket_for_inbound", { conv: conv.id, from_me: echo });
  const att = Array.isArray(msg.attachments) ? msg.attachments[0] : null;
  const text = clip(msg.text, 4000) || (att ? `[anexo: ${clip(att.type, 20)}] (veja no ${channel === "instagram" ? "Instagram" : "Messenger"})` : "(mensagem sem texto)");
  await org.insert("messages", {
    conversation_id: conv.id, ticket_id: ticket?.id ?? null,
    direction: echo ? "outbound" : "inbound", sender: echo ? "human" : "contact",
    content: text, status: echo ? "sent" : null, provider_message_id: clip(msg.mid, 200),
  });

  if (!echo && ticket?.status === "bot" && msg.text) {
    await replyMetaByAI({ admin, orgId: page.organization_id, conv, ticket, text: clip(msg.text, 4000) })
      .catch((e) => console.error("[meta-webhook] IA falhou", e instanceof Error ? e.message.slice(0, 200) : e));
  }
  return true;
}
