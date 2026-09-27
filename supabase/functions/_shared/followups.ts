// deno-lint-ignore no-explicit-any
type SupabaseClient = any;
import { forOrg } from "./tenant.ts";

/**
 * Cancela todos os follow-ups pendentes de uma conversa.
 * Usado quando o cliente responde (não há mais razão pra reengajar).
 */
export async function cancelPendingFollowups(
  admin: SupabaseClient,
  conversationId: string,
) {
  await admin
    .from("followups")
    .update({ status: "cancelled" })
    .eq("conversation_id", conversationId)
    .eq("status", "pending");
}

/**
 * Agenda um auto-follow-up por inatividade após uma resposta da IA/humano,
 * se o usuário ativou essa opção e ainda não atingiu o limite.
 * Cancela qualquer pendente anterior antes de criar o novo.
 */
export async function scheduleInactivityFollowup(params: {
  admin: SupabaseClient;
  orgId: string;
  conversationId: string;
  currentAutoCount: number;
}) {
  const { admin, orgId, conversationId, currentAutoCount } = params;
  const org = forOrg(admin, orgId);

  // Proteção: só agenda se a IA continua ativa nessa conversa
  const { data: conv } = await org
    .select("conversations", "ai_enabled")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv?.ai_enabled) return;

  const { data: agent } = await org
    .select("agent_configs", "followup_inactivity_minutes, followup_max_per_conversation")
    .maybeSingle();

  const minutes = agent?.followup_inactivity_minutes ?? 0;
  const max = agent?.followup_max_per_conversation ?? 1;
  if (!minutes || minutes <= 0) return;
  if (currentAutoCount >= max) return;

  // Cancela qualquer pendente e cria o novo
  await cancelPendingFollowups(admin, conversationId);

  const sendAt = new Date(Date.now() + minutes * 60_000).toISOString();

  await org.insert("followups", {
    conversation_id: conversationId,
    send_at: sendAt,
    status: "pending",
    kind: "auto_inactivity",
  });

  await org
    .update("conversations", { inactivity_followup_at: sendAt })
    .eq("id", conversationId);
}