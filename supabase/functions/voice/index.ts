import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { requireModule } from "../_shared/modules.ts";
import { HttpError, permissionsIn, requireUser } from "../_shared/auth.ts";
import { forOrg } from "../_shared/tenant.ts";
import * as providers from "../_shared/providers/index.ts";
import { instForSend } from "../_shared/flow/executor.ts";
import { brDate, fetchHistory, nationalNumber, NvoipError, nvoipFetch, nvoipToken } from "../_shared/nvoip.ts";

/**
 * Ramal — ações do atendente durante a ligação.
 *  - whatsapp_hello: manda um "olá" no WhatsApp do número que está na linha, para
 *    continuar o atendimento por lá. Usa a conversa existente (se a pessoa pode
 *    vê-la) ou abre uma nova já com o atendente; liga a conversa à ligação.
 * Cliente de outro setor não é tocado (pede transferência); quem pediu para não
 * receber mensagens e ficha anonimizada são respeitados (LGPD).
 *  - click_to_call: pela API da Nvoip, toca o ramal do atendente (MicroSIP) e,
 *    quando ele atende, liga para o cliente. Registra a ligação.
 *  - nvoip_test (dono/admin): confere a credencial e devolve só os NOMES dos
 *    campos do histórico (para ajustar a leitura), nunca números ou valores.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const DEFAULT_HELLO = "Olá{, nome}! Aqui é {atendente}. Como combinamos na ligação, sigo o seu atendimento por aqui. 😊";

/** Número brasileiro para o WhatsApp: só dígitos, com 55 quando vier só DDD + número. */
function waNumber(raw: string) {
  let d = raw.replace(/\D/g, "").replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    const orgId = String(body?.org_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw new HttpError(400, "Empresa inválida");
    const ctx = await requireUser(req);
    const perms = await permissionsIn(ctx, orgId);
    if (!perms.includes("conversations.attend")) throw new HttpError(403, "Sem permissão para atender");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await requireModule(admin, orgId, "telefonia");
    const org = forOrg(admin, orgId);

    if (action === "nvoip_test") {
      if (!perms.includes("org.settings")) throw new HttpError(403, "Só dono ou admin");
      const token = await nvoipToken(admin, orgId);
      const { items, format } = await fetchHistory(token, brDate(0));
      await admin.from("voice_integrations").update({ last_error: null }).eq("organization_id", orgId);
      return json({ ok: true, calls_today: items.length, format,
        item_fields: items[0] ? Object.keys(items[0]).filter((k) => k !== "__dir").slice(0, 40) : [] });
    }

    if (action === "click_to_call") {
      const { data: ext } = await org.select("pbx_extensions", "id, number, sip_user, provider").eq("user_id", ctx.user.id).maybeSingle();
      if (!ext) throw new HttpError(409, "Você não tem ramal");
      if (ext.provider !== "nvoip") throw new HttpError(409, "Clique-para-ligar disponível só para ramal Nvoip");
      const called = nationalNumber(String(body?.phone ?? ""));
      if (called.length < 8 || called.length > 13) throw new HttpError(400, "Número inválido");
      const token = await nvoipToken(admin, orgId);
      const res = await nvoipFetch(token, "/calls/click-to-call", {
        method: "POST", body: JSON.stringify({ caller: ext.sip_user || ext.number, called }),
      });
      const providerId = res?.callId ?? res?.call_id ?? res?.id ?? res?.data?.callId ?? null;
      const { data: callId } = await ctx.userClient.rpc("log_call", {
        org: orgId, call: null, p_direction: "out", p_phone: called, p_status: "ringing", p_source: "sip",
      });
      if (callId && providerId) await org.update("calls", { provider_call_id: `nvoip:${providerId}`, source: "pbx" }).eq("id", callId);
      return json({ ok: true, call_id: callId ?? null });
    }

    if (action !== "whatsapp_hello") throw new HttpError(400, "Ação inválida");
    const phone = waNumber(String(body?.phone ?? ""));
    if (phone.length < 12 || phone.length > 15) throw new HttpError(400, "Número inválido para WhatsApp");
    const callId = body?.call_id ? String(body.call_id) : null;
    if (callId && !/^[0-9a-f-]{36}$/i.test(callId)) throw new HttpError(400, "Ligação inválida");

    // Cliente já conhecido: só se a pessoa puder vê-lo.
    const { data: found } = await ctx.userClient.rpc("lookup_caller", { org: orgId, p_phone: phone });
    const known = (found ?? [])[0] as { contact_id: string; name: string | null; conversation_id: string | null } | undefined;
    const { data: anyContact } = await org.select("contacts", "id, name, opted_out_at, anonymized_at").eq("phone", phone).maybeSingle();
    if (anyContact && !known) throw new HttpError(403, "Este cliente é atendido por outro setor. Peça a transferência.");
    if (anyContact?.anonymized_at) throw new HttpError(409, "Ficha anonimizada (LGPD): não é possível enviar.");
    if (anyContact?.opted_out_at) throw new HttpError(409, "O cliente pediu para não receber mensagens.");

    // Conversa de WhatsApp existente e visível; senão, um número de WhatsApp ativo da empresa.
    let conv: { id: string; instance_id: string; last_inbound_at: string | null } | null = null;
    if (known?.contact_id) {
      const { data } = await ctx.userClient.from("conversations").select("id, instance_id, last_inbound_at")
        .eq("organization_id", orgId).eq("contact_id", known.contact_id).eq("channel", "whatsapp")
        .order("last_message_at", { ascending: false }).limit(1).maybeSingle();
      conv = data ?? null;
    }
    const instQ = org.select("whatsapp_instances").neq("status", "disabled");
    const { data: bare } = conv?.instance_id
      ? await org.select("whatsapp_instances").eq("id", conv.instance_id).maybeSingle()
      : await instQ.order("created_at").limit(1).maybeSingle();
    if (!bare || bare.status === "disabled") throw new HttpError(409, "Nenhum número de WhatsApp ativo na empresa.");
    const inst = await instForSend(admin, bare);
    if (providers.providerOf(inst) === "cloud") {
      const open = conv?.last_inbound_at && Date.now() - new Date(conv.last_inbound_at).getTime() < 24 * 3600_000;
      if (!open) throw new HttpError(409, "Número oficial da Meta: fora da janela de 24h só com modelo (use Campanhas).");
    }

    const [{ data: m }, { data: o }] = await Promise.all([
      org.select("organization_members", "display_name").eq("user_id", ctx.user.id).maybeSingle(),
      admin.from("organizations").select("name, settings").eq("id", orgId).maybeSingle(),
    ]);
    const first = (s?: string | null) => String(s ?? "").trim().split(/\s+/)[0] ?? "";
    const attendant = first(m?.display_name) || first(ctx.user.email?.split("@")[0]) || "a equipe";
    const tpl = String(o?.settings?.call_hello_text || DEFAULT_HELLO);
    const nome = first(known?.name ?? anyContact?.name);
    const text = tpl.replace("{, nome}", nome ? `, ${nome}` : "").replaceAll("{nome}", nome)
      .replaceAll("{atendente}", attendant).replaceAll("{empresa}", String(o?.name ?? "")).slice(0, 1000);

    const res = await providers.sendText(inst, phone, text);
    if (!conv) {
      const { data: created } = await org.insert("conversations", {
        instance_id: inst.id, contact_phone: phone, contact_name: known?.name ?? null, ai_enabled: false,
        assigned_to: ctx.user.id, last_message_at: new Date().toISOString(),
      }).select("id, instance_id, last_inbound_at").single();
      conv = created ?? null;
    }
    if (conv) {
      await org.insert("messages", {
        conversation_id: conv.id, direction: "outbound", sender: "human", sent_by: ctx.user.id, content: text,
        status: res.ok ? "sent" : "failed", provider_message_id: res.messageId ?? null,
        error: res.ok ? null : String(res.error ?? "falha").slice(0, 300),
      });
      if (callId) await org.update("calls", { conversation_id: conv.id }).eq("id", callId).eq("user_id", ctx.user.id);
    }
    if (!res.ok) throw new HttpError(502, `WhatsApp recusou: ${String(res.error ?? "falha").slice(0, 120)}`);
    return json({ ok: true, conversation_id: conv?.id ?? null });
  } catch (e) {
    if (e instanceof NvoipError) return json({ ok: false, error: e.message }, 502);
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error("voice:", e);
    return json({ ok: false, error: e instanceof HttpError ? e.message : "Erro interno" }, status);
  }
});
