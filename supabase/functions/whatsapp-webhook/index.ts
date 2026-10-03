import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { moduleOn } from "../_shared/modules.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getAgentProfile } from "../_shared/get-ai-config.ts";
import { audioAI, chatAI, recordUsage, resolveAI } from "../_shared/ai-chat.ts";
import { cancelPendingFollowups, scheduleInactivityFollowup } from "../_shared/followups.ts";
import * as providers from "../_shared/providers/index.ts";
import { transcribeAudio } from "../_shared/transcribe.ts";
import { LIMITS, storeMedia } from "../_shared/media.ts";
import { handleOptOut, instForSend, runFlow, runPostClose, withProtocol } from "../_shared/flow/executor.ts";
import { toChatText } from "../_shared/ai-policy.ts";
import { companyKnowledge } from "../_shared/company.ts";
import { readMedia, withMediaText } from "../_shared/media-read.ts";
import { knowledgeContext } from "../_shared/knowledge.ts";
import { forOrg, type OrgScope } from "../_shared/tenant.ts";
import { getSecret, hasSecret, hmacSha256Hex, safeEqual, sha256Hex } from "../_shared/secrets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, token",
};

function normalizeName(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function ok(body: any = { ok: true }) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Converte JID do WhatsApp em telefone. Retorna "" quando o JID não é um número (@g.us, @lid). */
function jidToPhone(jid: string | null | undefined) {
  const raw = String(jid || "");
  if (!raw) return "";
  if (raw.includes("@g.us") || raw.includes("@lid")) return "";
  return raw.replace(/@.*/, "").replace(/:.*/, "").replace(/\D/g, "");
}

/** O campo `content` da Uazapi chega como string JSON (ex: '{"text":"oi"}') em vários tipos. */
function readContent(content: any): string | null {
  if (!content) return null;
  if (typeof content === "object") return content.text ?? null;
  const s = String(content).trim();
  if (!s.startsWith("{")) return s || null;
  try {
    return JSON.parse(s)?.text ?? null;
  } catch {
    return null;
  }
}

/**
 * Mídia sem legenda chega sem texto nenhum (áudio, foto pura, figurinha). Sem um marcador
 * essas mensagens caíam na guarda de "sem_texto" e o lead que só manda áudio — o padrão no
 * Brasil — nunca virava card nem recebia resposta.
 */
function mediaLabel(m: any): string | null {
  const t = String(m?.messageType || m?.mediaType || m?.type || "").toLowerCase();
  if (!t) return null;
  if (t.includes("audio") || t.includes("ptt")) return "[áudio]";
  if (t.includes("image")) return "[imagem]";
  if (t.includes("video")) return "[vídeo]";
  if (t.includes("sticker")) return "[figurinha]";
  if (t.includes("document")) return "[documento]";
  if (t.includes("location")) return "[localização]";
  if (t.includes("contact") || t.includes("vcard")) return "[contato]";
  return null;
}

/**
 * Mensagem apagada ("apagar para todos") chega como mensagem de protocolo do tipo
 * REVOKE apontando para o id da original. Devolve esse id ou null. Formatos
 * aceitos: Baileys (protocolMessage) e Uazapi (messageType + content JSON).
 */
function revokedTarget(m: any): string | null {
  const t = String(m?.messageType || m?.type || "").toLowerCase();
  const pm = m?.message?.protocolMessage ?? m?.protocolMessage ?? null;
  let c: any = m?.content;
  if (typeof c === "string" && c.trim().startsWith("{")) {
    try { c = JSON.parse(c); } catch { c = null; }
  }
  const isRevokeType = (x: any) => x === 0 || x === "REVOKE" || x === "revoke";
  const isRevoke = (pm && isRevokeType(pm.type)) || t.includes("revoke")
    || (t.includes("protocol") && c && typeof c === "object" && (isRevokeType(c.type) || isRevokeType(c.Type)));
  if (!isRevoke) return null;
  const id = pm?.key?.id ?? c?.key?.id ?? c?.key?.ID ?? c?.Key?.ID ?? m?.revokedMessageId ?? null;
  return id ? String(id) : null;
}

function extractText(body: any) {
  // Uazapi atual: { EventType, message: {campos planos}, chat: {...}, owner, token }
  // Legado/Baileys: { data: { message: { conversation }, key: { remoteJid, fromMe } } }
  const envelope = body.data || body;
  const m = envelope?.message ?? body.message ?? envelope ?? {};
  const chat = body.chat || envelope?.chat || {};

  const media = mediaLabel(m);
  const text =
    m?.text ||                                  // Uazapi: campo canônico
    readContent(m?.content) ||                  // Uazapi: content como JSON string
    m?.message?.conversation ||                 // Baileys puro
    m?.message?.extendedTextMessage?.text ||
    m?.body ||
    media ||                                    // mídia sem legenda → "[áudio]", "[imagem]"...
    null;

  const fromMe = m?.fromMe ?? m?.key?.fromMe ?? false;
  const rawJid = m?.chatid || m?.key?.remoteJid || chat?.wa_chatid || m?.from || "";
  const isGroup =
    m?.isGroup === true || chat?.wa_isGroup === true || String(rawJid).includes("@g.us");

  // chatid pode vir como @lid (id opaco). Os campos do `chat` sempre apontam para o
  // contato; `sender_pn` aponta para quem enviou — em mensagem nossa (fromMe) esse é
  // o dono da instância, então só serve como fallback quando a mensagem é do contato.
  const phone =
    jidToPhone(rawJid) ||
    jidToPhone(chat?.wa_chatid) ||
    jidToPhone(chat?.lead_phone) ||
    jidToPhone(chat?.phone) ||
    (fromMe ? "" : jidToPhone(m?.sender_pn)) ||
    "";

  // `senderName`/`pushName` descrevem quem ENVIOU: em mensagem nossa (fromMe) são o dono
  // da instância, então usá-los renomeia o lead com o nome do operador a cada resposta.
  const contactName = fromMe
    ? chat?.lead_name || chat?.wa_name || null
    : m?.senderName || chat?.lead_name || chat?.wa_name || m?.pushName || null;
  const instanceName = body.instance?.name || body.instanceName || "";
  const instanceToken = body.token || body.instance?.token || m?.token || null;
  // `owner` é o telefone da instância: último recurso pra achar o dono sem token nem nome
  const instanceOwner = jidToPhone(body.owner || m?.owner || chat?.owner);

  return { text, media, fromMe, phone, isGroup, contactName, instanceName, instanceToken, instanceOwner, message: m };
}

/**
 * Verificacao do webhook da Meta (WhatsApp Cloud API).
 *
 * A Meta valida a URL com um GET contendo hub.mode, hub.verify_token e
 * hub.challenge. Se o token conferir, precisamos devolver o challenge cru,
 * como texto puro — JSON aqui faz a Meta recusar a URL.
 *
 * O token esperado fica em app_settings.meta_verify_token. A Uazapi nao usa
 * este caminho: ela so chama por POST.
 */
async function handleMetaVerification(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode !== "subscribe" || !token || !challenge) {
    console.log("[webhook] GET sem parametros de verificacao", { mode, hasToken: !!token });
    return new Response("not a verification request", { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "meta_verify_token")
    .maybeSingle();

  const expected = (data?.value || "").trim();
  if (!expected) {
    console.error("[webhook] meta_verify_token nao configurado em app_settings");
    return new Response("verify token not configured", { status: 500, headers: corsHeaders });
  }
  if (token !== expected) {
    console.error("[webhook] verificacao recusada: token divergente");
    return new Response("forbidden", { status: 403, headers: corsHeaders });
  }

  console.log("[webhook] verificacao da Meta aceita");
  return new Response(challenge, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "text/plain" },
  });
}

function unauthorized(reason: string) {
  console.warn("[webhook] recusado", { reason });
  return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Resolved = { inst: any } | { deny: string } | null;

/**
 * Cloud API: instância pelo phone_number_id; origem pela assinatura
 * X-Hub-Signature-256 (HMAC-SHA256 do corpo bruto com o App Secret).
 */
async function resolveCloud(admin: any, req: Request, raw: string, phoneNumberId: string | null): Promise<Resolved> {
  if (!phoneNumberId) return null;
  const { data: inst } = await admin
    .from("whatsapp_instances")
    .select("*")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();
  if (!inst) return null;

  const secret =
    (await getSecret(admin, `instance:${inst.id}:app_secret`)) ||
    (await getSecret(admin, "platform:meta_app_secret"));
  if (!secret) {
    // Transição: sem App Secret configurado não há como validar. Registrado no
    // plano 1C; configurar platform:meta_app_secret fecha este caminho.
    console.error("[webhook] ATENCAO: App Secret da Meta nao configurado; assinatura nao validada");
    return { inst };
  }
  const header = req.headers.get("x-hub-signature-256") ?? "";
  const expected = "sha256=" + (await hmacSha256Hex(secret, raw));
  if (!safeEqual(header, expected)) return { deny: "assinatura Meta invalida" };
  return { inst };
}

/**
 * Uazapi: com ?i=<instance_id>&k=<segredo>, instância e origem conferidas.
 * Sem ?i=, busca legada (token por hash, nome, telefone) — aceita só para
 * número que ainda não ganhou segredo de webhook.
 */
async function resolveUazapi(
  admin: any, url: URL, ref: { token: string | null; name: string; owner: string },
): Promise<Resolved> {
  const qi = url.searchParams.get("i");
  const qk = url.searchParams.get("k") ?? "";
  if (qi) {
    if (!/^[0-9a-f-]{36}$/i.test(qi)) return { deny: "i invalido" };
    const { data: inst } = await admin.from("whatsapp_instances").select("*").eq("id", qi).maybeSingle();
    if (!inst) return { deny: "instancia inexistente" };
    const secret = await getSecret(admin, `instance:${inst.id}:webhook`);
    if (!secret || !safeEqual(qk, secret)) return { deny: "segredo do webhook invalido" };
    return { inst };
  }

  // Legado só pelo token da instância, que é segredo (comparado por hash).
  // Nome e telefone do número NÃO identificam: são conhecíveis por qualquer um
  // e permitiriam forjar mensagem para a organização de outro cliente.
  if (!ref.token) return { deny: "sem token e sem URL autenticada" };
  const { data: inst } = await admin
    .from("whatsapp_instances")
    .select("*")
    .eq("token_hash", await sha256Hex(ref.token))
    .maybeSingle();
  if (!inst) return null;
  if (await hasSecret(admin, `instance:${inst.id}:webhook`)) {
    return { deny: "numero exige URL autenticada (?i=&k=)" };
  }
  return { inst };
}

/**
 * Status de entrega da Cloud API (sent/delivered/read/failed). Mesma
 * autenticação das mensagens; atualiza só a organização do número.
 */
async function handleCloudStatuses(req: Request, raw: string, body: any) {
  const pnid = body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id ?? null;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const resolved = await resolveCloud(admin, req, raw, pnid);
  if (resolved && "deny" in resolved) return unauthorized(resolved.deny);
  if (!resolved) return ok();
  const orgId = resolved.inst.organization_id;
  for (const entry of body?.entry ?? []) {
    for (const ch of entry?.changes ?? []) {
      for (const s of ch?.value?.statuses ?? []) {
        if (s?.id && s?.status) {
          await admin.rpc("service_update_message_status", { org: orgId, pmid: String(s.id), new_status: String(s.status) });
        }
      }
    }
  }
  return ok();
}

/** Estado do evento na fila (inbound_events) durante o processamento. */
interface QueueCtx { eventId?: string; stage?: string; replayInstanceId?: string; failed?: boolean; retry?: boolean; error?: string }

async function handle(req: Request, ctx: QueueCtx): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method === "GET") return await handleMetaVerification(req);

  try {
    // Reprocessamento da fila (process-inbound): só com o segredo do cron; a
    // instância vem do evento gravado, não do payload.
    const replayId = req.headers.get("x-replay-event");
    if (replayId) {
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const expected = await getSecret(admin, "platform:cron_secret");
      if (!expected || !safeEqual(req.headers.get("x-cron-secret") ?? "", expected)) return unauthorized("replay sem segredo");
      const { data: ev } = await admin.from("inbound_events").select("id, instance_id, stage, status").eq("id", replayId).maybeSingle();
      if (!ev || ev.status !== "processing") return ok({ ok: true, skipped: "evento" });
      ctx.eventId = ev.id; ctx.stage = ev.stage; ctx.replayInstanceId = ev.instance_id;
    }
    const raw = await req.text();
    let body: any;
    try {
      body = JSON.parse(raw);
    } catch {
      return ok({ ok: false, error: "json invalido" });
    }
    const url = new URL(req.url);
    const providerId = providers.detectPayloadProvider(body);
    const event = providerId === "cloud"
      ? "messages"
      : (body.EventType || body.event || body.type || "messages");

    if (providerId === "uazapi" && event === "test") return ok({ ok: true, message: "webhook ok" });

    // Cada provedor tem seu parser; a Uazapi segue no extractText histórico.
    let text: string | null = null;
    let media: string | null = null;
    let fromMe = false;
    let phone = "";
    let isGroup = false;
    let contactName: string | null = null;
    let instanceName = "";
    let instanceToken: string | null = null;
    let instanceOwner = "";
    let phoneNumberId: string | null = null;
    let mediaId: string | null = null;
    let mediaKind: string | null = null;
    let revoked: string | null = null;
    const isConnection = providerId === "uazapi" && (event === "connection" || event === "connection.update");

    if (providerId === "cloud") {
      const inbound = providers.parseCloudInbound(body);
      if (inbound.kind === "status") return await handleCloudStatuses(req, raw, body);
      if (inbound.kind !== "message") {
        console.log("[webhook] cloud ignorado", { kind: inbound.kind });
        return ok();
      }
      text = inbound.text;
      media = inbound.mediaKind ? inbound.text : null;
      phone = inbound.phone;
      contactName = inbound.contactName;
      phoneNumberId = inbound.ref.phoneNumberId ?? null;
      mediaId = inbound.mediaId;
      mediaKind = inbound.mediaKind;
    } else if (isConnection) {
      const inst = body?.instance ?? {};
      instanceToken = body?.token || inst?.token || null;
      instanceName = String(inst?.name || body?.instanceName || "").trim();
      instanceOwner = jidToPhone(body?.owner || inst?.owner || "");
    } else {
      const parsed = extractText(body);
      text = parsed.text;
      media = parsed.media;
      fromMe = parsed.fromMe;
      phone = parsed.phone;
      isGroup = parsed.isGroup;
      contactName = parsed.contactName;
      instanceName = parsed.instanceName;
      instanceToken = parsed.instanceToken;
      instanceOwner = parsed.instanceOwner;
      mediaId = (parsed.message as any)?.messageid ?? null;
      revoked = revokedTarget(parsed.message);
      mediaKind = ({
        "[áudio]": "audio", "[imagem]": "image", "[vídeo]": "video", "[documento]": "document", "[figurinha]": "sticker",
      } as Record<string, string>)[parsed.media ?? ""] ?? null;
    }

    // Observabilidade sem dado pessoal além do necessário para diagnóstico.
    console.log("[webhook] in", {
      provider: providerId,
      event,
      has_text: !!text,
      media: media || null,
      is_group: isGroup,
      from_me: fromMe,
      authed_url: url.searchParams.has("i"),
    });

    if (!isConnection && !(revoked && !isGroup) && (isGroup || !text || !phone)) {
      console.log("[webhook] ignorado", {
        reason: isGroup ? "grupo" : !text ? "sem_texto" : "sem_telefone",
      });
      return ok();
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Origem autenticada + instância. A organização vem da instância (banco),
    // nunca do payload.
    const resolved = ctx.replayInstanceId
      ? await supabase.from("whatsapp_instances").select("*").eq("id", ctx.replayInstanceId).maybeSingle()
          .then(({ data }: any) => (data ? { inst: data } : null))
      : providerId === "cloud"
      ? await resolveCloud(supabase, req, raw, phoneNumberId)
      : await resolveUazapi(supabase, url, { token: instanceToken, name: instanceName, owner: instanceOwner });
    if (resolved && "deny" in resolved) return unauthorized(resolved.deny);
    if (!resolved) {
      console.warn("[webhook] instancia nao encontrada", { provider: providerId });
      return ok();
    }
    let instRow: any = resolved.inst;
    const orgId: string = instRow.organization_id;

    const { data: orgRow } = await supabase
      .from("organizations")
      .select("status, settings")
      .eq("id", orgId)
      .maybeSingle();
    if (orgRow?.status !== "active") {
      console.log("[webhook] organizacao inativa; ignorado", { status: orgRow?.status ?? null });
      return ok();
    }
    const org = forOrg(supabase, orgId);

    // Número desconectado pelo cliente: nada é processado (histórico preservado).
    if (instRow.status === "disabled") {
      console.log("[webhook] numero desconectado; ignorado");
      return ok();
    }

    if (isConnection) return await handleConnection(org, instRow, body);

    // Apagada pelo cliente (ou no celular): o histórico fica; só marca.
    if (revoked) {
      const { data: marked } = await supabase.rpc("service_mark_message_deleted", {
        org: orgId, pmid: revoked, who: fromMe ? "phone" : "contact",
      });
      console.log("[webhook] mensagem apagada marcada", { marked: marked ?? 0 });
      return ok();
    }

    // Fila: grava o evento antes de processar. Repetido (reenvio do provedor) →
    // já foi tratado. Falhou no meio → process-inbound refaz.
    const providerMsgId = providerId === "cloud"
      ? body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id
      : (body?.message?.messageid ?? body?.message?.id ?? body?.data?.key?.id);
    if (!ctx.eventId && providerMsgId) {
      const { data: ev, error: evErr } = await supabase.from("inbound_events").insert({
        organization_id: orgId, instance_id: instRow.id, provider: providerId, provider_message_id: String(providerMsgId),
        payload: body, status: "processing", attempts: 1, claimed_at: new Date().toISOString(),
      }).select("id").single();
      if (evErr?.code === "23505") {
        console.log("[webhook] mensagem repetida; ignorada");
        return ok();
      }
      if (ev) ctx.eventId = ev.id;
      else console.error("[webhook] fila indisponivel", evErr?.message);
    }

    // Auto-sincroniza o nome salvo com o nome real vindo da Uazapi.
    if (instanceName && instRow.name !== instanceName) {
      await org.update("whatsapp_instances", { name: instanceName }).eq("id", instRow.id);
      instRow.name = instanceName;
    }

    // Conversa escopada por organização + número: o mesmo contato falando em
    // dois números vira duas conversas.
    const { data: convExisting } = await org
      .select("conversations")
      .eq("instance_id", instRow.id)
      .eq("contact_phone", phone)
      .maybeSingle();

    let conv: any = convExisting;
    if (!conv) {
      // Novo contato → primeira etapa do funil da organização.
      const { data: firstStage } = await org
        .select("pipeline_stages", "id")
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle();
      const { data: created, error: createErr } = await org
        .insert("conversations", {
          instance_id: instRow.id,
          contact_phone: phone,
          contact_name: contactName,
          ai_enabled: fromMe ? false : true,
          human_takeover_at: fromMe ? new Date().toISOString() : null,
          last_message_at: new Date().toISOString(),
          last_inbound_at: fromMe ? null : new Date().toISOString(),
          stage_id: firstStage?.id ?? null,
        })
        .select()
        .single();
      // Duas mensagens juntas de contato novo: a segunda perde a corrida no
      // índice único. Relê em vez de perder a mensagem.
      if (createErr) {
        console.log("[webhook] corrida na criacao, relendo conversa");
        const { data: raced } = await org
          .select("conversations")
          .eq("instance_id", instRow.id)
          .eq("contact_phone", phone)
          .maybeSingle();
        conv = raced;
      } else {
        conv = created;
      }
    } else {
      const update: Record<string, any> = {
        last_message_at: new Date().toISOString(),
        contact_name: contactName || conv.contact_name,
      };
      // Só mensagem DO CLIENTE abre a janela de 24h da Meta.
      if (!fromMe) {
        update.last_inbound_at = new Date().toISOString();
        conv.last_inbound_at = update.last_inbound_at;
      }
      if (fromMe) {
        update.ai_enabled = false;
        update.human_takeover_at = new Date().toISOString();
        conv.ai_enabled = false;
        conv.human_takeover_at = update.human_takeover_at;
      }
      await org.update("conversations", update).eq("id", conv.id);
    }
    if (!conv) return ok();

    // Resposta à pesquisa/fluxo pós-atendimento vai para o atendimento
    // finalizado, sem abrir outro. Recusada → segue o caminho normal.
    if (!fromMe && text) {
      const consumed = await runPostClose({
        admin: supabase, orgId, conv, text: String(text),
        loadInst: () => instForSend(supabase, instRow),
        storeInbound: (ticketId) => org.insert("messages", {
          conversation_id: conv.id, ticket_id: ticketId, direction: "inbound", sender: "contact", content: text,
          provider_message_id: providerMsgId ? String(providerMsgId) : null,
        }),
      });
      if (consumed) return ok();
    }

    // Atendimento aberto da conversa (cria se preciso; resposta pelo celular
    // vira "open"). É ele que decide se a IA responde.
    const { data: ticket, error: ticketErr } = await supabase.rpc("service_ticket_for_inbound", {
      conv: conv.id, from_me: fromMe,
    });
    if (ticketErr || !ticket) {
      console.error("[webhook] atendimento nao criado", ticketErr?.message);
      return ok({ ok: false });
    }

    // Mensagem enviada do próprio celular → takeover humano; não chama IA.
    if (fromMe) {
      console.log("[webhook] takeover humano", { conversa: conv.id, ia: "desligada" });
      await cancelPendingFollowups(supabase, conv.id);
      await org
        .update("conversations", { inactivity_followup_at: null, auto_followup_count: 0 })
        .eq("id", conv.id);
      await org.insert("messages", {
        conversation_id: conv.id,
        ticket_id: ticket.id,
        direction: "outbound",
        sender: "human",
        content: text,
        provider_message_id: providerMsgId ? String(providerMsgId) : null,
      });
      return ok();
    }

    // Cliente respondeu → cancela follow-ups pendentes e zera o contador.
    await cancelPendingFollowups(supabase, conv.id);
    await org
      .update("conversations", { inactivity_followup_at: null, auto_followup_count: 0 })
      .eq("id", conv.id);

    // Token do número só do Vault, carregado quando for usado.
    // (Uazapi antiga, sem config própria, cai no ajuste global.)
    instRow = await instForSend(supabase, instRow);

    // Mídia recebida vai para o bucket privado; falha no download deixa a
    // mensagem com o rótulo ("[imagem]"...) e a tela mostra "arquivo indisponível".
    let mediaFields: Record<string, unknown> = {};
    let mediaBytes: Uint8Array | null = null;
    if (mediaId && mediaKind) {
      mediaBytes = await providers.getAudioBytes(instRow, mediaId);
      if (mediaBytes && mediaBytes.length <= LIMITS.document) {
        mediaFields = (await storeMedia(supabase, orgId, conv.id, mediaBytes, { hint: mediaKind })) ?? {};
      } else {
        mediaFields = { type: mediaKind === "sticker" ? "sticker" : mediaKind };
      }
    }

    // Áudio vira texto antes de ser gravado; falha aqui cai no rótulo "[áudio]".
    const stt = mediaKind === "audio" && mediaBytes ? await audioAI(supabase, orgId) : null;
    if (mediaKind === "audio" && mediaBytes && stt) {
      const falado = await transcribeAudio(stt.apiKey, mediaBytes, "audio.ogg", stt.provider);
      if (falado) {
        await recordUsage(stt, undefined, 1);
        text = "🎤 " + falado;
        console.log("[webhook] audio transcrito", { chars: falado.length });
      }
    }

    // Imagem e PDF: a IA lê e o resultado entra no histórico (desligável por empresa).
    let mediaText: string | null = null;
    const readOn = (orgRow as any)?.settings?.ai_read_media !== false;
    if (readOn && mediaBytes && (mediaKind === "image" || mediaKind === "document") && ctx.stage !== "stored") {
      const { data: allowedRead } = await supabase.rpc("service_ai_take", { org: orgId });
      if (allowedRead !== false) {
        mediaText = await readMedia(supabase, orgId, mediaKind, mediaBytes, String((mediaFields as any).media_mime ?? ""),
          media && text !== media ? String(text ?? "") : "");
        if (mediaText) console.log("[webhook] midia lida", { kind: mediaKind, chars: mediaText.length });
      }
    }

    // Reprocessamento não grava a mesma mensagem de novo.
    if (ctx.stage !== "stored") {
      await org.insert("messages", {
        conversation_id: conv.id,
        ticket_id: ticket.id,
        direction: "inbound",
        sender: "contact",
        content: text,
        provider_message_id: providerMsgId ? String(providerMsgId) : null,
        media_text: mediaText,
        ...mediaFields,
      });
      if (ctx.eventId) await supabase.from("inbound_events").update({ stage: "stored" }).eq("id", ctx.eventId);
    }

    // SAIR/PARAR: deixa de receber mensagens automáticas (confirma e para aqui).
    if (await handleOptOut({ admin: supabase, orgId, inst: instRow, conv, ticket, text: String(text ?? "") })) {
      return ok();
    }

    // IA só responde atendimento que está com ela.
    if (ticket.status !== "bot") return ok();

    // Sem o módulo "Agentes de IA e Automação": nada de IA nem fluxo; vai direto para a fila das pessoas.
    if (!(await moduleOn(supabase, orgId, "ia"))) {
      await supabase.rpc("service_ticket_route", { ticket: ticket.id, action: "queue" });
      return ok();
    }

    // Limite de IA por organização: acima dele, a resposta espera na fila.
    if (ctx.eventId) {
      const { data: allowed } = await supabase.rpc("service_ai_take", { org: orgId });
      if (allowed === false) {
        console.log("[webhook] limite de IA da organizacao; resposta adiada");
        ctx.retry = true;
        return ok();
      }
    }

    // Fluxo publicado para este número (ou o padrão da empresa) conduz o
    // atendimento; sem fluxo, segue a IA da organização como antes.
    if (await runFlow({ admin: supabase, orgId, inst: instRow, conv, ticket, text: String(text ?? "") })) {
      return ok();
    }
    // IA padrão da empresa: provedor escolhido em Configurações → Chaves de IA (padrão Groq).
    const profileAI = await getAgentProfile(supabase, orgId);
    if (!profileAI.enabled) return ok();
    const ai = await resolveAI(supabase, orgId);
    if (!ai) {
      console.error("[webhook] sem chave do provedor de IA da empresa");
      return ok();
    }

    const { data: history } = await org
      .select("messages", "direction, sender, content, media_text, type")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: false })
      .limit(20);

    const chat = [
      { role: "system" as const, content: [withProtocol(profileAI.systemPrompt, ticket.protocol), await companyKnowledge(org),
        await knowledgeContext(supabase, orgId, String(text ?? ""), "cliente", ticket.department_id ? [ticket.department_id] : null)].filter(Boolean).join("\n\n") },
      ...(history || []).reverse().map((m: any) => ({
        role: (m.direction === "inbound" ? "user" : "assistant") as "user" | "assistant",
        content: withMediaText(String(m.content ?? ""), m.media_text, m.type),
      })),
    ];

    const groq = await chatAI(ai, chat);
    if (!groq.ok || !groq.reply) {
      console.error("[webhook] groq failed", groq.error);
      return ok();
    }
    groq.reply = toChatText(groq.reply);

    // Acabamos de RECEBER mensagem do contato: a janela de 24h está aberta.
    const enviado = await providers.sendText(instRow, phone, groq.reply);
    if (!enviado.ok) {
      console.error("[webhook] envio falhou", { provider: instRow.provider, code: enviado.code });
      return ok();
    }

    await org.insert("messages", {
      conversation_id: conv.id,
      ticket_id: ticket.id,
      direction: "outbound",
      sender: "ai",
      content: groq.reply,
      status: "sent",
      provider_message_id: enviado.messageId ?? null,
    });
    await org
      .update("conversations", { last_message_at: new Date().toISOString() })
      .eq("id", conv.id);

    await scheduleInactivityFollowup({
      admin: supabase,
      orgId,
      conversationId: conv.id,
      currentAutoCount: conv.auto_followup_count ?? 0,
    });

    return ok();
  } catch (e: any) {
    console.error("[webhook] error", e?.message);
    ctx.failed = true;
    ctx.error = String(e?.message ?? "erro");
    return ok({ ok: false });
  }
}

serve(async (req) => {
  const ctx: QueueCtx = {};
  const res = await handle(req, ctx);
  if (ctx.eventId) {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const status = ctx.failed ? "failed" : ctx.retry ? "pending" : "processed";
    await admin.from("inbound_events").update({
      status,
      error: ctx.failed ? (ctx.error ?? "erro").slice(0, 300) : ctx.retry ? "limite de IA" : null,
      processed_at: status === "processed" ? new Date().toISOString() : null,
      ...(status === "processed" ? { stage: "done" } : {}),
    }).eq("id", ctx.eventId);
  }
  return res;
});

/**
 * Evento de conexão da Uazapi: mantém o status do número em dia no painel
 * (bateria, chip removido, sessão expirada). Instância já autenticada.
 */
async function handleConnection(org: OrgScope, instRow: any, body: any) {
  const inst = body?.instance ?? {};
  const raw = String(
    inst?.status ?? body?.status ?? inst?.state ?? body?.state ?? body?.connection ?? "",
  ).toLowerCase();

  let status: string | null = null;
  if (/disconnect|close|logout|banned|removed/.test(raw)) status = "disconnected";
  else if (/connecting|qr|pairing|syncing/.test(raw)) status = "connecting";
  else if (/connected|open|online/.test(raw)) status = "connected";

  console.log("[webhook] connection", { raw, status });
  if (!status || instRow.status === status) return ok();

  const patch: Record<string, unknown> = { status };
  if (status === "disconnected") patch.last_disconnected_at = new Date().toISOString();
  const { error } = await org.update("whatsapp_instances", patch).eq("id", instRow.id);
  if (error) console.error("[webhook] connection: update falhou", error.message);
  else console.log("[webhook] connection: status atualizado", { de: instRow.status, para: status });
  return ok();
}
