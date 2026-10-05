import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { HttpError, requirePermission, requireUser, resolveOrg } from "../_shared/auth.ts";
import { ConnectError, connectCloudNumber } from "../_shared/meta-connect.ts";

/**
 * Conexão manual de número da Meta (Cloud API): Phone Number ID + WABA ID + token.
 * Antes de gravar, confere com a própria Meta a posse do número; ativa o webhook da
 * WABA, cria o número e guarda o token no Vault. O token nunca vai para log nem volta.
 * O caminho simples é "Conectar com o Facebook" (função meta-connect); este fica como avançado.
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
    const r = await connectCloudNumber(admin, orgId, ctx.user.id, {
      phoneNumberId, wabaId, token, name: body?.name, color: body?.color ?? null, via: "manual",
    });
    return json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof HttpError || e instanceof ConnectError) return json({ ok: false, error: e.message }, e.status);
    console.error("[meta-onboard] erro", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Erro interno" }, 500);
  }
});
