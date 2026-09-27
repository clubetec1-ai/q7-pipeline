/**
 * Chat com o provedor de IA escolhido no bloco do fluxo. Todos falam o formato
 * de chat da OpenAI (inclusive ferramentas). A chave de cada provedor vem do
 * Vault da organização (org:<org>:<provedor>_api_key); nunca do navegador.
 * Groq mantém a cadeia de modelos com failover de get-ai-config.
 */
import { getSecret } from "./secrets.ts";
import { resolveModelChain, translateAIError } from "./get-ai-config.ts";

export const AI_PROVIDERS: Record<string, { endpoint: string; model: string }> = {
  groq: { endpoint: "https://api.groq.com/openai/v1/chat/completions", model: "auto" },
  openai: { endpoint: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini" },
  openrouter: { endpoint: "https://openrouter.ai/api/v1/chat/completions", model: "openrouter/auto" },
  gemini: { endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", model: "gemini-2.5-flash" },
  anthropic: { endpoint: "https://api.anthropic.com/v1/chat/completions", model: "claude-haiku-4-5" },
  deepseek: { endpoint: "https://api.deepseek.com/chat/completions", model: "deepseek-chat" },
};

// deno-lint-ignore no-explicit-any
export type ChatMsg = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: any[]; tool_call_id?: string };
export interface ToolDef { name: string; description: string; parameters: Record<string, unknown> }
export interface ToolCall { id: string; name: string; args: Record<string, unknown> }
export interface ChatResult {
  ok: boolean; reply?: string; toolCalls?: ToolCall[]; error?: string; status?: number;
  // deno-lint-ignore no-explicit-any
  raw?: any; // mensagem do assistente como veio (para devolver o resultado das ferramentas)
}

const FAILOVER = new Set([400, 404, 413, 422, 429, 500, 502, 503, 504]);

async function once(endpoint: string, apiKey: string, model: string, messages: ChatMsg[], tools?: ToolDef[]): Promise<ChatResult> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model, messages,
        ...(tools?.length ? { tools: tools.map((t) => ({ type: "function", function: t })), tool_choice: "auto" } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, error: translateAIError(text, res.status) };
    const msg = JSON.parse(text).choices?.[0]?.message ?? {};
    const toolCalls: ToolCall[] = (msg.tool_calls ?? []).slice(0, 5).map((c: any) => {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(c.function?.arguments || "{}"); } catch { /* argumentos inválidos = vazio */ }
      return { id: String(c.id ?? ""), name: String(c.function?.name ?? ""), args };
    });
    const reply = typeof msg.content === "string" ? msg.content.trim() : "";
    if (!reply && !toolCalls.length) return { ok: false, error: "resposta vazia da IA" };
    return { ok: true, reply, toolCalls, raw: msg };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "falha ao chamar IA" };
  }
}

/** Chave do provedor para a organização (null = não configurada). */
// deno-lint-ignore no-explicit-any
export async function providerKey(admin: any, orgId: string, provider: string): Promise<string | null> {
  if (!AI_PROVIDERS[provider]) return null;
  return await getSecret(admin, `org:${orgId}:${provider}_api_key`);
}

export async function chat(apiKey: string, provider: string, model: string, messages: ChatMsg[], tools?: ToolDef[]): Promise<ChatResult> {
  const p = AI_PROVIDERS[provider] ?? AI_PROVIDERS.groq;
  const chosen = String(model || "").trim() || p.model;
  if (provider !== "groq") return once(p.endpoint, apiKey, chosen, messages, tools);
  let last: ChatResult = { ok: false, error: "nenhum modelo disponível" };
  for (const m of await resolveModelChain(apiKey, chosen)) {
    last = await once(p.endpoint, apiKey, m, messages, tools);
    if (last.ok || !last.status || !FAILOVER.has(last.status)) break;
  }
  return last;
}
