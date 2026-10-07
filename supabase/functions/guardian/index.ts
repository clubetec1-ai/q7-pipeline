import { fence } from "../_shared/fence.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { requireModule } from "../_shared/modules.ts";
import { HttpError, requirePermission, requireUser, resolveOrg } from "../_shared/auth.ts";
import { chatAI, resolveAI, forTask } from "../_shared/ai-chat.ts";
import { checkText, GUARDIAN_AI_PROMPT, parseAIAttention, verdict } from "../_shared/guardian.ts";

/**
 * Guardião de segurança e LGPD (desenho 07, fatia 5) para textos livres que viram instrução de agente
 * ou mensagem ao cliente (ex.: o comportamento do Assistente de IA). Regras fixas bloqueiam; a leitura
 * da IA só aponta atenção. Não grava nada: a tela decide se deixa salvar.
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
    if (String(body?.action ?? "") !== "check_text") throw new HttpError(400, "Ação inválida");
    const ctx = await requireUser(req);
    const orgId = await resolveOrg(ctx, body?.organization_id);
    await requirePermission(ctx, orgId, "org.settings");
    const texto = String(body?.texto ?? "").slice(0, 6000);
    const onde = String(body?.onde ?? "texto").slice(0, 60);
    const findings = checkText(texto, onde);
    if (texto.trim().length >= 20) {
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await requireModule(admin, orgId, "ia");
      const { data: allowed } = await admin.rpc("service_ai_take", { org: orgId });
      const ai = allowed === false ? null : await resolveAI(admin, orgId);
      if (ai) {
        try {
          const r = await chatAI(forTask(ai, "analise"), [{ role: "system", content: GUARDIAN_AI_PROMPT }, { role: "user", content: `<dados>\n${fence(texto)}\n</dados>` }],
            undefined, { json: true, timeoutMs: 30_000 });
          if (r.ok && r.reply) findings.push(...parseAIAttention(JSON.parse(r.reply.match(/\{[\s\S]*\}/)?.[0] ?? "{}")));
        } catch { /* a leitura da IA é um extra */ }
      }
    }
    return json({ ok: true, status: verdict(findings), findings });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error("[guardian]", e instanceof Error ? e.message : e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Erro" }, status);
  }
});
