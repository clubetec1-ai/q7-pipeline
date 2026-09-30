import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { HttpError, requirePermission, requireUser, resolveOrg } from "../_shared/auth.ts";
import { requireModule } from "../_shared/modules.ts";
import { forOrg } from "../_shared/tenant.ts";
import { getAgentProfile } from "../_shared/get-ai-config.ts";
import { chat as aiChat, resolveAI } from "../_shared/ai-chat.ts";
import { withProtocol } from "../_shared/flow/executor.ts";
import { companyKnowledge } from "../_shared/company.ts";
import { knowledgeContext } from "../_shared/knowledge.ts";

/**
 * Testar o agente (dono/admin): conversa simulada com a MESMA montagem do
 * atendimento de verdade (comportamento do agente + retrato da empresa + marca +
 * regras e limites + base de conhecimento), sem enviar nada a cliente nenhum e
 * sem gravar a conversa. Aceita o texto de comportamento ainda não salvo.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const ctx = await requireUser(req);
    const orgId = await resolveOrg(ctx, body?.organization_id);
    await requirePermission(ctx, orgId, "org.settings");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await requireModule(admin, orgId, "ia");
    const { data: allowed } = await admin.rpc("service_ai_take", { org: orgId });
    if (allowed === false) throw new HttpError(429, "Muitas chamadas de IA agora. Tente em um minuto.");

    // Só texto, papéis conhecidos, tamanho limitado (o navegador não escolhe o que vai no "system").
    const msgs = (Array.isArray(body?.messages) ? body.messages : []).slice(-20)
      .map((m: { role?: string; content?: string }) => ({
        role: m?.role === "assistant" ? "assistant" as const : "user" as const,
        content: String(m?.content ?? "").slice(0, 1500),
      }))
      .filter((m: { content: string }) => m.content.trim());
    if (!msgs.length || msgs[msgs.length - 1].role !== "user") throw new HttpError(400, "Escreva uma mensagem como se fosse o cliente.");

    const ai = await resolveAI(admin, orgId);
    if (!ai) throw new HttpError(400, "Cadastre a chave da IA em Configurações → Chaves de IA.");
    const profile = await getAgentProfile(admin, orgId);
    const draft = String(body?.prompt ?? "").trim().slice(0, 4000);
    const lastUser = msgs[msgs.length - 1].content;
    const [company, knowledge] = await Promise.all([
      companyKnowledge(forOrg(admin, orgId)),
      knowledgeContext(admin, orgId, lastUser, "cliente", null),
    ]);
    const system = [withProtocol(draft || profile.systemPrompt, "TESTE"), company, knowledge].filter(Boolean).join("\n\n");
    const r = await aiChat(ai.apiKey, ai.provider, ai.model, [{ role: "system", content: system }, ...msgs]);
    if (!r.ok || !r.reply) throw new HttpError(502, r.error ?? "A IA não respondeu. Tente de novo.");
    return json({
      ok: true, reply: String(r.reply).slice(0, 4000), provider: ai.provider, model: ai.model,
      used: { empresa: !!company, base: !!knowledge },
    });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error("agent-test:", e);
    return json({ ok: false, error: e instanceof HttpError ? e.message : "Erro interno" }, status);
  }
});
