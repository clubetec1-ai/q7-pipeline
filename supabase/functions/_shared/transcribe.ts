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
const ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";

/** Limite prático do Whisper. Acima disso nem tentamos. */
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export async function transcribeAudio(
  groqKey: string,
  bytes: Uint8Array,
  fileName = "audio.ogg",
): Promise<string | null> {
  if (!groqKey) return null;
  if (!bytes?.length) return null;
  if (bytes.length > MAX_AUDIO_BYTES) {
    console.log("[transcribe] audio grande demais, ignorado", { bytes: bytes.length });
    return null;
  }

  try {
    const form = new FormData();
    form.append("file", new Blob([bytes]), fileName);
    form.append("model", WHISPER_MODEL);
    form.append("language", "pt");
    form.append("response_format", "json");

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey}` },
      body: form,
    });

    if (!res.ok) {
      console.error("[transcribe] groq respondeu", res.status, (await res.text()).slice(0, 200));
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
