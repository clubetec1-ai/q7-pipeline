/**
 * Mensagem automática para uma conversa de WhatsApp (lembrete, aviso de
 * pagamento). Respeita opt-out quando pedido e grava a mensagem. Conversa de
 * e-mail é ignorada aqui (o aviso por e-mail entra depois).
 */
import { forOrg } from "./tenant.ts";
import * as providers from "./providers/index.ts";
import { instForSend } from "./flow/executor.ts";

// deno-lint-ignore no-explicit-any
export async function sendToConversation(admin: any, orgId: string, conversationId: string, text: string, opts: { respectOptOut: boolean }): Promise<boolean> {
  const org = forOrg(admin, orgId);
  const { data: conv } = await org.select("conversations", "id, channel, instance_id, contact_id, contact_phone").eq("id", conversationId).maybeSingle();
  if (!conv || conv.channel === "email" || !conv.instance_id) return false;
  if (opts.respectOptOut && conv.contact_id) {
    const { data: ct } = await org.select("contacts", "opted_out_at").eq("id", conv.contact_id).maybeSingle();
    if (ct?.opted_out_at) return false;
  }
  const { data: bare } = await org.select("whatsapp_instances").eq("id", conv.instance_id).maybeSingle();
  if (!bare || bare.status === "disabled") return false;
  const inst = await instForSend(admin, bare);
  const sent = await providers.sendText(inst, conv.contact_phone, text);
  const { data: ticket } = await org.select("tickets", "id").eq("conversation_id", conv.id).neq("status", "closed").maybeSingle();
  await org.insert("messages", {
    conversation_id: conv.id, ticket_id: ticket?.id ?? null, direction: "outbound", sender: "ai", content: text,
    status: sent.ok ? "sent" : "failed", provider_message_id: sent.messageId ?? null,
    error: sent.ok ? null : (sent.error ?? "falha").slice(0, 300),
  });
  return sent.ok;
}
