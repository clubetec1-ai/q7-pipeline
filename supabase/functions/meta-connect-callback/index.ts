import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getSecret, putSecret } from "../_shared/secrets.ts";
import { GRAPH } from "../_shared/meta-connect.ts";

/**
 * Retorno do login com o Facebook (sem JWT: vem do navegador, via a Meta). Só aceita
 * "state" existente, não vencido e de uso único; a empresa vem do state, nunca da URL.
 * Troca o código por um token (guardado no Vault por 15 min), lista as Páginas ou os
 * números que a pessoa liberou e volta para a tela Números para ela escolher.
 */
// deno-lint-ignore no-explicit-any
type Any = any;

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const setting = async (key: string) => String((await admin.from("app_settings").select("value").eq("key", key).maybeSingle()).data?.value ?? "").trim();
  const appUrl = (await setting("app_url")).replace(/\/$/, "");
  const back = (params: Record<string, string>) => Response.redirect(`${appUrl}/numeros?${new URLSearchParams(params)}`, 302);

  const u = new URL(req.url);
  const state = u.searchParams.get("state") ?? "";
  const code = u.searchParams.get("code") ?? "";
  if (!/^[0-9a-f]{48}$/.test(state)) return back({ meta_erro: "link de conexão inválido" });
  const { data: st } = await admin.from("oauth_states").delete().eq("state", state).select().maybeSingle();
  if (!st || new Date(st.expires_at).getTime() < Date.now() || !String(st.connector).startsWith("meta_")) {
    return back({ meta_erro: "a conexão expirou, tente de novo" });
  }
  if (!code) return back({ meta_erro: u.searchParams.get("error") ? "você não autorizou no Facebook" : "a Meta não devolveu a autorização" });
  const kind = st.connector === "meta_whatsapp" ? "whatsapp" : "pages";

  const appId = await setting("meta_app_id");
  const secret = await getSecret(admin, "platform:meta_app_secret");
  const base = await setting("functions_base_url");
  if (!appId || !secret) return back({ meta_erro: "login com o Facebook não configurado" });

  try {
    // 1. Código → token, trocado por um de longa duração (os tokens das Páginas tirados dele não vencem).
    const tok = await getJson(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
      client_id: appId, client_secret: secret, redirect_uri: `${base}/meta-connect-callback`, code,
    }));
    let token = String(tok?.access_token ?? "");
    if (!token) return back({ meta_erro: "a Meta recusou a autorização" });
    {
      // Token de longa duração (com a configuração "token de usuário do sistema" da Meta, ele já não vence e isto não muda nada).
      const ll = await getJson(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
        grant_type: "fb_exchange_token", client_id: appId, client_secret: secret, fb_exchange_token: token,
      }));
      if (ll?.access_token) token = String(ll.access_token);
    }

    // 2. O que a pessoa liberou: Páginas (com Instagram) ou números do WhatsApp.
    let options: { id: string; waba_id?: string; label: string }[] = [];
    if (kind === "pages") {
      const pages = await getJson(`${GRAPH}/me/accounts?fields=id,name,instagram_business_account{username}&limit=50`, token);
      options = ((pages?.data ?? []) as Any[]).filter((p) => /^[0-9]{5,30}$/.test(String(p.id))).map((p) => ({
        id: String(p.id), label: `${String(p.name ?? "Página").slice(0, 100)}${p.instagram_business_account?.username ? ` · Instagram @${p.instagram_business_account.username}` : ""}`,
      }));
    } else {
      const dbg = await getJson(`${GRAPH}/debug_token?` + new URLSearchParams({ input_token: token, access_token: `${appId}|${secret}` }));
      const wabas = new Set<string>();
      for (const g of (dbg?.data?.granular_scopes ?? []) as Any[]) {
        if (String(g.scope).startsWith("whatsapp_business")) for (const id of g.target_ids ?? []) wabas.add(String(id));
      }
      for (const waba of [...wabas].filter((w) => /^[0-9]{5,25}$/.test(w)).slice(0, 10)) {
        const nums = await getJson(`${GRAPH}/${waba}/phone_numbers?fields=id,display_phone_number,verified_name`, token);
        for (const n of (nums?.data ?? []) as Any[]) {
          if (/^[0-9]{5,25}$/.test(String(n.id))) {
            options.push({ id: String(n.id), waba_id: waba, label: `${String(n.verified_name ?? "WhatsApp").slice(0, 80)} · ${String(n.display_phone_number ?? "").slice(0, 30)}` });
          }
        }
      }
    }
    if (!options.length) {
      return back({ meta_erro: kind === "pages" ? "nenhuma Página liberada no login (marque a Página ao autorizar)" : "nenhum número do WhatsApp liberado no login" });
    }

    // 3. Guarda as opções (sem token) e o token no Vault por 15 min; a pessoa escolhe na tela.
    const { data: sess, error } = await admin.from("meta_connect_sessions")
      .insert({ organization_id: st.organization_id, user_id: st.user_id, kind, options }).select("id").single();
    if (error || !sess) return back({ meta_erro: "não foi possível continuar a conexão" });
    if (!(await putSecret(admin, `metaconnect:${sess.id}:token`, token))) {
      await admin.rpc("service_meta_connect_forget", { sess: sess.id });
      return back({ meta_erro: "não foi possível guardar o acesso com segurança" });
    }
    await admin.from("audit_log").insert({ organization_id: st.organization_id, actor_id: st.user_id, action: "meta.login", target: kind, meta: { options: options.length } });
    return back({ meta: sess.id });
  } catch (e) {
    console.error("[meta-connect-callback]", e instanceof Error ? e.message.slice(0, 200) : e);
    return back({ meta_erro: "não consegui falar com a Meta, tente de novo" });
  }
});

async function getJson(url: string, token?: string): Promise<Any> {
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(15_000) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) console.warn("[meta-connect-callback] Meta", { status: res.status, code: d?.error?.code });
  return res.ok ? d : null;
}
