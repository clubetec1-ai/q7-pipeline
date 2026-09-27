import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { HttpError, requirePermission, requireUser, resolveOrg } from "../_shared/auth.ts";
import { forOrg } from "../_shared/tenant.ts";
import { putSecret } from "../_shared/secrets.ts";
import { GRAPH_VERSION } from "../_shared/providers/cloud.ts";

/**
 * Conexão de número da Meta (Cloud API) numa organização.
 * Spec: docs/superpowers/specs/2026-09-24-multiplos-numeros-design.md §6
 *
 * Ação `manual`: antes de gravar qualquer coisa, confere com a própria Meta que
 * o token informado acessa a WABA e que o número pertence a ela (posse). Só
 * então ativa o webhook da WABA, cria o número e guarda o token no Vault.
 * O token nunca vai para log nem volta na resposta.
 * (Embedded Signup — "Conectar com Facebook" — entra na etapa 4B.)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    if (body?.action !== "manual") throw new HttpError(400, "Ação inválida");

    const ctx = await requireUser(req);
    const orgId = await resolveOrg(ctx, body?.organization_id);
    await requirePermission(ctx, orgId, "org.settings");

    const phoneNumberId = String(body?.phone_number_id ?? "").trim();
    const wabaId = String(body?.waba_id ?? "").trim();
    const token = String(body?.access_token ?? "").trim();
    if (!/^\d{5,25}$/.test(phoneNumberId)) throw new HttpError(400, "Phone Number ID inválido");
    if (!/^\d{5,25}$/.test(wabaId)) throw new HttpError(400, "WABA ID inválido");
    if (token.length < 20) throw new HttpError(400, "Access Token inválido");

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: canAdd } = await admin.rpc("service_can_add_number", { org: orgId });
    if (canAdd !== true) throw new HttpError(409, "Limite de números do seu plano atingido.");

    // Número já vinculado? Em outra organização, recusa sem dizer qual.
    const { data: existing } = await admin
      .from("whatsapp_instances")
      .select("organization_id")
      .eq("phone_number_id", phoneNumberId)
      .maybeSingle();
    if (existing) {
      throw new HttpError(409, existing.organization_id === orgId
        ? "Este número já está conectado nesta empresa."
        : "Este número já está conectado em outra conta.");
    }

    const auth = { Authorization: `Bearer ${token}` };

    // 1. Posse: o token lista os números da WABA e o número informado está lá.
    const list = await fetch(
      `${GRAPH}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,messaging_limit_tier`,
      { headers: auth },
    );
    if (!list.ok) {
      console.warn("[meta-onboard] token sem acesso a WABA", { status: list.status });
      throw new HttpError(400, "Este token não tem acesso a essa conta do WhatsApp Business (WABA). Confira o WABA ID e o token.");
    }
    const numbers = ((await list.json())?.data ?? []) as Array<Record<string, string>>;
    const pn = numbers.find((n) => n.id === phoneNumberId);
    if (!pn) throw new HttpError(400, "Esse Phone Number ID não pertence a essa WABA.");

    // 2. Recebimento de mensagens: inscreve o app na WABA.
    const sub = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, { method: "POST", headers: auth });
    if (!sub.ok) {
      console.warn("[meta-onboard] subscribed_apps falhou", { status: sub.status });
      throw new HttpError(400, "A Meta não permitiu ativar o recebimento de mensagens nessa WABA. Confira as permissões do token.");
    }

    // 3. Cria o número e guarda o token no Vault; se o Vault falhar, desfaz.
    const org = forOrg(admin, orgId);
    const { data: row, error } = await org
      .insert("whatsapp_instances", {
        user_id: ctx.user.id,
        name: String(body?.name ?? "").trim() || pn.verified_name || "WhatsApp Oficial",
        phone: String(pn.display_phone_number ?? "").replace(/\D/g, "") || null,
        provider: "cloud",
        phone_number_id: phoneNumberId,
        waba_id: wabaId,
        status: "connected",
        connected_via: "manual",
        color: body?.color ?? null,
        quality_rating: pn.quality_rating ?? null,
        messaging_limit_tier: pn.messaging_limit_tier ?? null,
      })
      .select("id, name, phone")
      .single();
    if (error || !row) throw new HttpError(500, "Não foi possível registrar o número");

    const secretName = `instance:${row.id}:token`;
    if (!(await putSecret(admin, secretName, token))) {
      await org.delete("whatsapp_instances").eq("id", row.id);
      throw new HttpError(500, "Não foi possível guardar o token com segurança. Nada foi salvo.");
    }
    await org.update("whatsapp_instances", { secret_name: secretName }).eq("id", row.id);

    return json({ ok: true, instance_id: row.id, name: row.name, phone: row.phone });
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    console.error("[meta-onboard] erro", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Erro interno" }, 500);
  }
});
