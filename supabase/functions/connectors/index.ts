import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { HttpError, requirePermission, requireUser, resolveOrg } from "../_shared/auth.ts";
import { forOrg } from "../_shared/tenant.ts";
import { appCredentials, CONNECTORS, runConnectorAction } from "../_shared/connectors.ts";

/**
 * Conectores prontos (org.settings): listar, iniciar o login OAuth (state de
 * uso único), testar uma ação com um telefone e desconectar.
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
    const action = String(body?.action ?? "");
    const ctx = await requireUser(req);
    const orgId = await resolveOrg(ctx, body?.organization_id);
    await requirePermission(ctx, orgId, "org.settings");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const org = forOrg(admin, orgId);

    if (action === "list") {
      const [{ data: apps }, { data: conns }] = await Promise.all([
        admin.rpc("connector_apps_status"),
        org.select("org_connections", "connector, status, error, connected_at"),
      ]);
      const catalog = Object.entries(CONNECTORS).map(([key, c]) => ({
        key, name: c.name, beta: !!c.beta, description: c.description,
        app_ready: !!(apps as Record<string, boolean> | null)?.[key],
        connection: (conns ?? []).find((x: { connector: string }) => x.connector === key) ?? null,
        actions: Object.entries(c.actions).map(([k, a]) => ({ key: k, label: a.label, description: a.description, outputs: a.outputs })),
      }));
      return json({ ok: true, catalog });
    }

    const key = String(body?.connector ?? "");
    const c = CONNECTORS[key];
    if (!c) throw new HttpError(400, "Conector desconhecido");

    if (action === "authorize") {
      const app = await appCredentials(admin, key);
      if (!app) throw new HttpError(409, `A Clubetec ainda não ativou o conector ${c.name}. Peça em “Pedir ajuda ao time Clubetec”.`);
      const state = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, "0")).join("");
      const { error } = await admin.from("oauth_states").insert({ state, organization_id: orgId, connector: key, user_id: ctx.user.id });
      if (error) throw new HttpError(500, "Não foi possível iniciar a conexão");
      const { data: base } = await admin.from("app_settings").select("value").eq("key", "functions_base_url").maybeSingle();
      const url = new URL(c.oauth.authorize);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", app.id);
      url.searchParams.set("state", state);
      url.searchParams.set("redirect_uri", `${base?.value}/connectors-callback`);
      return json({ ok: true, url: url.toString() });
    }

    if (action === "test") {
      const r = await runConnectorAction(admin, orgId, key, String(body?.connector_action ?? ""), {
        phone: String(body?.phone ?? ""), vars: {},
      });
      return json({ ok: true, result: r });
    }

    if (action === "disconnect") {
      await org.update("org_connections", { status: "disconnected", error: null }).eq("connector", key);
      await admin.from("audit_log").insert({ organization_id: orgId, actor_id: ctx.user.id, action: "connector.disconnect", target: key });
      return json({ ok: true });
    }
    throw new HttpError(400, "Ação inválida");
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    console.error("[connectors]", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Erro inesperado" }, 500);
  }
});
