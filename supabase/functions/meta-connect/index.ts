import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { HttpError, requirePermission, requireUser, resolveOrg } from "../_shared/auth.ts";
import { getSecret, randomHex } from "../_shared/secrets.ts";
import { moduleOn } from "../_shared/modules.ts";
import { ConnectError, connectCloudNumber, connectPage, GRAPH } from "../_shared/meta-connect.ts";

/**
 * "Conectar com o Facebook" (dono/admin):
 *  * start  — monta o link do login da Meta (Facebook Login for Business) com um
 *             estado de uso único; o retorno cai em meta-connect-callback.
 *  * finish — depois do login, a pessoa escolhe a Página ou o número; conecta com as
 *             mesmas checagens da conexão manual e apaga o token temporário.
 *  * cancel — desiste e apaga o token temporário.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const setting = async (admin: any, key: string) => // deno-lint-ignore no-explicit-any
  String((await admin.from("app_settings").select("value").eq("key", key).maybeSingle()).data?.value ?? "").trim();

// Sem configuração do login (config_id), pede as permissões direto.
const SCOPES = {
  pages: "pages_show_list,pages_messaging,pages_manage_metadata,instagram_basic,instagram_manage_messages,business_management",
  whatsapp: "whatsapp_business_management,whatsapp_business_messaging,business_management",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    const ctx = await requireUser(req);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (action === "start") {
      const orgId = await resolveOrg(ctx, body?.organization_id);
      await requirePermission(ctx, orgId, "org.settings");
      const kind = body?.kind === "whatsapp" ? "whatsapp" : "pages";
      if (kind === "pages" && !(await moduleOn(admin, orgId, "canais"))) throw new HttpError(403, "O módulo Canais não está contratado.");
      const appId = await setting(admin, "meta_app_id");
      if (!appId || !(await getSecret(admin, "platform:meta_app_secret"))) {
        throw new HttpError(409, "A Clubetec ainda não ativou o login com o Facebook. Use a conexão manual ou peça ajuda.");
      }
      const state = randomHex(24);
      const { error } = await admin.from("oauth_states").insert({ state, organization_id: orgId, connector: `meta_${kind}`, user_id: ctx.user.id });
      if (error) throw new HttpError(500, "Não foi possível iniciar a conexão");
      const base = await setting(admin, "functions_base_url");
      const configId = await setting(admin, kind === "pages" ? "meta_login_config_pages" : "meta_login_config_whatsapp");
      const url = new URL(`https://www.facebook.com/${GRAPH.split("/").pop()}/dialog/oauth`);
      url.searchParams.set("client_id", appId);
      url.searchParams.set("redirect_uri", `${base}/meta-connect-callback`);
      url.searchParams.set("state", state);
      url.searchParams.set("response_type", "code");
      if (configId) {
        url.searchParams.set("config_id", configId);
        url.searchParams.set("override_default_response_type", "true");
      } else url.searchParams.set("scope", SCOPES[kind]);
      return json({ ok: true, url: url.toString() });
    }

    const sessId = String(body?.session ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(sessId)) throw new HttpError(400, "Conexão inválida");
    const { data: sess } = await admin.from("meta_connect_sessions").select("*").eq("id", sessId).maybeSingle();
    if (!sess || sess.user_id !== ctx.user.id) throw new HttpError(404, "Conexão não encontrada. Comece de novo.");
    await requirePermission(ctx, sess.organization_id, "org.settings");

    if (action === "cancel") {
      await admin.rpc("service_meta_connect_forget", { sess: sess.id });
      return json({ ok: true });
    }
    if (action !== "finish") throw new HttpError(400, "Ação inválida");
    if (new Date(sess.expires_at).getTime() < Date.now()) {
      await admin.rpc("service_meta_connect_forget", { sess: sess.id });
      throw new HttpError(410, "A conexão expirou. Clique em Conectar com o Facebook de novo.");
    }
    const choice = String(body?.choice ?? "");
    const opt = (sess.options as { id: string; waba_id?: string; label: string }[]).find((o) => o.id === choice);
    if (!opt) throw new HttpError(400, "Escolha uma das opções.");
    const userToken = await getSecret(admin, `metaconnect:${sess.id}:token`);
    if (!userToken) throw new HttpError(410, "A conexão expirou. Clique em Conectar com o Facebook de novo.");

    try {
      if (sess.kind === "pages") {
        // Token da Página a partir do acesso de quem fez o login (não expira).
        const res = await fetch(`${GRAPH}/${encodeURIComponent(opt.id)}?fields=access_token`, { headers: { Authorization: `Bearer ${userToken}` } });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d?.access_token) throw new HttpError(400, "A Meta não liberou o acesso a esta Página. Confira se você é administrador dela.");
        const r = await connectPage(admin, sess.organization_id, ctx.user.id, opt.id, String(d.access_token));
        return json({ ok: true, kind: "pages", ...r });
      }
      const r = await connectCloudNumber(admin, sess.organization_id, ctx.user.id, {
        phoneNumberId: opt.id, wabaId: String(opt.waba_id ?? ""), token: userToken, name: body?.name, via: "embedded_signup",
      });
      return json({ ok: true, kind: "whatsapp", ...r });
    } finally {
      await admin.rpc("service_meta_connect_forget", { sess: sess.id });
    }
  } catch (e) {
    if (e instanceof HttpError || e instanceof ConnectError) return json({ ok: false, error: e.message }, e.status);
    console.error("[meta-connect]", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Erro interno" }, 500);
  }
});
