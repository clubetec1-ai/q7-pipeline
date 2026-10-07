/**
 * Transcrição de áudio recebido no WhatsApp.
 *
 * Usa o Whisper da Groq, com a mesma chave que o agente já usa. A alternativa
 * era a transcrição embutida da Uazapi, descartada por dois motivos: exige uma
 * chave da OpenAI que o usuário não tem, e o resultado seria jogado fora na
 * migração para a Cloud API. O Whisper da Groq é independente de provedor.
 *
 * Regra de ouro: transcrição nunca derruba o atendimento. Qualquer falha
 * devolve null e o chamador segue com o rótulo "[áudio]".
 *
 * Design: docs/superpowers/specs/2026-09-23-whatsapp-cloud-api-design.md
 */

export const WHISPER_MODEL = "whisper-large-v3-turbo";
// Groq (Whisper) ou OpenAI: a IA da plataforma escolhe quem transcreve (Plataforma → Conectores).
const STT: Record<string, { endpoint: string; model: string }> = {
  groq: { endpoint: "https://api.groq.com/openai/v1/audio/transcriptions", model: WHISPER_MODEL },
  openai: { endpoint: "https://api.openai.com/v1/audio/transcriptions", model: "gpt-4o-mini-transcribe" },
};

/** Limite prático do Whisper. Acima disso nem tentamos. */
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export async function transcribeAudio(
  apiKey: string,
  bytes: Uint8Array,
  fileName = "audio.ogg",
  provider = "groq",
  /** Dica de vocabulário (nome da empresa, cidades, marcas) para escrever certo os nomes próprios. */
  prompt?: string,
  /** Modelo mais preciso aprovado para um uso específico (ex.: Diagnóstico); falhou → o padrão do fornecedor. */
  model?: string,
): Promise<string | null> {
  if (model && STT[provider] && model !== STT[provider].model) {
    const best = await transcribeAudioWith(apiKey, bytes, fileName, provider, prompt, model);
    if (best) return best;
    console.log("[transcribe] modelo preciso falhou; usando o padrão", { model });
  }
  return transcribeAudioWith(apiKey, bytes, fileName, provider, prompt);
}

async function transcribeAudioWith(
  apiKey: string, bytes: Uint8Array, fileName: string, provider: string, prompt?: string, model?: string,
): Promise<string | null> {
  const stt = STT[provider];
  if (!apiKey || !stt) return null;
  if (!bytes?.length) return null;
  if (bytes.length > MAX_AUDIO_BYTES) {
    console.log("[transcribe] audio grande demais, ignorado", { bytes: bytes.length });
    return null;
  }

  try {
    const form = new FormData();
    form.append("file", new Blob([bytes as unknown as BlobPart]), fileName);
    form.append("model", model || stt.model);
    form.append("language", "pt");
    form.append("response_format", "json");
    if (prompt) form.append("prompt", prompt.slice(0, 800));

    const res = await fetch(stt.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!res.ok) {
      console.error("[transcribe] provedor respondeu", { provider }, res.status, (await res.text()).slice(0, 200));
      return null;
    }

    const data = await res.json();
    const texto = String(data?.text ?? "").trim();
    if (!texto) return null;

    console.log("[transcribe] ok", { chars: texto.length });
    return texto;
  } catch (e) {
    console.error("[transcribe] erro", e);
    return null;
  }
}
