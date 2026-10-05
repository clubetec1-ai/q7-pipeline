import { chatAI, resolveAI } from "./ai-chat.ts";
import { getAgentProfile } from "./get-ai-config.ts";
import { companyKnowledge } from "./company.ts";
import { knowledgeContext } from "./knowledge.ts";
import { moduleOn } from "./modules.ts";
import { forOrg } from "./tenant.ts";
import { sendEmailMessage } from "./mail-send.ts";

/** Regras de formato do e-mail (a política fixa da plataforma entra sozinha pelo chatAI). */
const EMAIL_RULE = [
  "Você está respondendo um E-MAIL (não WhatsApp): texto corrido e cordial, com saudação e despedida curtas.",
  "Sem markdown (sem asteriscos, sem # e sem tabelas) e sem assinatura — o sistema coloca a assinatura da caixa.",
  "Se o pedido precisar de uma pessoa da equipe (documento, decisão, valor fora das informações), diga que encaminhou para a equipe e que logo retornam.",
].join(" ");

const plain = (s: string) => s.replace(/\*\*?([^*\n]+)\*\*?/g, "$1").replace(/^#+\s*/gm, "").trim();

/**
 * IA responde o e-mail de um atendimento que está com ela (status "bot"): mesma base
 * do WhatsApp (perfil do agente, dados da empresa, documentos da base) e envio pela
 * própria caixa. Só roda quando a caixa tem "IA responde os e-mails", o agente está
 * ligado e o módulo de IA está ativo (o protocolo só nasce "bot" nesse caso).
 */
export async function replyEmailByAI(p: {
  // deno-lint-ignore no-explicit-any
  admin: any; orgId: string; conv: { id: string; email_account_id: string; contact_email: string }; ticket: { id: string; status: string; protocol?: string | null; department_id?: string | null } | null; text: string;
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

  const org = forOrg(admin, orgId);
  const { data: history } = await org.select("messages", "direction, content")
    .eq("conversation_id", conv.id).order("created_at", { ascending: false }).limit(12);
  const system = [
    profile.systemPrompt,
    ticket.protocol ? `Protocolo deste atendimento: ${ticket.protocol}.` : "",
    EMAIL_RULE,
    await companyKnowledge(org),
    await knowledgeContext(admin, orgId, p.text.slice(0, 500), "cliente", ticket.department_id ? [ticket.department_id] : null),
  ].filter(Boolean).join("\n\n");
  const chat = [
    { role: "system" as const, content: system },
    ...((history ?? []) as { direction: string; content: string | null }[]).reverse()
      .filter((m) => m.content && !/^\[(image|document|audio|video)\]/.test(m.content))
      .map((m) => ({ role: (m.direction === "inbound" ? "user" : "assistant") as "user" | "assistant", content: String(m.content).slice(0, 4000) })),
  ];
  const r = await chatAI(ai, chat);
  if (!r.ok || !r.reply?.trim()) return false;
  const reply = plain(r.reply).slice(0, 8000);

  const { sent, fields } = await sendEmailMessage({
    admin, orgId, conv, ticketId: ticket.id, text: reply, mediaPath: null, mediaName: "", libraryId: null,
  });
  if (!sent.ok) {
    console.error("[mail-ai] envio falhou", sent.error);
    return false;
  }
  await org.insert("messages", {
    conversation_id: conv.id, ticket_id: ticket.id, direction: "outbound", sender: "ai", content: reply, status: "sent", ...fields,
  });
  await org.update("conversations", { last_message_at: new Date().toISOString() }).eq("id", conv.id);
  return true;
}
