import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { HttpError, permissionsIn, requireUser, resolveOrg } from "../_shared/auth.ts";
import { chatAI, resolveAI, forAgent } from "../_shared/ai-chat.ts";
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
const URG = ["baixa", "media", "alta", "urgente"];
const parseJson = (t: string): Record<string, unknown> => {
  try { return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)); } catch { return {}; }
};

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
    const page = String(body?.page ?? "").slice(0, 80);
    const ai = await resolveAI(admin, orgId);

    // "Não resolveu": abre o chamado para o suporte com o resumo da conversa e a urgência.
    if (body?.action === "escalate") {
      if (!msgs.length) throw new HttpError(400, "Conte o que você precisa.");
      const since = new Date(Date.now() - 3600_000).toISOString();
      const { count } = await admin.from("service_requests").select("id", { count: "exact", head: true })
        .eq("organization_id", orgId).eq("source", "assistente").gte("created_at", since);
      if ((count ?? 0) >= 5) throw new HttpError(429, "Já abrimos vários chamados nesta última hora. O suporte vai responder; acompanhe em Configurações → Suporte.");
      const note = String(body?.note ?? "").trim().slice(0, 800);
      const convo = msgs.map((m: { role: string; content: string }) => `${m.role === "user" ? "Pessoa" : "Assistente"}: ${m.content}`).join("\n");
      let out: Record<string, unknown> = {};
      if (ai) {
        const r = await chatAI(await forAgent(admin, ai, "atendimento"), [{ role: "system", content:
          "Você abre chamados de suporte do sistema Deixa com a IA. A partir da conversa (o assistente não resolveu), responda SOMENTE com JSON " +
          '{"titulo":"","resumo":"","urgencia":"media"}. titulo: até 80 caracteres. resumo: o problema e o que já foi tentado, em até 6 linhas, sem dados pessoais de clientes. ' +
          "urgencia: urgente = atendimento parado, clientes sem resposta, número/caixa desconectados, cobrança ou segurança; alta = função importante não funciona; " +
          "media = dúvida de configuração ou uso; baixa = sugestão ou melhoria." },
          { role: "user", content: `Tela: ${page || "?"}\n${convo}${note ? `\nObservação da pessoa: ${note}` : ""}` }], undefined, { json: true });
        if (r.ok && r.reply) out = parseJson(String(r.reply));
      }
      const lastUser = [...msgs].reverse().find((m: { role: string }) => m.role === "user")?.content ?? "";
      const urgency = URG.includes(String(out.urgencia)) ? String(out.urgencia) : "media";
      const topic = (String(out.titulo ?? "").trim() || `Dúvida não resolvida: ${lastUser}`).slice(0, 120);
      const message = [String(out.resumo ?? "").trim() || lastUser, note ? `Observação: ${note}` : ""].filter(Boolean).join("\n\n").slice(0, 2000);
      const { data: t, error } = await admin.from("service_requests").insert({
        organization_id: orgId, topic, message, urgency, source: "assistente", page: page || null, created_by: ctx.user.id,
        transcript: msgs.map((m: { role: string; content: string }) => ({ role: m.role, content: m.content.slice(0, 800) })),
      }).select("id, protocol").single();
      if (error) throw new Error(error.message);
      return json({ ok: true, id: t.id, protocol: t.protocol, urgency, topic });
    }

    if (!msgs.length || msgs[msgs.length - 1].role !== "user") throw new HttpError(400, "Escreva sua dúvida.");
    if (!ai) throw new HttpError(409, "A IA ainda não está disponível para esta empresa.");
    const manager = perms.includes("org.settings");
    const system = [
      "Você é o assistente do Deixa com a IA (o sistema da Clubetec), dentro do próprio sistema. Ajude a pessoa a USAR o sistema: explique em passos curtos (no máximo 5),",
      "diga onde fica no menu e SEMPRE termine com o link da tela no formato [[Nome da tela|/caminho]] (ex.: [[Equipe e permissões|/equipe]]), usando só os caminhos do mapa abaixo.",
      "Use só os passos e nomes que estão no mapa; não invente botões (como \"Salvar\" ou \"Editar\") nem etapas que o mapa não cita — as opções da tela salvam sozinhas.",
      "Responda só sobre o uso do sistema; para outros assuntos, diga com educação que só ajuda com o sistema. Não invente telas, botões ou caminhos:",
      "se não estiver no mapa, diga que não tem certeza e que a pessoa pode clicar em \"Não resolveu\" logo abaixo para abrir um chamado com o suporte.",
      manager ? "A pessoa é dono/administrador: pode ver as telas de configuração." : "A pessoa é da equipe (não administra): se a tarefa exige dono ou administrador, diga para pedir a ele.",
      page ? `A pessoa está na tela ${page}.` : "",
      "Escreva em português do Brasil, simples e direto, sem tabelas.",
      `\nMAPA DO SISTEMA:\n${APP_GUIDE}`,
    ].filter(Boolean).join(" ");
    const r = await chatAI(await forAgent(admin, ai, "atendimento"), [{ role: "system", content: system }, ...msgs]);
    if (!r.ok || !r.reply) throw new HttpError(502, "O assistente não respondeu. Tente de novo.");
    return json({ ok: true, reply: toChatText(String(r.reply)).slice(0, 3000) });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error("app-assistant:", e);
    return json({ ok: false, error: e instanceof HttpError ? e.message : "Erro interno" }, status);
  }
});
