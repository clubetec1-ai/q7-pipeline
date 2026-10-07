import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { requireModule } from "../_shared/modules.ts";
import { HttpError, requirePermission, requireUser, resolveOrg } from "../_shared/auth.ts";
import { chatAI, resolveAI, forAgent } from "../_shared/ai-chat.ts";

/**
 * Relatório de melhorias para a supervisão (reports.view): junta as falhas de
 * processo e os feedbacks dos últimos N dias e a IA monta o plano — o que
 * melhorar, por que e como implementar no ClubeCRM. As avaliações são lidas
 * com o login de quem pediu (a RLS limita ao que a pessoa pode ver).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const PROMPT = `Você é consultor de atendimento. Recebe falhas de processo e feedbacks de avaliações automáticas
dos atendimentos de uma empresa. Escreva um relatório curto em português do Brasil, em Markdown:
1. "Resumo" (3 linhas: satisfação, nota média, principal problema).
2. "Melhorias prioritárias": até 6 itens, do maior impacto para o menor. Para cada um: o problema (quantas vezes
   apareceu), por que importa e **como implementar** — prefira o que dá para fazer no próprio ClubeCRM sem IA
   (fluxo, resposta rápida, arquivo na biblioteca, horário, departamento, transbordo entre setores, treinamento da
   equipe) antes de sugerir agentes de IA.
3. "Para a equipe": 3 a 5 orientações gerais de atendimento (sem citar pessoas).
Nunca invente números; use só os dados recebidos. Nunca escreva nomes, telefones, e-mails ou documentos.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const ctx = await requireUser(req);
    const orgId = await resolveOrg(ctx, body?.organization_id);
    await requirePermission(ctx, orgId, "reports.view");
    const days = Math.min(90, Math.max(7, Number(body?.days) || 30));

    const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: rows, error } = await asUser.from("ticket_reviews")
      .select("satisfied, score, reason, agent_feedback, process_issues")
      .eq("organization_id", orgId).eq("status", "done")
      .gte("reviewed_at", new Date(Date.now() - days * 86_400_000).toISOString())
      .order("reviewed_at", { ascending: false }).limit(200);
    if (error) throw new HttpError(500, "Não foi possível ler as avaliações");
    if (!rows?.length) return json({ ok: true, report: null, count: 0 });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await requireModule(admin, orgId, "gestao");
    const { data: allowed } = await admin.rpc("service_ai_take", { org: orgId });
    if (allowed === false) throw new HttpError(429, "Muitas chamadas de IA agora. Tente em um minuto.");
    const { data: o } = await admin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
    const s = (o?.settings ?? {}) as Record<string, string>;
    const ai = await resolveAI(admin, orgId, { provider: s.review_provider ?? null, model: s.review_model ?? null });
    if (!ai) throw new HttpError(409, "Configure a chave do provedor de IA (Configurações → Chaves de IA).");

    const sat = rows.filter((r) => r.satisfied === "sim").length;
    const avg = rows.reduce((a, r) => a + (r.score ?? 0), 0) / rows.length;
    const issues = rows.flatMap((r) => (Array.isArray(r.process_issues) ? r.process_issues : []) as { falha: string; sugestao: string }[]);
    const data = [
      `Período: ${days} dias. Avaliações: ${rows.length}. Clientes satisfeitos: ${sat} (${Math.round((sat / rows.length) * 100)}%). Nota média: ${avg.toFixed(1)}.`,
      "Falhas de processo:", ...issues.slice(0, 120).map((i) => `- ${i.falha} → ${i.sugestao}`),
      "Feedbacks aos atendentes:", ...rows.slice(0, 60).map((r) => `- ${r.agent_feedback ?? ""}`),
    ].join("\n").slice(0, 14000);

    const r = await chatAI(await forAgent(admin, ai, "relatorios"), [{ role: "system", content: PROMPT }, { role: "user", content: data }]);
    if (!r.ok || !r.reply) throw new HttpError(502, "A IA não respondeu. Tente de novo.");
    await admin.from("audit_log").insert({ organization_id: orgId, actor_id: ctx.user.id, action: "reviews.report", meta: { days, count: rows.length } });
    return json({ ok: true, report: r.reply, count: rows.length, satisfied: sat, avg: Number(avg.toFixed(1)) });
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    console.error("[reviews-report]", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Erro inesperado" }, 500);
  }
});
