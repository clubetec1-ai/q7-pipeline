/**
 * Resposta do agente de atendimento com a MESMA montagem do atendimento de verdade (comportamento do agente
 * + retrato da empresa + marca + regras e limites + base de conhecimento; a política fixa entra no chatAI).
 * Usado pelo "Testar o agente" e pela prova dos cenários (fatia 6). Não envia nada a cliente nenhum.
 */
import { forOrg } from "./tenant.ts";
import { getAgentProfile } from "./get-ai-config.ts";
import { chatAI, type ResolvedAI, forAgent } from "./ai-chat.ts";
import { withProtocol } from "./flow/executor.ts";
import { toChatText } from "./ai-policy.ts";
import { companyKnowledge } from "./company.ts";
import { knowledgeContext } from "./knowledge.ts";

export interface ReplyOut { ok: boolean; reply: string; error?: string; used: { empresa: boolean; base: boolean } }

// deno-lint-ignore no-explicit-any
export async function agentReply(admin: any, orgId: string, ai: ResolvedAI, msgs: { role: "user" | "assistant"; content: string }[],
  opts: { draft?: string; situacao?: string } = {}): Promise<ReplyOut> {
  const profile = await getAgentProfile(admin, orgId);
  const lastUser = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
  const [company, knowledge] = await Promise.all([
    companyKnowledge(forOrg(admin, orgId)),
    knowledgeContext(admin, orgId, lastUser, "cliente", null),
  ]);
  const system = [withProtocol(opts.draft || profile.systemPrompt, "TESTE"), company, knowledge,
    opts.situacao ? `Situação atual (informada pelo sistema): ${opts.situacao}` : ""].filter(Boolean).join("\n\n");
  const r = await chatAI(await forAgent(admin, ai, "atendimento"), [{ role: "system", content: system }, ...msgs]);
  if (!r.ok || !r.reply) return { ok: false, reply: "", error: r.error ?? "A IA não respondeu.", used: { empresa: !!company, base: !!knowledge } };
  return { ok: true, reply: toChatText(String(r.reply)).slice(0, 4000), used: { empresa: !!company, base: !!knowledge } };
}
