/**
 * Provedor Meta — WhatsApp Cloud API.
 *
 * Diferenças que importam em relação à Uazapi:
 *   - Identificação é determinística: phone_number_id vem em todo payload.
 *   - A Meta NÃO devolve as mensagens que nós enviamos como entrada. Ela manda
 *     um evento `statuses` separado. Por isso fromMe é sempre false aqui.
 *   - Grupo não existe na Cloud API.
 *   - Mensagem livre só sai dentro da janela de 24h; fora dela, só template.
 *
 * Design: docs/superpowers/specs/2026-09-23-whatsapp-cloud-api-design.md
 */

import type {
  InstanceRow,
  NormalizedInbound,
  SendResult,
  TemplateRef,
} from "./types.ts";
import { EMPTY_INBOUND } from "./types.ts";

/** Versão do Graph API. Ponto único de atualização. */
export const GRAPH_VERSION = "v26.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

/** Erro da Meta para envio fora da janela de 24h. */
const CODE_OUTSIDE_WINDOW = "131047";

const MEDIA_LABEL: Record<string, string> = {
  audio: "[áudio]",
  voice: "[áudio]",
  image: "[imagem]",
  video: "[vídeo]",
  document: "[documento]",
  sticker: "[figurinha]",
  location: "[localização]",
  contacts: "[contato]",
};

function digits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

/** true se o corpo veio da Meta. Usado para despachar o parser certo. */
export function isCloudPayload(body: any): boolean {
  return body?.object === "whatsapp_business_account" && Array.isArray(body?.entry);
}

export function parseInbound(body: any): NormalizedInbound {
  if (!isCloudPayload(body)) return { ...EMPTY_INBOUND, provider: "cloud" };

  const entry = body.entry?.[0] ?? {};
  const change = entry.changes?.[0] ?? {};
  const value = change.value ?? {};
  const phoneNumberId: string | null = value?.metadata?.phone_number_id ?? null;
  const wabaId: string | null = entry?.id ?? null;

  const base: NormalizedInbound = {
    ...EMPTY_INBOUND,
    provider: "cloud",
    ref: { phoneNumberId, wabaId },
  };

  // Confirmações de entrega e leitura. Não viram conversa.
  if (Array.isArray(value.statuses) && value.statuses.length) {
    return { ...base, kind: "status" };
  }

  const msg = Array.isArray(value.messages) ? value.messages[0] : null;
  if (!msg) return base;

  const type: string = msg.type ?? "";
  const contactName: string | null = value?.contacts?.[0]?.profile?.name ?? null;
  const phone = digits(msg.from);

  // Texto puro, ou legenda de mídia, ou rótulo quando não há texto algum.
  let text: string | null = null;
  let mediaId: string | null = null;
  let mediaKind: NormalizedInbound["mediaKind"] = null;

  if (type === "text") {
    text = msg.text?.body ?? null;
  } else {
    const node = msg[type] ?? {};
    mediaId = node?.id ?? null;
    if (type === "audio" || type === "voice") mediaKind = "audio";
    else if (type === "image") mediaKind = "image";
    else if (type === "video") mediaKind = "video";
    else if (type === "document") mediaKind = "document";
    text = node?.caption || MEDIA_LABEL[type] || `[${type}]`;
  }

  if (!phone || !text) return base;

  return {
    ...base,
    kind: "message",
    phone,
    text,
    mediaId,
    mediaKind,
    contactName,
    fromMe: false, // a Meta nunca devolve mensagem nossa como entrada
    isGroup: false, // grupo não existe na Cloud API
  };
}

/** Extrai o código de erro da Meta, que vem aninhado e às vezes duplicado. */
function metaErrorCode(payload: any): string | undefined {
  const raw = payload?.error?.code ?? payload?.error?.error_data?.details;
  if (raw === undefined || raw === null) return undefined;
  return String(raw);
}

function metaErrorMessage(payload: any, status: number, fallback: string): string {
  const e = payload?.error;
  if (!e) return `Meta respondeu ${status}: ${fallback.slice(0, 200)}`;
  const detail = e?.error_data?.details;
  return [e.message, detail].filter(Boolean).join(" — ") || `Meta respondeu ${status}`;
}

async function post(inst: InstanceRow, payload: unknown): Promise<SendResult> {
  const phoneNumberId = inst.phone_number_id;
  const token = inst.instance_token;
  if (!phoneNumberId || !token) {
    return { ok: false, error: "Instância Cloud sem phone_number_id ou access token." };
  }

  let res: Response;
  let raw = "";
  try {
    res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    raw = await res.text();
  } catch (e: any) {
    return { ok: false, error: e?.message || "Falha de rede ao chamar a Meta." };
  }

  if (res.ok) return { ok: true };

  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // resposta não-JSON: mantemos o texto cru na mensagem de erro
  }

  const code = metaErrorCode(parsed);
  return {
    ok: false,
    code,
    outsideWindow: code === CODE_OUTSIDE_WINDOW,
    error: translateMetaError(code, metaErrorMessage(parsed, res.status, raw)),
  };
}

/** Traduz os códigos que o operador precisa entender sem abrir a documentação. */
export function translateMetaError(code: string | undefined, fallback: string): string {
  switch (code) {
    case CODE_OUTSIDE_WINDOW:
      return "Janela de 24h fechada. Só template aprovado reabre a conversa.";
    case "132000":
      return "Os parâmetros não batem com o template aprovado.";
    case "132001":
      return "Template não encontrado nessa conta. Confira nome e idioma.";
    case "132005":
      return "Template reprovado ou pausado pela Meta.";
    case "131026":
      return "Esse número não recebe WhatsApp.";
    case "190":
      return "Access token inválido ou expirado. Gere um novo no painel da Meta.";
    case "131056":
      return "Muitas mensagens para esse contato em pouco tempo. Aguarde.";
    case "80007":
      return "Limite de envio da conta atingido.";
    default:
      return fallback;
  }
}

export async function sendText(inst: InstanceRow, to: string, text: string): Promise<SendResult> {
  return await post(inst, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: digits(to),
    type: "text",
    text: { preview_url: false, body: text },
  });
}

export async function sendTemplate(
  inst: InstanceRow,
  to: string,
  t: TemplateRef,
): Promise<SendResult> {
  const components = t.bodyParams?.length
    ? [{
      type: "body",
      parameters: t.bodyParams.map((p) => ({ type: "text", text: p })),
    }]
    : undefined;

  return await post(inst, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: digits(to),
    type: "template",
    template: {
      name: t.name,
      language: { code: t.language },
      ...(components ? { components } : {}),
    },
  });
}

/**
 * Baixa a mídia em dois passos, como a Meta exige: o id devolve uma URL
 * temporária, e essa URL só entrega os bytes com o mesmo Bearer.
 */
export async function getMediaBytes(
  inst: InstanceRow,
  mediaId: string,
): Promise<Uint8Array | null> {
  const token = inst.instance_token;
  if (!token) return null;

  try {
    const metaRes = await fetch(`${GRAPH}/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!metaRes.ok) {
      console.error("[cloud] media lookup falhou", metaRes.status, (await metaRes.text()).slice(0, 200));
      return null;
    }
    const { url } = await metaRes.json();
    if (!url) return null;

    const binRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!binRes.ok) {
      console.error("[cloud] media download falhou", binRes.status);
      return null;
    }
    return new Uint8Array(await binRes.arrayBuffer());
  } catch (e) {
    console.error("[cloud] media erro", e);
    return null;
  }
}
