import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { CONNECTORS, tokenRequest } from "../_shared/connectors.ts";

/**
 * Retorno do login OAuth do conector (sem JWT: vem do navegador do dono, via
 * o sistema externo). Só aceita "state" existente, não vencido e de uso único;
 * a organização vem do state, nunca da URL. Volta para a tela Integrações.
 */

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: appUrl } = await admin.from("app_settings").select("value").eq("key", "app_url").maybeSingle();
  const back = (params: Record<string, string>) =>
    Response.redirect(`${String(appUrl?.value ?? "").replace(/\/$/, "")}/integracoes?${new URLSearchParams(params)}`, 302);

  const u = new URL(req.url);
  const state = u.searchParams.get("state") ?? "";
  const code = u.searchParams.get("code") ?? "";
  if (!/^[0-9a-f]{48}$/.test(state)) return back({ status: "erro", msg: "link de conexão inválido" });

  // Uso único: apaga e devolve; vencido não serve.
  const { data: st } = await admin.from("oauth_states").delete().eq("state", state).select().maybeSingle();
  if (!st || new Date(st.expires_at).getTime() < Date.now()) return back({ status: "erro", msg: "a conexão expirou, tente de novo" });
  const c = CONNECTORS[st.connector];
  if (!c) return back({ status: "erro", msg: "conector desconhecido" });
  if (!code) return back({ conector: st.connector, status: "erro", msg: u.searchParams.get("error") ? "autorização negada" : "sem código" });

  const { data: base } = await admin.from("app_settings").select("value").eq("key", "functions_base_url").maybeSingle();
  const r = await tokenRequest(admin, st.organization_id, st.connector, {
    grant_type: "authorization_code", code, redirect_uri: `${base?.value}/connectors-callback`,
  });
  if (r.ok) {
    await admin.from("org_connections").update({ connected_by: st.user_id, connected_at: new Date().toISOString() })
      .eq("organization_id", st.organization_id).eq("connector", st.connector);
  }
  await admin.from("audit_log").insert({
    organization_id: st.organization_id, actor_id: st.user_id, action: "connector.connect", target: st.connector, meta: { ok: r.ok },
  });
  return back(r.ok ? { conector: st.connector, status: "ok" } : { conector: st.connector, status: "erro", msg: r.error ?? "falha" });
});
