import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { requireModule } from "../_shared/modules.ts";
import { HttpError, permissionsIn, requireUser, resolveOrg } from "../_shared/auth.ts";
import { forOrg } from "../_shared/tenant.ts";
import { chatAI, resolveAI, forTask } from "../_shared/ai-chat.ts";
import { knowledgeContext } from "../_shared/knowledge.ts";

/**
 * Ciclo de melhoria contínua — partes com IA:
 *  - from_reviews: junta as falhas de processo das avaliações (30 dias) e cria
 *    melhorias sugeridas com o passo a passo (supervisão ou dono/admin).
 *  - propose_fix: numa correção criada pelo monitor (ou em qualquer sugerida),
 *    a IA reescreve o "como fazer" com base nos números antes × depois e nas
 *    avaliações recentes. Só muda texto; aprovar continua com a pessoa.
 * As avaliações são lidas com o login de quem pediu (RLS); gravação pelo backend.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const clip = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    if (!["from_reviews", "propose_fix"].includes(action)) throw new HttpError(400, "Ação inválida");
    const ctx = await requireUser(req);
    const orgId = await resolveOrg(ctx, body?.organization_id);
    const perms = await permissionsIn(ctx, orgId);
    if (!perms.includes("org.settings") && !perms.includes("reports.view")) throw new HttpError(403, "Sem permissão para esta ação");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await requireModule(admin, orgId, "gestao");
    const org = forOrg(admin, orgId);

    const { data: allowed } = await admin.rpc("service_ai_take", { org: orgId });
    if (allowed === false) throw new HttpError(429, "Muitas chamadas de IA agora. Tente em um minuto.");
    const ai = await resolveAI(admin, orgId);
    if (!ai) throw new HttpError(409, "Configure a chave do provedor de IA (Configurações → Chaves de IA).");
    const ask = async (system: string, user: string) => {
      const r = await chatAI(forTask(ai, "analise"), [{ role: "system", content: system }, { role: "user", content: user }], undefined, { json: true, timeoutMs: 60_000 });
      if (!r.ok || !r.reply) throw new HttpError(502, "A IA não respondeu. Tente de novo.");
      try { return JSON.parse(r.reply.match(/\{[\s\S]*\}/)?.[0] ?? "{}"); } catch { return {}; }
    };
    const { data: depts } = await org.select("departments", "name");
    const setores = (depts ?? []).map((d: { name: string }) => d.name).join(", ") || "nenhum";

    if (action === "from_reviews") {
      const { data: rows } = await ctx.userClient.from("ticket_reviews").select("process_issues, department_id")
        .eq("organization_id", orgId).eq("status", "done")
        .gte("reviewed_at", new Date(Date.now() - 30 * 86_400_000).toISOString()).limit(300);
      const issues = (rows ?? []).flatMap((r: { process_issues: { falha: string; sugestao: string }[] }) => r.process_issues ?? []);
      if (!issues.length) return json({ ok: true, created: 0, message: "Sem falhas de processo nas avaliações dos últimos 30 dias." });
      const out = await ask(
        "Você transforma falhas de processo vistas nos atendimentos de uma empresa em MELHORIAS acionáveis. Agrupe falhas parecidas " +
        "(conte quantas vezes apareceu), priorize pelo impacto e escreva no máximo 6 melhorias. Prefira soluções sem IA no ClubeCRM " +
        "(fluxo, resposta rápida, arquivo na biblioteca, horário, transbordo entre setores, treinamento) antes de agentes de IA. " +
        `Setores da empresa: ${setores}. Use um desses nomes em "setor" quando fizer sentido. Nunca escreva nomes de pessoas. ` +
        'Responda SOMENTE com JSON: {"melhorias":[{"title":"","description":"o problema e quantas vezes apareceu","how":"passo a passo curto de como implementar","setor":"","kind":"processo|automacao|agente"}]}',
        issues.slice(0, 150).map((i) => `- ${i.falha} → ${i.sugestao}`).join("\n").slice(0, 12_000),
      );
      const items = (Array.isArray(out.melhorias) ? out.melhorias : []).slice(0, 6).map((m: any) => ({
        title: clip(m?.title, 160), description: clip(m?.description, 2000), how: clip(m?.how, 4000), setor: clip(m?.setor, 80),
        kind: ["processo", "automacao", "agente"].includes(m?.kind) ? m.kind : "processo",
      })).filter((m: { title: string }) => m.title);
      const { data: created } = await admin.rpc("service_add_improvements", { org: orgId, src: "avaliacoes", items, replace_suggested: false });
      await admin.from("audit_log").insert({ organization_id: orgId, actor_id: ctx.user.id, action: "improvements.from_reviews", meta: { created } });
      return json({ ok: true, created: created ?? 0 });
    }

    // propose_fix
    const id = String(body?.improvement_id ?? "");
    const { data: i } = await org.select("improvements").eq("id", id).maybeSingle();
    if (!i) throw new HttpError(404, "Melhoria não encontrada");
    if (i.status !== "sugerida") throw new HttpError(422, "Só dá para ajustar melhorias que ainda aguardam aprovação.");
    const { data: parent } = i.parent_id ? await org.select("improvements").eq("id", i.parent_id).maybeSingle() : { data: null };
    const { data: recent } = await ctx.userClient.from("ticket_reviews").select("reason, process_issues")
      .eq("organization_id", orgId).eq("status", "done").order("reviewed_at", { ascending: false }).limit(40);
    const out = await ask(
      "Você é consultor de melhoria contínua. Uma melhoria foi implantada e não trouxe o resultado esperado (ou precisa de ajuste). " +
      "Com os números antes × depois e as avaliações recentes, explique em 2 a 3 frases o provável motivo e escreva o NOVO passo a passo " +
      "do ajuste (o que mudar no fluxo, no texto, na regra ou no treinamento). Seja concreto; não invente dados. Nunca escreva nomes de pessoas. " +
      'Responda SOMENTE com JSON: {"motivo":"","how":"1. ...\\n2. ..."}',
      [
        `Melhoria: ${parent?.title ?? i.title}`, `Descrição: ${parent?.description ?? i.description ?? ""}`,
        `Como foi implantada: ${parent?.how ?? i.how ?? ""}`,
        `Antes: ${JSON.stringify(parent?.metrics_before ?? {})}`, `Depois: ${JSON.stringify(parent?.metrics_after ?? {})}`,
        await knowledgeContext(admin, orgId, `${parent?.title ?? i.title} ${i.description ?? ""}`, "interno", i.department_id ? [i.department_id] : null, 2500),
        "Avaliações recentes:", ...(recent ?? []).map((r: { reason: string | null; process_issues: { falha: string }[] }) =>
          `- ${r.reason ?? ""} ${(r.process_issues ?? []).map((p) => p.falha).join("; ")}`),
      ].join("\n").slice(0, 12_000),
    );
    const how = clip(out.how, 4000);
    if (!how) throw new HttpError(502, "Não consegui preparar o ajuste. Tente de novo.");
    const motivo = clip(out.motivo, 800);
    await org.update("improvements", {
      how, description: clip(`${motivo ? `Provável motivo: ${motivo}\n\n` : ""}${i.description ?? ""}`, 2000), updated_at: new Date().toISOString(),
    }).eq("id", i.id);
    await admin.from("audit_log").insert({ organization_id: orgId, actor_id: ctx.user.id, action: "improvements.propose_fix", target: i.id });
    return json({ ok: true, how, motivo });
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    console.error("[improvements]", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Erro inesperado" }, 500);
  }
});
