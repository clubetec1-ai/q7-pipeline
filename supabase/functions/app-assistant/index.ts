import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { HttpError, permissionsIn, requireUser, resolveOrg } from "../_shared/auth.ts";
import { chatAI, resolveAI } from "../_shared/ai-chat.ts";
import { toChatText } from "../_shared/ai-policy.ts";
import { APP_GUIDE } from "../_shared/app-guide.ts";

/**
 * Assistente "Como faço…?" dentro do sistema: responde dúvidas de USO do ClubeCRM
 * com o passo a passo e o caminho da tela. Não lê dados de clientes nem da empresa:
 * só o mapa do sistema e o papel da pessoa (para não ensinar o que ela não pode fazer).
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
    const perms = await permissionsIn(ctx, orgId);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: allowed } = await admin.rpc("service_ai_take", { org: orgId });
    if (allowed === false) throw new HttpError(429, "Muitas perguntas agora. Tente em um minuto.");

    const msgs = (Array.isArray(body?.messages) ? body.messages : []).slice(-10)
      .map((m: { role?: string; content?: string }) => ({
        role: m?.role === "assistant" ? "assistant" as const : "user" as const,
        content: String(m?.content ?? "").slice(0, 800),
      }))
      .filter((m: { content: string }) => m.content.trim());
    if (!msgs.length || msgs[msgs.length - 1].role !== "user") throw new HttpError(400, "Escreva sua dúvida.");

    const ai = await resolveAI(admin, orgId);
    if (!ai) throw new HttpError(409, "A IA ainda não está disponível para esta empresa.");
    const page = String(body?.page ?? "").slice(0, 80);
    const manager = perms.includes("org.settings");
    const system = [
      "Você é o assistente do Deixa com a IA (o sistema da Clubetec), dentro do próprio sistema. Ajude a pessoa a USAR o sistema: explique em passos curtos (no máximo 5),",
      "diga onde fica no menu e SEMPRE termine com o link da tela no formato [[Nome da tela|/caminho]] (ex.: [[Equipe e permissões|/equipe]]), usando só os caminhos do mapa abaixo.",
      "Use só os passos e nomes que estão no mapa; não invente botões (como \"Salvar\" ou \"Editar\") nem etapas que o mapa não cita — as opções da tela salvam sozinhas.",
      "Responda só sobre o uso do sistema; para outros assuntos, diga com educação que só ajuda com o sistema. Não invente telas, botões ou caminhos:",
      "se não estiver no mapa, diga que não tem certeza e indique Integrações → \"Pedir ajuda ao time Clubetec\".",
      manager ? "A pessoa é dono/administrador: pode ver as telas de configuração." : "A pessoa é da equipe (não administra): se a tarefa exige dono ou administrador, diga para pedir a ele.",
      page ? `A pessoa está na tela ${page}.` : "",
      "Escreva em português do Brasil, simples e direto, sem tabelas.",
      `\nMAPA DO SISTEMA:\n${APP_GUIDE}`,
    ].filter(Boolean).join(" ");
    const r = await chatAI(ai, [{ role: "system", content: system }, ...msgs]);
    if (!r.ok || !r.reply) throw new HttpError(502, "O assistente não respondeu. Tente de novo.");
    return json({ ok: true, reply: toChatText(String(r.reply)).slice(0, 3000) });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error("app-assistant:", e);
    return json({ ok: false, error: e instanceof HttpError ? e.message : "Erro interno" }, status);
  }
});
