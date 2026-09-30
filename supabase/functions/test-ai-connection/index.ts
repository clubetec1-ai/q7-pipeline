import { createClient } from "npm:@supabase/supabase-js@2";
import { callGroq, listChatModels, resolveModelChain } from "../_shared/get-ai-config.ts";
import { HttpError, requirePermission, requireUser, resolveOrg } from "../_shared/auth.ts";
import { forOrg } from "../_shared/tenant.ts";
import { getSecret } from "../_shared/secrets.ts";
import { chat, resolveAI } from "../_shared/ai-chat.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    let ctx;
    let orgId: string;
    const body = await req.json().catch(() => ({}));
    try {
      ctx = await requireUser(req);
      orgId = await resolveOrg(ctx, body?.organization_id);
      await requirePermission(ctx, orgId, "org.settings");
    } catch (e) {
      return json({ ok: false, error: (e as Error).message }, e instanceof HttpError ? e.status : 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    let { apiKey, model } = body ?? {};

    // Sem chave no corpo: testa o provedor PADRÃO da empresa (Configurações → Chaves de IA).
    if (!apiKey) {
      const ai = await resolveAI(supabase, orgId);
      if (ai && ai.provider !== "groq") {
        const r = await chat(ai.apiKey, ai.provider, ai.model, [
          { role: "system", content: "Responda apenas com a palavra: OK" },
          { role: "user", content: "Teste de conexão" },
        ]);
        return r.ok
          ? json({ ok: true, data: { reply: String(r.reply ?? "").substring(0, 200), provider: ai.provider, model: ai.model } }, 200)
          : json({ ok: false, error: r.error ?? "A IA não respondeu" }, 200);
      }
    }

    // A UI limpa o campo da chave depois de salvar, então um teste posterior
    // manda o corpo vazio: usa a chave da organização, guardada no Vault.
    const { data: cfg } = await forOrg(supabase, orgId)
      .select("agent_configs", "groq_model")
      .maybeSingle();
    if (!model) model = cfg?.groq_model ?? "auto";
    if (!apiKey) apiKey = (await getSecret(supabase, `org:${orgId}:groq_api_key`)) ?? undefined;
    if (!apiKey) {
      return json({ ok: false, error: "Chave da IA não configurada. Cadastre em Configurações → Chaves de IA." }, 200);
    }

    const result = await callGroq(apiKey, model, [
      { role: "system", content: "Responda apenas com a palavra: OK" },
      { role: "user", content: "Teste de conexão" },
    ]);

    if (!result.ok) {
      const tentados = result.tried?.length ? ` (tentados: ${result.tried.join(", ")})` : "";
      return json({ ok: false, error: `${result.error}${tentados}` }, 200);
    }

    // Devolve a lista viva para a UI poder oferecer as opções sem chutar.
    const available = await listChatModels(apiKey);
    const chain = await resolveModelChain(apiKey, model);

    return json({
      ok: true,
      data: {
        reply: String(result.reply).substring(0, 200),
        provider: "groq",
        model: result.model,
        auto: !model || String(model).toLowerCase() === "auto",
        fallbacks: chain.slice(0, 5),
        available,
      },
    }, 200);

  } catch (e: any) {
    return json({ ok: false, error: e.message || "Erro interno" }, 200);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
