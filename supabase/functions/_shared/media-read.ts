/**
 * IA lê o que o cliente mandou: imagem (modelo com visão, pela IA da empresa)
 * e PDF (texto extraído, sem IA). O resultado vira messages.media_text e entra
 * no histórico que a IA de atendimento lê.
 *
 * Regra de ouro (igual à transcrição de áudio): nunca derruba o atendimento.
 * Qualquer falha devolve null e a mensagem segue com o rótulo ("[imagem]").
 * Liga/desliga por empresa: settings.ai_read_media (padrão ligado).
 */
import { AI_PROVIDERS, resolveAI } from "./ai-chat.ts";
import { listChatModels } from "./get-ai-config.ts";

const MAX_IMAGE = 3_500_000; // limite prático das APIs com visão (base64 ≈ +33%)
const MAX_PDF = 10_000_000;
const MAX_TEXT = 4000;

const VISION_DEFAULT: Record<string, string | null> = {
  openai: "gpt-4o-mini", gemini: "gemini-2.5-flash", anthropic: "claude-haiku-4-5",
  openrouter: "openai/gpt-4o-mini", deepseek: null,
};

const PROMPT = `Descreva de forma objetiva, em português do Brasil, a imagem que um cliente enviou no atendimento.
- Comprovante de pagamento, PIX, boleto ou nota: diga o tipo e extraia valor, data/hora, pagador, recebedor, banco e código/ID.
- Documento ou print de tela: diga o que é e os dados principais que aparecem.
- Foto de produto ou local: descreva o que aparece e qualquer defeito ou problema visível.
No máximo 6 linhas. Transcreva só o que está legível; nunca invente.`;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function visionModel(provider: string, apiKey: string, chosen: string): Promise<string | null> {
  if (provider === "groq") {
    const ids = await listChatModels(apiKey);
    return ids.find((m) => /llama-4-scout/i.test(m)) ?? ids.find((m) => /llama-4|vision/i.test(m))
      ?? "meta-llama/llama-4-scout-17b-16e-instruct";
  }
  if (provider in VISION_DEFAULT) return chosen && provider !== "deepseek" ? chosen : VISION_DEFAULT[provider];
  return null;
}

// deno-lint-ignore no-explicit-any
async function describeImage(admin: any, orgId: string, bytes: Uint8Array, mime: string, caption: string): Promise<string | null> {
  if (bytes.length > MAX_IMAGE) return null;
  const ai = await resolveAI(admin, orgId);
  if (!ai) return null;
  const model = await visionModel(ai.provider, ai.apiKey, ai.provider === "groq" ? "" : ai.model);
  if (!model) return null;
  const endpoint = (AI_PROVIDERS[ai.provider] ?? AI_PROVIDERS.groq).endpoint;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${ai.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model, max_tokens: 400,
        messages: [{ role: "user", content: [
          { type: "text", text: caption ? `${PROMPT}\nLegenda enviada junto: ${caption.slice(0, 300)}` : PROMPT },
          { type: "image_url", image_url: { url: `data:${mime};base64,${toBase64(bytes)}` } },
        ] }],
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      console.log("[media-read] visão indisponível", { provider: ai.provider, status: res.status });
      return null;
    }
    const out = String((await res.json())?.choices?.[0]?.message?.content ?? "").trim();
    return out ? out.slice(0, MAX_TEXT) : null;
  } catch {
    return null;
  }
}

async function pdfText(bytes: Uint8Array): Promise<string | null> {
  if (bytes.length > MAX_PDF) return null;
  try {
    const { getDocumentProxy, extractText } = await import("npm:unpdf@1");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    const clean = String(text ?? "").replace(/\s+/g, " ").trim();
    if (!clean) return `PDF de ${totalPages} página(s) sem texto legível (provavelmente digitalizado).`;
    return `PDF de ${totalPages} página(s): ${clean.slice(0, MAX_TEXT)}`;
  } catch {
    return null;
  }
}

/** Texto do que foi lido (ou null). kind: "image" | "document". */
// deno-lint-ignore no-explicit-any
export async function readMedia(admin: any, orgId: string, kind: string, bytes: Uint8Array, mime: string, caption = ""): Promise<string | null> {
  if (kind === "image" && /^image\/(jpeg|png|webp|gif)$/i.test(mime)) return describeImage(admin, orgId, bytes, mime, caption);
  if (kind === "document" && /pdf/i.test(mime)) return pdfText(bytes);
  return null;
}

/** Linha do histórico para a IA: conteúdo + o que foi lido do arquivo. */
export function withMediaText(content: string, mediaText?: string | null, type?: string | null): string {
  if (!mediaText) return content;
  const label = type === "image" ? "Imagem enviada" : "Arquivo enviado";
  return `${content}\n[${label} — lido pela IA: ${mediaText}]`;
}
