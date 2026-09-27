import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getUazapiConfig } from "../_shared/get-uazapi-config.ts";
import { callGroq, getAgentConfig } from "../_shared/get-ai-config.ts";
import * as providers from "../_shared/providers/index.ts";
import { HttpError, requirePermission, requireUser, resolveOrg } from "../_shared/auth.ts";
import { forOrg } from "../_shared/tenant.ts";
import { putSecret, randomHex, sha256Hex, withInstanceToken } from "../_shared/secrets.ts";

/**
 * Operações num número de WhatsApp, sempre em nome de um usuário logado.
 *
 * O navegador manda só o instance_id: a organização vem da instância (banco),
 * a permissão é conferida com o JWT do usuário e o token sai do Vault. O token
 * nunca é aceito do corpo nem devolvido na resposta.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Ações e a permissão que cada uma exige. */
const PERMISSION: Record<string, string> = {
  send_text: "conversations.attend",
  create: "org.settings",
  connect: "org.settings",
  disconnect: "org.settings",
  delete: "org.settings",
  status: "org.settings",
  set_webhook: "org.settings",
  get_webhooks: "org.settings",
  diagnose: "org.settings",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const action: string = body?.action ?? "";
    const perm = PERMISSION[action];
    if (!perm) return json({ ok: false, error: "Ação inválida" });

    const ctx = await requireUser(req);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const globalConfig = await getUazapiConfig();

    // === CREATE (init) — não há instância ainda: organização do usuário ===
    if (action === "create") {
      const orgId = await resolveOrg(ctx, body?.organization_id);
      await requirePermission(ctx, orgId, perm);
      if (!body?.name) return json({ ok: false, error: "Nome da instância não informado" });
      if (!globalConfig?.serverUrl || !globalConfig?.adminToken) {
        return json({ ok: false, error: "Uazapi não configurada na plataforma." });
      }
      const res = await fetch(`${globalConfig.serverUrl}/instance/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json", AdminToken: globalConfig.adminToken },
        body: JSON.stringify({ name: body.name }),
      });
      const text = await res.text();
      console.log(`[create] status=${res.status}`);
      if (!res.ok) return json({ ok: false, error: "Falha ao criar instância" });
      const data = JSON.parse(text);
      const token: string | undefined = data?.token || data?.instance?.token;
      const { data: row, error } = await forOrg(admin, orgId)
        .insert("whatsapp_instances", {
          user_id: ctx.user.id,
          name: body.name,
          server_url: globalConfig.serverUrl,
          provider: "uazapi",
          status: "disconnected",
        })
        .select("id")
        .single();
      if (error || !row) return json({ ok: false, error: "Falha ao registrar a instância" });
      if (token) {
        await putSecret(admin, `instance:${row.id}:token`, token);
        await forOrg(admin, orgId)
          .update("whatsapp_instances", {
            secret_name: `instance:${row.id}:token`,
            token_hash: await sha256Hex(token),
          })
          .eq("id", row.id);
      }
      return json({ ok: true, instance_id: row.id });
    }

    // Demais ações: instância pelo id; organização e permissão a partir dela.
    const instanceId: string = body?.instance_id ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(instanceId)) return json({ ok: false, error: "instance_id inválido" }, 400);
    const { data: bare } = await admin.from("whatsapp_instances").select("*").eq("id", instanceId).maybeSingle();
    if (!bare) return json({ ok: false, error: "Número não encontrado" }, 404);
    const orgId: string = bare.organization_id;
    await requirePermission(ctx, orgId, perm);
    const org = forOrg(admin, orgId);

    const inst: any = await withInstanceToken(admin, bare);
    if (providers.providerOf(inst) === "uazapi" && !inst.server_url) {
      inst.server_url = globalConfig?.serverUrl ?? null; // instância antiga sem config própria
    }
    const baseUrl: string | null = inst.server_url ? String(inst.server_url).replace(/\/$/, "") : null;
    const token: string | null = inst.instance_token;

    console.log(`[manage-instance] action=${action} provider=${inst.provider}`);

    // === SEND TEXT (Uazapi ou Cloud, pelo provedor do número) ===
    if (action === "send_text") {
      const { number, text } = body;
      if (!number || !text) return json({ ok: false, error: "Número e texto são obrigatórios" });
      // O destino tem de ser uma conversa deste número nesta organização.
      const { data: conv } = await org
        .select("conversations", "id, last_inbound_at")
        .eq("instance_id", inst.id)
        .eq("contact_phone", String(number))
        .maybeSingle();
      if (!conv) return json({ ok: false, error: "Conversa não encontrada para este número" }, 404);
      if (!providers.isWindowOpen(inst, conv.last_inbound_at)) {
        return json({ ok: false, error: "Janela de 24h fechada: só modelo aprovado pela Meta." });
      }
      const sent = await providers.sendText(inst, String(number), String(text));
      if (!sent.ok) {
        console.error("[send_text] falhou", { code: sent.code });
        return json({ ok: false, error: sent.error || "Falha ao enviar mensagem" });
      }
      return json({ ok: true, success: true });
    }

    // Daqui em diante, só Uazapi (a Cloud API não tem estas operações).
    if (providers.providerOf(inst) !== "uazapi") {
      if (action === "diagnose") return json({ ok: true, checks: await diagnose(inst, orgId, null, null) });
      return json({ ok: false, error: "Ação disponível só para números Uazapi" });
    }
    if (!baseUrl || !token) return json({ ok: false, error: "Número sem servidor ou token configurado" });

    const uaz = (path: string, init: RequestInit = {}) =>
      fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", token, ...(init.headers || {}) },
      });

    if (action === "connect") {
      const res = await uaz("/instance/connect", {
        method: "POST",
        body: JSON.stringify(body?.phone ? { phone: String(body.phone) } : {}),
      });
      const text = await res.text();
      console.log(`[connect] status=${res.status}`);
      if (!res.ok) {
        if (res.status === 401) {
          return json({
            ok: false,
            code: "INSTANCE_TOKEN_INVALID",
            error: "A instância do WhatsApp expirou no servidor. Remova a instância atual e crie uma nova.",
          });
        }
        return json({ ok: false, error: "Falha ao conectar" });
      }
      const data = JSON.parse(text);
      const paircode = data.instance?.paircode || data.paircode || null;
      const alreadyConnected = data.connected === true || data.status?.connected === true || data.loggedIn === true;
      return json({ ok: true, success: true, paircode, already_connected: alreadyConnected });
    }

    if (action === "disconnect") {
      const res = await uaz("/instance/disconnect", { method: "POST" });
      console.log(`[disconnect] status=${res.status}`);
      return json({ ok: true, success: true });
    }

    if (action === "delete") {
      try {
        const res = await uaz("/instance", { method: "DELETE" });
        console.log(`[delete] status=${res.status}`);
      } catch {
        // melhor esforço
      }
      return json({ ok: true, success: true });
    }

    if (action === "status") {
      const res = await uaz("/instance/status", { method: "GET" });
      const text = await res.text();
      console.log(`[status] status=${res.status}`);
      if (!res.ok) return json({ ok: false, error: "Falha ao verificar status" });
      const data = JSON.parse(text);
      const statusObj = data?.status;
      const instanceStatus = data?.instance?.status;
      const connectedWords = ["open", "connected", "CONNECTED"];
      const isConnected =
        (typeof statusObj === "object" && statusObj?.connected === true) ||
        (typeof statusObj === "string" && connectedWords.includes(statusObj)) ||
        (typeof instanceStatus === "string" && connectedWords.includes(instanceStatus)) ||
        data?.loggedIn === true ||
        data?.instance?.loggedIn === true;
      // Só o necessário para a tela; a resposta crua pode conter o token.
      const i = data?.instance ?? {};
      return json({
        ok: true,
        connected: isConnected,
        name: i.name || data?.name || null,
        phone: i.owner || data?.owner || null,
        profile_name: i.profileName || null,
      });
    }

    if (action === "set_webhook") {
      // Segredo novo a cada configuração: a URL antiga deixa de valer.
      const secret = randomHex(32);
      if (!(await putSecret(admin, `instance:${inst.id}:webhook`, secret))) {
        return json({ ok: false, error: "Falha ao gravar o segredo do webhook" });
      }
      const webhookUrl =
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-webhook?i=${inst.id}&k=${secret}`;
      // addUrlEvents PRECISA ser false: com true a Uazapi posta em {url}/messages.
      const res = await uaz("/webhook", {
        method: "POST",
        body: JSON.stringify({
          enabled: true,
          url: webhookUrl,
          events: ["messages", "connection"],
          excludeMessages: ["wasSentByApi"],
          addUrlEvents: false,
        }),
      });
      console.log(`[set_webhook] status=${res.status}`);
      if (!res.ok) return json({ ok: false, error: "Falha ao configurar webhook" });
      return json({ ok: true, success: true });
    }

    if (action === "get_webhooks") {
      const res = await uaz("/webhook", { method: "GET", headers: { Accept: "application/json" } });
      if (!res.ok) return json({ ok: false, error: "Falha ao buscar webhooks" });
      const hooks = await res.json().catch(() => []);
      // A URL cadastrada contém o segredo: devolve só se está ativo e autenticado.
      const list = (Array.isArray(hooks) ? hooks : [hooks]).map((h: any) => ({
        enabled: !!h?.enabled,
        authenticated: typeof h?.url === "string" && h.url.includes("k="),
        events: h?.events ?? [],
      }));
      return json({ ok: true, success: true, webhooks: list });
    }

    if (action === "diagnose") {
      return json({ ok: true, checks: await diagnose(inst, orgId, baseUrl, token) });
    }

    return json({ ok: false, error: "Ação inválida" });
  } catch (error) {
    if (error instanceof HttpError) return json({ ok: false, error: error.message }, error.status);
    console.error("manage-instance error:", error instanceof Error ? error.message : error);
    return json({ ok: false, error: "Erro interno" }, 500);
  }
});

/** Os 4 checks que a tela de configuração mostra. */
async function diagnose(inst: any, orgId: string, baseUrl: string | null, token: string | null) {
  const checks: any = {
    instance: { ok: true, instance_name: inst.name, matched_by: "id", name_mismatch: false },
    agent: { ok: false, has_key: false, enabled: false },
    groq: { ok: false },
    uazapi: { ok: false },
  };

  const agent = await getAgentConfig(orgId);
  checks.agent.has_key = !!agent?.apiKey;
  checks.agent.enabled = !!agent?.enabled;
  checks.agent.ok = checks.agent.has_key && checks.agent.enabled;
  if (!checks.agent.has_key) checks.agent.error = "Chave da Groq não configurada";
  else if (!checks.agent.enabled) checks.agent.error = "Agente não está ativo";

  if (agent?.apiKey) {
    const r = await callGroq(agent.apiKey, agent.model, [
      { role: "system", content: "Responda apenas: ok" },
      { role: "user", content: "ping" },
    ]);
    checks.groq.ok = r.ok;
    if (!r.ok) checks.groq.error = r.error;
  } else {
    checks.groq.error = "Sem chave para testar";
  }

  if (providers.providerOf(inst) !== "uazapi") {
    checks.uazapi = { ok: true, note: "Número da Cloud API" };
  } else if (!baseUrl || !token) {
    checks.uazapi.error = "Server URL ou token da instância ausente";
  } else {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${baseUrl}/instance/status`, { headers: { token }, signal: ctrl.signal });
      clearTimeout(t);
      await res.text().catch(() => "");
      checks.uazapi.ok = res.ok;
      checks.uazapi.status = res.status;
      if (!res.ok) checks.uazapi.error = `Uazapi retornou HTTP ${res.status}`;
    } catch (e: any) {
      checks.uazapi.error = e?.message || "Falha ao conectar na Uazapi";
    }
  }
  return checks;
}
