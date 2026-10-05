import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { sha256Hex, withInstanceToken } from "../_shared/secrets.ts";
import { forOrg } from "../_shared/tenant.ts";
import { setContactField } from "../_shared/contact-fields.ts";
import * as providers from "../_shared/providers/index.ts";
import { getUazapiConfig } from "../_shared/get-uazapi-config.ts";

/**
 * API aberta do Deixa com a IA (docs/design/05-api-webhooks.md). Para servidores e
 * automações (n8n, Make, Zapier) — sem CORS de propósito: a chave não deve ir para
 * navegador. Autenticação: `Authorization: Bearer dca_...` (o banco guarda só o hash).
 * Tudo filtrado pela empresa da chave; permissões por chave; 60 chamadas/min por empresa.
 */
const res = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fail = (status: number, error: string) => res({ error }, status);
const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const clip = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);
const like = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const auth = req.headers.get("authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!/^dca_[0-9a-f]{40}$/.test(key)) return fail(401, "Chave de API ausente ou inválida.");
  const { data: k } = await admin.rpc("service_api_key_lookup", { hash: await sha256Hex(key) });
  if (!k) return fail(401, "Chave de API ausente ou inválida.");
  const orgId = String(k.organization_id);
  const scopes: string[] = k.scopes ?? [];
  const need = (s: string) => { if (!scopes.includes(s)) throw new Response(JSON.stringify({ error: `Esta chave não tem a permissão ${s}.` }), { status: 403 }); };
  const { data: allowed } = await admin.rpc("service_api_take", { org: orgId });
  if (allowed === false) return fail(429, "Limite de 60 chamadas por minuto.");

  const org = forOrg(admin, orgId);
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*?\/api(?=\/|$)/, "").replace(/\/+$/, "") || "/";
  const raw = req.method === "GET" ? {} : await req.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail(400, "Corpo deve ser um objeto JSON.");
  const body = raw as Record<string, unknown>;

  try {
    // ------------------------------------------------------------- contatos
    if (path === "/contacts" && req.method === "GET") {
      need("contacts:read");
      const phone = digits(url.searchParams.get("phone")), email = clip(url.searchParams.get("email"), 200).toLowerCase();
      if (!phone && !email) return fail(400, "Informe phone ou email.");
      let q = org.select("contacts", "id, name, phone, email, custom, opted_out_at, created_at");
      q = phone ? q.eq("phone", phone) : q.ilike("email", like(email));
      const { data } = await q.limit(5);
      return res({ data: data ?? [] });
    }
    if (path === "/contacts" && req.method === "POST") {
      need("contacts:write");
      const phone = digits(body.phone);
      if (phone.length < 10 || phone.length > 15) return fail(400, "phone obrigatório (só números, com DDI e DDD).");
      const { data: found } = await org.select("contacts", "id").eq("phone", phone).maybeSingle();
      let id = found?.id as string | undefined;
      if (!id) {
        const { data: created, error } = await org.insert("contacts", { phone, name: clip(body.name, 120) || null, email: clip(body.email, 200) || null }).select("id").single();
        if (error) return fail(400, "Não foi possível criar o contato.");
        id = created.id;
      } else {
        const patch: Record<string, unknown> = {};
        if (body.name) patch.name = clip(body.name, 120);
        if (body.email) patch.email = clip(body.email, 200);
        if (Object.keys(patch).length) await org.update("contacts", patch).eq("id", id);
      }
      const custom = body.custom && typeof body.custom === "object" ? Object.entries(body.custom as Record<string, unknown>).slice(0, 20) : [];
      const rejected: string[] = [];
      for (const [f, v] of custom) if (!(await setContactField(org, id!, `custom:${f}`, clip(v, 2000)))) rejected.push(f);
      await admin.from("audit_log").insert({ organization_id: orgId, actor_type: "system", agent_key: "api", action: "api.contact_upsert", target: id, meta: { key: k.key_id } });
      return res({ id, created: !found, rejected_fields: rejected }, found ? 200 : 201);
    }

    // ----------------------------------------------------------- conversas
    if (path === "/conversations" && req.method === "GET") {
      need("conversations:read");
      const since = url.searchParams.get("since");
      const lim = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 100);
      let q = org.select("conversations", "id, channel, contact_id, contact_name, contact_phone, contact_email, stage_id, department_id, last_message_at, created_at")
        .order("last_message_at", { ascending: false }).limit(lim);
      if (since && !Number.isNaN(Date.parse(since))) q = q.gte("last_message_at", new Date(since).toISOString());
      const [{ data }, { data: stages }] = await Promise.all([q, org.select("pipeline_stages", "id, name")]);
      const name = new Map(((stages ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]));
      return res({ data: ((data ?? []) as Record<string, unknown>[]).map((c) => ({ ...c, stage: c.stage_id ? name.get(String(c.stage_id)) ?? null : null })) });
    }
    const mStage = path.match(/^\/conversations\/([0-9a-f-]{36})\/stage$/i);
    if (mStage && req.method === "POST") {
      need("funnel:write");
      const convId = mStage[1];
      const { data: conv } = await org.select("conversations", "id").eq("id", convId).maybeSingle();
      if (!conv) return fail(404, "Conversa não encontrada.");
      let stageId = UUID.test(String(body.stage_id ?? "")) ? String(body.stage_id) : null;
      if (!stageId && body.stage) {
        const { data: st } = await org.select("pipeline_stages", "id").ilike("name", like(clip(body.stage, 80))).maybeSingle();
        stageId = st?.id ?? null;
      }
      if (!stageId && body.stage) {
        const { data: all } = await org.select("pipeline_stages", "name").order("position");
        return res({ error: "Etapa não encontrada nesta empresa.", stages: ((all ?? []) as { name: string }[]).map((s) => s.name) }, 400);
      }
      if (!stageId) return fail(400, "Informe stage_id ou stage (nome da etapa).");
      const { data: ok } = await org.select("pipeline_stages", "id").eq("id", stageId).maybeSingle();
      if (!ok) return fail(400, "Etapa não encontrada nesta empresa.");
      const { error } = await org.update("conversations", { stage_id: stageId }).eq("id", convId);
      if (error) return fail(400, "Não foi possível mover.");
      return res({ id: convId, stage_id: stageId });
    }

    // ------------------------------------------------------------ mensagens
    if (path === "/messages" && req.method === "POST") {
      need("messages:send");
      const phone = digits(body.phone);
      const text = clip(body.text, 4000);
      if (phone.length < 10 || phone.length > 15) return fail(400, "phone obrigatório (só números, com DDI e DDD).");
      if (!text && !body.template) return fail(400, "Informe text (ou template para número oficial fora das 24h).");
      const { data: ct } = await org.select("contacts", "id, opted_out_at").eq("phone", phone).maybeSingle();
      if (ct?.opted_out_at) return fail(409, "Este contato pediu para não receber mensagens automáticas.");
      let instQ = org.select("whatsapp_instances", "*").eq("status", "connected");
      if (UUID.test(String(body.instance_id ?? ""))) instQ = instQ.eq("id", String(body.instance_id));
      const { data: instRow } = await instQ.order("created_at").limit(1).maybeSingle();
      if (!instRow) return fail(409, "Nenhum número de WhatsApp conectado nesta empresa.");
      const inst = await withInstanceToken(admin, instRow);
      if (providers.providerOf(inst) === "uazapi" && !inst.server_url) {
        const uaz = await getUazapiConfig();
        inst.server_url = uaz?.serverUrl ?? null;
      }
      let { data: conv } = await org.select("conversations", "id, last_inbound_at").eq("instance_id", inst.id).eq("contact_phone", phone).maybeSingle();
      if (!conv) {
        ({ data: conv } = await org.insert("conversations", { instance_id: inst.id, contact_phone: phone, contact_name: clip(body.name, 120) || null, ai_enabled: true })
          .select("id, last_inbound_at").single());
      }
      const windowOpen = providers.isWindowOpen(inst, conv?.last_inbound_at ?? null);
      let sent;
      if (!windowOpen) {
        const t = body.template as { name?: string; language?: string; params?: unknown[] } | undefined;
        if (!t?.name || !/^[a-z0-9_]{1,100}$/.test(t.name)) return fail(409, "Número oficial: fora das 24h só modelo aprovado pela Meta (informe template.name).");
        sent = await providers.sendTemplate(inst, phone, { name: t.name, language: clip(t.language ?? "pt_BR", 10), bodyParams: (t.params ?? []).slice(0, 10).map((p) => clip(p, 200)) });
      } else {
        sent = await providers.sendText(inst, phone, text);
      }
      if (!sent.ok) return fail(502, `O WhatsApp não aceitou o envio: ${clip(sent.error, 200)}`);
      await org.insert("messages", {
        conversation_id: conv!.id, direction: "outbound", sender: "human", status: "sent",
        content: windowOpen ? text : `[Modelo] ${clip((body.template as { name?: string })?.name, 100)}`,
        provider_message_id: sent.messageId ?? null,
      });
      await org.update("conversations", { last_message_at: new Date().toISOString() }).eq("id", conv!.id);
      await admin.from("audit_log").insert({ organization_id: orgId, actor_type: "system", agent_key: "api", action: "api.message_sent", target: conv!.id, meta: { key: k.key_id } });
      return res({ conversation_id: conv!.id, message_id: sent.messageId ?? null }, 201);
    }

    return fail(404, "Caminho não encontrado. Veja a documentação em Configurações → API e webhooks.");
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("api:", e);
    return fail(500, "Erro interno");
  }
});
