import { pageToken, sendMetaText } from "../_shared/meta-messaging.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { HttpError, permissionsIn, requireUser } from "../_shared/auth.ts";
import { forOrg } from "../_shared/tenant.ts";
import { withInstanceToken } from "../_shared/secrets.ts";
import { LIMITS, isDangerous, sniffMime, typeOf } from "../_shared/media.ts";
import * as providers from "../_shared/providers/index.ts";
import { loadLibraryFile, SENDABLE } from "../_shared/library.ts";
import { sendEmailMessage } from "../_shared/mail-send.ts";

/**
 * Envio a partir da tela (texto e arquivo) — spec atendimento §6.3.
 *
 * 1. A conversa tem de ser visível ao usuário (lida com o JWT dele: RLS).
 * 2. Atendimento livre é assumido; de outra pessoa, só com reassign.
 * 3. Arquivo: caminho da própria conversa, tipo real pelos bytes, limites do
 *    WhatsApp; executáveis e scripts recusados.
 * 4. Janela de 24h da Meta.
 * 5. Grava a mensagem com status e id do provedor.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const conversationId = String(body?.conversation_id ?? "");
    const text = String(body?.text ?? "").trim();
    const mediaPath: string | null = body?.media_path ? String(body.media_path) : null;
    const mediaName = String(body?.media_name ?? "arquivo").slice(0, 200);
    const libraryId: string | null = body?.library_file_id ? String(body.library_file_id) : null;
    if (!/^[0-9a-f-]{36}$/i.test(conversationId)) throw new HttpError(400, "Conversa inválida");
    if (libraryId && !/^[0-9a-f-]{36}$/i.test(libraryId)) throw new HttpError(400, "Arquivo inválido");
    if (!text && !mediaPath && !libraryId) throw new HttpError(400, "Nada para enviar");
    if (text.length > 4096) throw new HttpError(400, "Mensagem longa demais (máx. 4096 caracteres)");

    const ctx = await requireUser(req);
    const { data: conv } = await ctx.userClient
      .from("conversations")
      .select("id, organization_id, channel, instance_id, email_account_id, meta_page_id, contact_external_id, contact_phone, contact_email, last_inbound_at")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conv) throw new HttpError(404, "Conversa não encontrada");
    const orgId: string = conv.organization_id;
    const perms = await permissionsIn(ctx, orgId);
    if (!perms.includes("conversations.attend")) throw new HttpError(403, "Sem permissão para atender");

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const org = forOrg(admin, orgId);

    // Atendimento: assume se livre. Com outra pessoa, ninguém responde (nem o
    // admin) sem antes usar "Assumir", que registra e avisa quem perdeu.
    const { data: ticket } = await org
      .select("tickets", "id, assigned_to")
      .eq("conversation_id", conv.id)
      .neq("status", "closed")
      .maybeSingle();
    let ticketId: string | null = ticket?.id ?? null;
    if (ticket && ticket.assigned_to !== ctx.user.id) {
      if (!ticket.assigned_to) {
        const { error } = await ctx.userClient.rpc("claim_ticket", { ticket: ticket.id });
        if (error) throw new HttpError(409, error.message);
      } else {
        throw new HttpError(409, "Este atendimento está com outra pessoa. Clique em Assumir para responder.");
      }
    }

    let sent: providers.SendResult;
    let fields: Record<string, unknown> = { type: "text" };
    if (conv.channel === "email") {
      // E-mail: mesma permissão e regra de assumir; sem janela de 24 h.
      ({ sent, fields } = await sendEmailMessage({ admin, orgId, conv, ticketId, text, mediaPath, mediaName, libraryId }));
    } else if (conv.channel === "messenger" || conv.channel === "instagram") {
      // Messenger/Instagram: só texto por enquanto; a Meta só deixa responder até 24 h depois da última mensagem da pessoa.
      if (mediaPath || libraryId) throw new HttpError(400, "Pelo Messenger/Instagram, por enquanto só texto.");
      if (!conv.last_inbound_at || Date.now() - Date.parse(conv.last_inbound_at) > 24 * 3600_000) {
        throw new HttpError(409, "Janela de 24h fechada: a Meta só deixa responder até 24 h depois da última mensagem da pessoa.");
      }
      const token = await pageToken(admin, conv.meta_page_id);
      if (!token) throw new HttpError(409, "A Página está desconectada. Conecte de novo em Números.");
      const r = await sendMetaText(token, conv.contact_external_id, text);
      sent = { ok: r.ok, messageId: r.messageId, error: r.error } as providers.SendResult;
    } else {
    const { data: bare } = await org.select("whatsapp_instances").eq("id", conv.instance_id).maybeSingle();
    if (!bare) throw new HttpError(404, "Número da conversa não encontrado");
    if (bare.status === "disabled") throw new HttpError(409, "Este número está desativado.");
    const inst = await withInstanceToken(admin, bare);
    if (!providers.isWindowOpen(inst, conv.last_inbound_at)) {
      throw new HttpError(409, "Janela de 24h fechada: só modelo aprovado pela Meta.");
    }

    if (libraryId) {
      // Arquivo da biblioteca: buscado pela organização da conversa (nunca de outra).
      const f = await loadLibraryFile(admin, orgId, libraryId).catch((e) => { throw new HttpError(400, e.message); });
      sent = await providers.sendMedia(inst, conv.contact_phone, { type: f.type, bytes: f.bytes, mime: f.mime, name: f.name, caption: text || undefined });
      fields = { type: f.type, media_path: f.path, media_mime: f.mime, media_size: f.bytes.length, media_name: f.name };
    } else if (mediaPath) {
      if (!mediaPath.startsWith(`${orgId}/${conv.id}/`)) throw new HttpError(400, "Arquivo de outra conversa");
      if (isDangerous(mediaName)) throw new HttpError(400, "Tipo de arquivo não permitido");
      const { data: blob, error } = await admin.storage.from("media").download(mediaPath);
      if (error || !blob) throw new HttpError(404, "Arquivo não encontrado");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const mime = sniffMime(bytes, mediaName);
      if (!SENDABLE.test(mime)) throw new HttpError(400, "Tipo de arquivo não aceito pelo WhatsApp");
      const type = typeOf(mime);
      if (bytes.length > LIMITS[type]) {
        throw new HttpError(400, `Arquivo grande demais para ${type === "image" ? "imagem (máx. 5 MB)" : type === "document" ? "documento (máx. 100 MB)" : "áudio/vídeo (máx. 16 MB)"}`);
      }
      sent = await providers.sendMedia(inst, conv.contact_phone, { type, bytes, mime, name: mediaName, caption: text || undefined });
      fields = { type, media_path: mediaPath, media_mime: mime, media_size: bytes.length, media_name: mediaName };
    } else {
      sent = await providers.sendText(inst, conv.contact_phone, text);
    }
    }

    await org.insert("messages", {
      conversation_id: conv.id,
      ticket_id: ticketId,
      direction: "outbound",
      sender: "human",
      sent_by: ctx.user.id,
      user_id: ctx.user.id,
      content: text || (fields.type === "text" ? "" : `[${fields.type}]`),
      status: sent.ok ? "sent" : "failed",
      provider_message_id: sent.messageId ?? null,
      error: sent.ok ? null : (sent.error ?? "falha no envio").slice(0, 300),
      ...fields,
    });
    await org.update("conversations", { last_message_at: new Date().toISOString() }).eq("id", conv.id);
    // Primeira resposta humana do atendimento (métrica do painel do supervisor).
    if (sent.ok && ticketId) {
      await org.update("tickets", { first_response_at: new Date().toISOString() })
        .eq("id", ticketId).is("first_response_at", null);
    }

    if (!sent.ok) {
      console.error("[send-message] falhou", { code: sent.code });
      return json({ ok: false, error: sent.error || "Falha ao enviar" }, 502);
    }
    return json({ ok: true });
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    console.error("[send-message] erro", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Erro interno" }, 500);
  }
});
