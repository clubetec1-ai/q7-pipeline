/**
 * Leitura com IA para a base de conhecimento (Etapa B, item 4): o que não tem texto para extrair direto vira texto —
 * PDF digitalizado (IA lê o PDF), foto de documento (IA com visão transcreve) e áudio/vídeo (transcrição).
 * Nunca derruba o envio: falha devolve um erro legível e o documento fica "não lido".
 */
import { AI_PROVIDERS, audioAI, platformChain, recordUsage, resolveAI, type ResolvedAI } from "./ai-chat.ts";
import { askVision } from "./media-read.ts";
import { transcribeAudio } from "./transcribe.ts";

export type AIKind = "pdf" | "image" | "audio" | null;

/** Que tipo de leitura com IA o arquivo precisa (regra pura, testada). */
export function aiKindOf(fileName: string, mime: string): AIKind {
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  if (ext === "pdf" || /pdf/.test(mime)) return "pdf";
  if (["jpg", "jpeg", "png", "webp"].includes(ext) || /^image\/(jpeg|png|webp)$/.test(mime)) return "image";
  if (["mp3", "m4a", "ogg", "oga", "opus", "wav", "mp4", "webm", "mpeg", "mov"].includes(ext) || /^(audio|video)\//.test(mime)) return "audio";
  return null;
}

const OCR_PROMPT = "Transcreva todo o texto legível desta imagem, em ordem, mantendo títulos, listas e tabelas como texto simples. " +
  "Não resuma, não comente e não invente o que não estiver legível.";

const b64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** PDF digitalizado: só provedores que leem PDF direto (OpenAI). */
// deno-lint-ignore no-explicit-any
async function readPdfWithAI(admin: any, orgId: string, bytes: Uint8Array, fileName: string): Promise<string | null> {
  const first = await resolveAI(admin, orgId);
  const pool: ResolvedAI[] = [...(first ? [first, ...(first.fallbacks ?? [])] : []), ...(await platformChain(admin, orgId))];
  const seen = new Set<string>();
  for (const ai of pool) {
    if (ai.provider !== "openai" || seen.has(ai.apiKey)) continue;
    seen.add(ai.apiKey);
    try {
      const res = await fetch(AI_PROVIDERS.openai.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${ai.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ai.model || "gpt-4o-mini", max_tokens: 8000,
          messages: [{ role: "user", content: [
            { type: "text", text: OCR_PROMPT.replace("desta imagem", "deste PDF (todas as páginas)") },
            { type: "file", file: { filename: fileName.slice(0, 100), file_data: `data:application/pdf;base64,${b64(bytes)}` } },
          ] }],
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) { console.log("[knowledge-ai] PDF não lido", res.status); continue; }
      const d = await res.json();
      await recordUsage(ai, { in: d?.usage?.prompt_tokens ?? 0, out: d?.usage?.completion_tokens ?? 0 });
      const out = String(d?.choices?.[0]?.message?.content ?? "").trim();
      if (out) return out;
    } catch { /* tenta a próxima */ }
  }
  return null;
}

// deno-lint-ignore no-explicit-any
export async function extractWithAI(admin: any, orgId: string, bytes: Uint8Array, fileName: string, mime: string): Promise<{ text?: string; error?: string }> {
  const kind = aiKindOf(fileName, mime);
  if (!kind) return { error: "Formato não suportado. Use PDF, Word (.docx), Excel (.xlsx), CSV, texto, imagem, áudio ou vídeo." };
  const { data: allowed } = await admin.rpc("service_ai_take", { org: orgId });
  if (allowed === false) return { error: "Muitas leituras com IA agora. Tente de novo em um minuto." };
  if (kind === "pdf") {
    const t = await readPdfWithAI(admin, orgId, bytes, fileName);
    return t ? { text: t } : { error: "Não consegui ler este PDF digitalizado. Tente uma versão com texto (exportada do Word) ou fotos nítidas das páginas." };
  }
  if (kind === "image") {
    const t = await askVision(admin, orgId, bytes, mime || "image/jpeg", OCR_PROMPT, 3000);
    return t ? { text: t } : { error: "Não consegui ler o texto da imagem. Envie uma foto mais nítida (até 3,5 MB)." };
  }
  const stt = await audioAI(admin, orgId);
  if (!stt) return { error: "Para ler áudio e vídeo, a IA precisa de um fornecedor que transcreva (OpenAI ou Groq)." };
  const t = await transcribeAudio(stt.apiKey, bytes, fileName.replace(/[^\w.-]/g, "_") || "arquivo.mp4", stt.provider);
  if (t) await recordUsage(stt, undefined, 1);
  return t ? { text: t } : { error: "Não consegui transcrever o áudio ou vídeo (até 20 MB, fala em português)." };
}
