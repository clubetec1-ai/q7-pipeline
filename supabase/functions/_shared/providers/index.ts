/**
 * Despacho entre provedores de WhatsApp.
 *
 * Este é o único lugar do sistema que decide "Uazapi ou Meta". Quem chama
 * `sendText` não precisa saber — passa a instância e o texto.
 *
 * O parser da Uazapi continua dentro do whatsapp-webhook, onde sempre esteve:
 * ele é o caminho comprovado em produção e mover código que funciona só para
 * arrumar a prateleira troca risco real por elegância. O parser da Cloud API é
 * novo e nasce em cloud.ts.
 *
 * Design: docs/superpowers/specs/2026-09-23-whatsapp-cloud-api-design.md
 */

import type { InstanceRow, ProviderId, SendResult, TemplateRef } from "./types.ts";
import * as cloud from "./cloud.ts";

export * from "./types.ts";
export { isCloudPayload, parseInbound as parseCloudInbound, GRAPH_VERSION } from "./cloud.ts";

/** Janela de atendimento da Meta: 24h desde a última mensagem DO CLIENTE. */
export const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Qual provedor mandou este payload. A Uazapi é o padrão porque é o formato
 * que já chegava antes de a Cloud API existir aqui.
 */
export function detectPayloadProvider(body: any): ProviderId {
  return cloud.isCloudPayload(body) ? "cloud" : "uazapi";
}

export function providerOf(inst: Pick<InstanceRow, "provider">): ProviderId {
  return inst?.provider === "cloud" ? "cloud" : "uazapi";
}

/**
 * A janela só existe na Cloud API. Em instância Uazapi sempre devolve true —
 * lá não há restrição de 24h.
 */
export function isWindowOpen(
  inst: Pick<InstanceRow, "provider">,
  lastInboundAt: string | null | undefined,
): boolean {
  if (providerOf(inst) !== "cloud") return true;
  if (!lastInboundAt) return false;
  const ts = new Date(lastInboundAt).getTime();
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < WINDOW_MS;
}

async function uazapiSendText(
  inst: InstanceRow,
  to: string,
  text: string,
): Promise<SendResult> {
  const serverUrl = (inst.server_url ?? "").replace(/\/$/, "");
  const token = inst.instance_token;
  if (!serverUrl || !token) {
    return { ok: false, error: "Instância Uazapi sem server_url ou instance_token." };
  }
  try {
    const res = await fetch(`${serverUrl}/send/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({ number: to, text }),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      return { ok: false, code: String(res.status), error: `Uazapi respondeu ${res.status}: ${body}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Falha de rede ao chamar a Uazapi." };
  }
}

/** Envia texto livre pelo provedor da instância. */
export async function sendText(
  inst: InstanceRow,
  to: string,
  text: string,
): Promise<SendResult> {
  return providerOf(inst) === "cloud"
    ? await cloud.sendText(inst, to, text)
    : await uazapiSendText(inst, to, text);
}

/**
 * Envia template aprovado. Só a Cloud API tem esse conceito — na Uazapi
 * qualquer texto sai livremente, então cai em sendText com o corpo já montado.
 */
export async function sendTemplate(
  inst: InstanceRow,
  to: string,
  t: TemplateRef,
): Promise<SendResult> {
  if (providerOf(inst) !== "cloud") {
    return { ok: false, error: "Template só existe na Cloud API." };
  }
  return await cloud.sendTemplate(inst, to, t);
}

/**
 * Baixa os bytes de uma mídia recebida, para transcrição.
 * Devolve null quando o provedor não conseguiu entregar — quem chama deve
 * seguir sem a transcrição em vez de falhar.
 */
export async function getAudioBytes(
  inst: InstanceRow,
  mediaId: string | null,
): Promise<Uint8Array | null> {
  if (!mediaId) return null;
  if (providerOf(inst) === "cloud") return await cloud.getMediaBytes(inst, mediaId);

  // Uazapi: um POST devolve o arquivo em base64.
  const serverUrl = (inst.server_url ?? "").replace(/\/$/, "");
  const token = inst.instance_token;
  if (!serverUrl || !token) return null;
  try {
    const res = await fetch(`${serverUrl}/message/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({ id: mediaId, return_base64: true, transcribe: false }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const b64 = data?.base64Data ?? data?.base64 ?? null;
    if (!b64) return null;
    const bin = atob(String(b64).replace(/^data:[^;]+;base64,/, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch (e) {
    console.error("[uazapi] media erro", e);
    return null;
  }
}
