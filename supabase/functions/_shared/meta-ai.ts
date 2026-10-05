import { chatAI, resolveAI } from "./ai-chat.ts";
import { getAgentProfile } from "./get-ai-config.ts";
import { companyKnowledge } from "./company.ts";
import { knowledgeContext } from "./knowledge.ts";
import { moduleOn } from "./modules.ts";
import { forOrg } from "./tenant.ts";
import { pageToken, sendMetaText } from "./meta-messaging.ts";

const CHAT_RULE = [
  "Você está respondendo pelo Messenger ou Instagram Direct: mensagens curtas e cordiais, como num chat.",
  "Sem markdown (sem asteriscos, sem # e sem tabelas).",
  "Se o pedido precisar de uma pessoa da equipe (documento, decisão, valor fora das informações), diga que vai chamar alguém da equipe.",
].join(" ");
const plain = (s: string) => s.replace(/\*\*?([^*\n]+)\*\*?/g, "$1").replace(/^#+\s*/gm, "").trim();

/**
 * IA responde no Messenger/Instagram um atendimento que está com ela ("bot"): mesma base
 * do WhatsApp e do e-mail (perfil do agente, dados da empresa, documentos) e envio pela
 * própria Página. Só roda com "IA responde" na Página, agente ligado e módulo de IA.
 */
export async function replyMetaByAI(p: {
  // deno-lint-ignore no-explicit-any
  admin: any; orgId: string;
  conv: { id: string; meta_page_id: string; contact_external_id: string };
  ticket: { id: string; status: string; protocol?: string | null; department_id?: string | null } | null; text: string;
}): Promise<boolean> {
  const { admin, orgId, conv, ticket } = p;
  if (!ticket || ticket.status !== "bot") return false;
  if (!(await moduleOn(admin, orgId, "ia"))) return false;
  const { data: allowed } = await admin.rpc("service_ai_take", { org: orgId });
  if (allowed === false) return false;
  const profile = await getAgentProfile(admin, orgId);
  if (!profile.enabled) return false;
  const ai = await resolveAI(admin, orgId);
  if (!ai) return false;
  const token = await pageToken(admin, conv.meta_page_id);
  if (!token) return false;

  const org = forOrg(admin, orgId);
  const { data: history } = await org.select("messages", "direction, content")
    .eq("conversation_id", conv.id).order("created_at", { ascending: false }).limit(12);
  const system = [
    profile.systemPrompt,
    ticket.protocol ? `Protocolo deste atendimento: ${ticket.protocol}.` : "",
    CHAT_RULE,
    await companyKnowledge(org),
    await knowledgeContext(admin, orgId, p.text.slice(0, 500), "cliente", ticket.department_id ? [ticket.department_id] : null),
  ].filter(Boolean).join("\n\n");
  const chat = [
    { role: "system" as const, content: system },
    ...((history ?? []) as { direction: string; content: string | null }[]).reverse()
      .filter((m) => m.content && !/^\[(image|document|audio|video|anexo)/.test(m.content))
      .map((m) => ({ role: (m.direction === "inbound" ? "user" : "assistant") as "user" | "assistant", content: String(m.content).slice(0, 2000) })),
  ];
  const r = await chatAI(ai, chat);
  if (!r.ok || !r.reply?.trim()) return false;
  const reply = plain(r.reply).slice(0, 2000);
  const sent = await sendMetaText(token, conv.contact_external_id, reply);
  await org.insert("messages", {
    conversation_id: conv.id, ticket_id: ticket.id, direction: "outbound", sender: "ai", content: reply,
    status: sent.ok ? "sent" : "failed", provider_message_id: sent.messageId ?? null, error: sent.ok ? null : sent.error ?? "falha",
  });
  await org.update("conversations", { last_message_at: new Date().toISOString() }).eq("id", conv.id);
  return sent.ok;
}
