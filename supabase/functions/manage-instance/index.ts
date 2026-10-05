import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getUazapiConfig } from "../_shared/get-uazapi-config.ts";
import { getAgentProfile } from "../_shared/get-ai-config.ts";
import { chatAI, resolveAI } from "../_shared/ai-chat.ts";
import * as providers from "../_shared/providers/index.ts";
import { HttpError, permissionsIn, requirePermission, requireUser, resolveOrg } from "../_shared/auth.ts";
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
  // Modelos aprovados na conta da Meta (para campanhas no número oficial).
  templates: "campaigns.manage",
  // Excluir apaga as conversas do número: só o dono (org.billing é exclusiva do owner).
  remove: "org.billing",
};

/**
 * Configura o webhook da Uazapi com segredo novo. O segredo só vai para o
 * Vault depois que a Uazapi aceita a URL (senão o número ficaria recebendo
 * com o segredo antigo e tomando 401).
 */
async function configureWebhook(admin: any, instId: string, baseUrl: string, token: string): Promise<boolean> {
  const secret = randomHex(32);
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-webhook?i=${instId}&k=${secret}`;
  // addUrlEvents PRECISA ser false: com true a Uazapi posta em {url}/messages.
  const res = await fetch(`${baseUrl}/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token },
    body: JSON.stringify({
      enabled: true,
      url,
      events: ["messages", "connection"],
      excludeMessages: ["wasSentByApi"],
      addUrlEvents: false,
    }),
  });
  console.log(`[webhook] status=${res.status}`);
  if (!res.ok) return false;
  return (await putSecret(admin, `instance:${instId}:webhook`, secret)) ||
    (await putSecret(admin, `instance:${instId}:webhook`, secret));
}

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
      const { data: canAdd } = await admin.rpc("service_can_add_number", { org: orgId });
      if (canAdd !== true) return json({ ok: false, error: "Limite de números do seu plano atingido." }, 409);
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
          connected_via: "qr",
          color: body?.color ?? null,
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
        // Webhook autenticado já na criação: o usuário não configura nada.
        const hooked = await configureWebhook(admin, row.id, globalConfig.serverUrl, token);
        if (!hooked) console.error("[create] webhook nao configurado", { id: row.id });
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

    // === TEMPLATES (número oficial): modelos APROVADOS da conta, só leitura ===
    if (action === "templates") {
      if (providers.providerOf(inst) !== "cloud") return json({ ok: false, error: "Só o número oficial da Meta usa modelos." }, 400);
      if (!inst.waba_id || !token) return json({ ok: false, error: "Número oficial sem conta da Meta ligada." }, 400);
      const url = `https://graph.facebook.com/${providers.GRAPH_VERSION}/${encodeURIComponent(inst.waba_id)}/message_templates` +
        "?status=APPROVED&limit=100&fields=name,language,category,components";
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        console.error("[templates]", res.status);
        return json({ ok: false, error: "A Meta não devolveu os modelos agora. Tente de novo." }, 502);
      }
      const data = await res.json().catch(() => ({}));
      // deno-lint-ignore no-explicit-any
      const list = (Array.isArray(data?.data) ? data.data : []).map((t: any) => {
        // deno-lint-ignore no-explicit-any
        const bodyText = String((t.components ?? []).find((c: any) => c?.type === "BODY")?.text ?? "");
        return {
          name: String(t.name ?? "").slice(0, 512), language: String(t.language ?? "").slice(0, 10),
          category: String(t.category ?? "").slice(0, 40), body: bodyText.slice(0, 1024),
          params: (bodyText.match(/\{\{\d+\}\}/g) ?? []).length,
        };
      }).filter((t: { name: string; language: string }) => /^[a-z0-9_]{1,512}$/.test(t.name) && /^[a-z]{2}(_[A-Z]{2})?$/.test(t.language));
      return json({ ok: true, templates: list });
    }

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
      // Responder assume o atendimento se ninguém está com ele; atendimento de
      // outra pessoa só com permissão de supervisor ou acima.
      const { data: ticket } = await org
        .select("tickets", "id, status, assigned_to")
        .eq("conversation_id", conv.id)
        .neq("status", "closed")
        .maybeSingle();
      if (ticket && ticket.assigned_to !== ctx.user.id) {
        if (!ticket.assigned_to) {
          const { error: claimErr } = await ctx.userClient.rpc("claim_ticket", { ticket: ticket.id });
          if (claimErr) return json({ ok: false, error: claimErr.message }, 409);
        } else if (!(await permissionsIn(ctx, orgId)).includes("conversations.reassign")) {
          return json({ ok: false, error: "Este atendimento está com outra pessoa." }, 403);
        }
      }
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

    // === REMOVE (owner): apaga o número, as conversas dele e os segredos ===
    if (action === "remove") {
      // Confirmação digitada: o telefone (ou o nome, se ainda não conectou).
      const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
      const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
      const ok = inst.phone
        ? digits(body?.confirm) === digits(inst.phone)
        : norm(body?.confirm) === norm(inst.name);
      if (!ok) return json({ ok: false, error: "Digite o telefone do número para confirmar a exclusão." }, 400);
      if (providers.providerOf(inst) === "uazapi" && baseUrl && token) {
        try {
          await fetch(`${baseUrl}/instance`, { method: "DELETE", headers: { token } });
        } catch {
          // melhor esforço: a instância pode já não existir na Uazapi
        }
      }
      await admin.rpc("service_delete_instance_secrets", { instance: inst.id });
      const { error } = await org.delete("whatsapp_instances").eq("id", inst.id);
      if (error) return json({ ok: false, error: "Não foi possível excluir o número" }, 500);
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
      // QR Code (data URL da Uazapi) quando não foi informado telefone.
      const qrcode = data.instance?.qrcode || data.qrcode || null;
      const alreadyConnected = data.connected === true || data.status?.connected === true || data.loggedIn === true;
      return json({ ok: true, success: true, paircode, qrcode, already_connected: alreadyConnected });
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
      if (!(await configureWebhook(admin, inst.id, baseUrl, token))) {
        return json({ ok: false, error: "Falha ao configurar webhook" });
      }
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

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const [ai, profile] = await Promise.all([resolveAI(admin, orgId), getAgentProfile(admin, orgId)]);
  checks.agent.has_key = !!ai;
  checks.agent.enabled = !!profile?.enabled;
  checks.agent.ok = checks.agent.has_key && checks.agent.enabled;
  if (!checks.agent.has_key) checks.agent.error = "IA não configurada (chave própria ou IA da Clubetec)";
  else if (!checks.agent.enabled) checks.agent.error = "Agente não está ativo";

  if (ai) {
    const r = await chatAI(ai, [
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
