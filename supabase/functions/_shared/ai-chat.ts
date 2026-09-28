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
// Provedores que aceitam response_format json_object no formato OpenAI.
const JSON_MODE = new Set(["groq", "openai", "openrouter", "gemini", "deepseek"]);

/** json: pede resposta em JSON válido (quando o provedor aceita); timeoutMs/maxTokens para respostas longas. */
export interface ChatOpts { json?: boolean; timeoutMs?: number; maxTokens?: number }

async function once(endpoint: string, apiKey: string, model: string, messages: ChatMsg[], tools?: ToolDef[], opts: ChatOpts & { jsonMode?: boolean } = {}): Promise<ChatResult> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model, messages,
        ...(tools?.length ? { tools: tools.map((t) => ({ type: "function", function: t })), tool_choice: "auto" } : {}),
        ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
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

export async function chat(apiKey: string, provider: string, model: string, messages: ChatMsg[], tools?: ToolDef[], opts: ChatOpts = {}): Promise<ChatResult> {
  const p = AI_PROVIDERS[provider] ?? AI_PROVIDERS.groq;
  const chosen = String(model || "").trim() || p.model;
  const o = { ...opts, jsonMode: !!opts.json && !tools?.length && JSON_MODE.has(provider) };
  if (provider !== "groq") return once(p.endpoint, apiKey, chosen, messages, tools, o);
  let last: ChatResult = { ok: false, error: "nenhum modelo disponível" };
  for (const m of await resolveModelChain(apiKey, chosen)) {
    last = await once(p.endpoint, apiKey, m, messages, tools, o);
    if (last.ok || !last.status || !FAILOVER.has(last.status)) break;
  }
  return last;
}

export interface ResolvedAI { provider: string; apiKey: string; model: string }

/**
 * Provedor/modelo para um agente: o do bloco (se escolhido) → o PADRÃO DA
 * EMPRESA (settings.ai_provider / ai_model, em Fluxos → Chaves de IA) → Groq.
 * null = a empresa não tem chave para esse provedor.
 */
// deno-lint-ignore no-explicit-any
export async function resolveAI(admin: any, orgId: string, override?: { provider?: string | null; model?: string | null }): Promise<ResolvedAI | null> {
  const { data: o } = await admin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  const s = (o?.settings ?? {}) as Record<string, unknown>;
  const own = override?.provider && AI_PROVIDERS[override.provider] ? override.provider : null;
  const provider = own ?? (typeof s.ai_provider === "string" && AI_PROVIDERS[s.ai_provider] ? s.ai_provider : "groq");
  const apiKey = await providerKey(admin, orgId, provider);
  if (!apiKey) return null;
  let model = String(override?.model ?? "").trim();
  if (!model && !own) model = String(s.ai_model ?? "").trim();
  if (!model && provider === "groq") {
    const { data: a } = await admin.from("agent_configs").select("groq_model").eq("organization_id", orgId).maybeSingle();
    model = a?.groq_model || "auto";
  }
  return { provider, apiKey, model };
}
