import { createClient } from "npm:@supabase/supabase-js@2";
import { callGroq, listChatModels, resolveModelChain } from "../_shared/get-ai-config.ts";
import { HttpError, isPlatformOperator, requirePermission, requireUser, resolveOrg } from "../_shared/auth.ts";
import { forOrg } from "../_shared/tenant.ts";
import { getSecret } from "../_shared/secrets.ts";
import { AI_PROVIDERS, chat, chatAI, providerKey, resolveAI } from "../_shared/ai-chat.ts";

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

    // Clubetec testa uma posição da IA da plataforma (Plataforma → Conectores): verde ou vermelho.
    if (body?.platform_slot) {
      const op = await requireUser(req).catch(() => null);
      if (!op || !(await isPlatformOperator(op))) return json({ ok: false, error: "Apenas operadores da plataforma" }, 403);
      const slot = String(body.platform_slot);
      if (!["principal", "reserva1", "reserva2"].includes(slot)) return json({ ok: false, error: "Posição inválida" }, 400);
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: row } = await admin.from("platform_ai_slots").select("provider, model").eq("slot", slot).maybeSingle();
      const key = row ? await getSecret(admin, `platform:ai:${slot}`) : null;
      if (!row || !key || !AI_PROVIDERS[row.provider]) return json({ ok: false, error: "Posição sem fornecedor ou chave" }, 200);
      const r = await chat(key, row.provider, row.model || AI_PROVIDERS[row.provider].model, [
        { role: "system", content: "Responda apenas com a palavra: OK" }, { role: "user", content: "Teste de conexão" },
      ], undefined, { timeoutMs: 20_000 });
      if (r.ok) await admin.rpc("service_ai_slot_ok", { slot_name: slot });
      else await admin.rpc("service_ai_slot_error", { slot_name: slot, err: r.error ?? "falha" });
      return json(r.ok ? { ok: true, data: { reply: String(r.reply ?? "").slice(0, 60) } } : { ok: false, error: r.error ?? "A IA não respondeu" }, 200);
    }

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
      if (ai && (ai.provider !== "groq" || ai.source === "plataforma")) {
        const r = await chatAI(ai, [
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
    if (!apiKey) apiKey = (await providerKey(supabase, orgId, "groq")) ?? undefined; // chave própria da Groq
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
