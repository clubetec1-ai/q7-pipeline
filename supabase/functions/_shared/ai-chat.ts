/**
 * Chat com o provedor de IA escolhido no bloco do fluxo. Todos falam o formato
 * de chat da OpenAI (inclusive ferramentas). A chave de cada provedor vem do
 * Vault da organização (org:<org>:<provedor>_api_key); nunca do navegador.
 * Groq mantém a cadeia de modelos com failover de get-ai-config.
 */
import { effortFor, isReasoning } from "./model-pick.ts";
import { AGENT_MODELS, type AgentKey, modelFor } from "./ai-agents-models.ts";
import { getSecret } from "./secrets.ts";
import { withPolicy } from "./ai-policy.ts";
import { esc, sendSystemEmail } from "./email.ts";
import { type AITask, resolveModelChain, translateAIError } from "./get-ai-config.ts";

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
  usage?: { in: number; out: number };
  // deno-lint-ignore no-explicit-any
  raw?: any; // mensagem do assistente como veio (para devolver o resultado das ferramentas)
}

const FAILOVER = new Set([400, 404, 413, 422, 429, 500, 502, 503, 504]);
// Provedores que aceitam response_format json_object no formato OpenAI.
const JSON_MODE = new Set(["groq", "openai", "openrouter", "gemini", "deepseek"]);

/** json: pede resposta em JSON válido (quando o provedor aceita); timeoutMs/maxTokens para respostas longas. */
export interface ChatOpts { json?: boolean; timeoutMs?: number; maxTokens?: number; temperature?: number; task?: AITask }

/**
 * Modelo por tipo de agente (catálogo em ai-agents-models.ts + escolha da Clubetec em platform_ai_agent_models, cache de
 * 5 min). Empresa com chave própria e modelo escolhido continua com o dela. As reservas recebem o modelo do agente no
 * fornecedor delas.
 */
let agentCache: { at: number; map: Record<string, string> } = { at: 0, map: {} };
// deno-lint-ignore no-explicit-any
async function agentOverrides(admin: any): Promise<Record<string, string>> {
  if (Date.now() - agentCache.at < 300_000) return agentCache.map;
  try {
    const { data } = await admin.from("platform_ai_agent_models").select("agent, provider, model");
    agentCache = { at: Date.now(), map: Object.fromEntries((data ?? []).map((r: { agent: string; provider: string; model: string }) => [`${r.agent}:${r.provider}`, r.model])) };
  } catch { agentCache = { at: Date.now(), map: {} }; }
  return agentCache.map;
}
// deno-lint-ignore no-explicit-any
export async function forAgent(admin: any, ai: ResolvedAI, agent: AgentKey): Promise<ResolvedAI> {
  const spec = AGENT_MODELS[agent];
  const ov = await agentOverrides(admin);
  const one = (x: ResolvedAI): ResolvedAI => ({
    ...x, task: spec.capacidade,
    model: x.source === "propria" && x.model ? x.model : modelFor(agent, x.provider, ov) || x.model,
    opts: { ...(spec.maxTokens ? { maxTokens: spec.maxTokens } : {}), ...(spec.temperature !== undefined ? { temperature: spec.temperature } : {}) },
  });
  return { ...one(ai), fallbacks: ai.fallbacks?.map(one) };
}

/** A mesma IA resolvida (com as reservas) marcada para uma tarefa. */
export const forTask = (ai: ResolvedAI, task: AITask): ResolvedAI => ({ ...ai, task, fallbacks: ai.fallbacks?.map((f) => ({ ...f, task })) });

async function once(endpoint: string, apiKey: string, model: string, messages: ChatMsg[], tools?: ToolDef[], opts: ChatOpts & { jsonMode?: boolean } = {}): Promise<ChatResult> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model, messages: withPolicy(messages),
        ...(tools?.length ? { tools: tools.map((t) => ({ type: "function", function: t })), tool_choice: "auto" } : {}),
        ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
        // Modelos que raciocinam: teto inclui o raciocínio, sem temperatura e com esforço menor fora do cérebro (menos tokens).
        ...(isReasoning(model)
          ? { ...(opts.maxTokens ? { max_completion_tokens: opts.maxTokens * 4 + 1000 } : {}), reasoning_effort: effortFor(opts.task) }
          : { ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}), ...(typeof opts.temperature === "number" ? { temperature: opts.temperature } : {}) }),
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, error: translateAIError(text, res.status) };
    const parsed = JSON.parse(text);
    const msg = parsed.choices?.[0]?.message ?? {};
    const usage = { in: Number(parsed.usage?.prompt_tokens) || 0, out: Number(parsed.usage?.completion_tokens) || 0 };
    const toolCalls: ToolCall[] = (msg.tool_calls ?? []).slice(0, 5).map((c: any) => {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(c.function?.arguments || "{}"); } catch { /* argumentos inválidos = vazio */ }
      return { id: String(c.id ?? ""), name: String(c.function?.name ?? ""), args };
    });
    const reply = typeof msg.content === "string" ? msg.content.trim() : "";
    if (!reply && !toolCalls.length) return { ok: false, error: "resposta vazia da IA" };
    return { ok: true, reply, toolCalls, raw: msg, usage };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "falha ao chamar IA" };
  }
}

/** Chave PRÓPRIA da empresa para o provedor (null = não configurada). */
// deno-lint-ignore no-explicit-any
export async function providerKey(admin: any, orgId: string, provider: string): Promise<string | null> {
  if (!AI_PROVIDERS[provider]) return null;
  return await getSecret(admin, `org:${orgId}:${provider}_api_key`);
}

const SLOTS = ["principal", "reserva1", "reserva2"];

/**
 * IA da Clubetec incluída: Principal → Reserva 1 → Reserva 2 (Plataforma → Conectores),
 * usada quando a empresa não tem chave própria. A empresa pode recusar com
 * settings.ai_platform = false. Sem posições cadastradas, usa a chave Groq antiga.
 */
// deno-lint-ignore no-explicit-any
export async function platformChain(admin: any, orgId: string): Promise<ResolvedAI[]> {
  const { data: o } = await admin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  if ((o?.settings as Record<string, unknown> | null)?.ai_platform === false) return [];
  const { data: rows } = await admin.from("platform_ai_slots").select("slot, provider, model");
  const chain: ResolvedAI[] = [];
  for (const slot of SLOTS) {
    const r = (rows ?? []).find((x: { slot: string }) => x.slot === slot);
    if (!r || !AI_PROVIDERS[r.provider]) continue;
    const apiKey = await getSecret(admin, `platform:ai:${slot}`);
    if (apiKey) chain.push({ provider: r.provider, apiKey, model: r.model || AI_PROVIDERS[r.provider].model, source: "plataforma", slot, orgId, admin });
  }
  if (!chain.length) {
    const legacy = await getSecret(admin, "platform:groq_api_key");
    if (legacy) chain.push({ provider: "groq", apiKey: legacy, model: "auto", source: "plataforma", orgId, admin });
  }
  return chain;
}

/**
 * Provedor para transcrever áudio (só OpenAI e Groq têm a API): a chave própria do provedor
 * que a empresa escolheu → a IA da Clubetec (na ordem das posições) → qualquer chave própria antiga.
 */
// deno-lint-ignore no-explicit-any
export async function audioAI(admin: any, orgId: string): Promise<ResolvedAI | null> {
  const { data: o } = await admin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  const chosen = (o?.settings as Record<string, unknown> | null)?.ai_provider;
  if (chosen === "openai" || chosen === "groq") {
    const own = await providerKey(admin, orgId, chosen);
    if (own) return { provider: chosen, apiKey: own, model: "", source: "propria", orgId, admin };
  }
  const plat = (await platformChain(admin, orgId)).find((a) => a.provider === "openai" || a.provider === "groq");
  if (plat) return plat;
  for (const provider of ["openai", "groq"]) {
    const own = await providerKey(admin, orgId, provider);
    if (own) return { provider, apiKey: own, model: "", source: "propria", orgId, admin };
  }
  return null;
}

/** Soma o consumo do dia da empresa (nunca derruba a chamada). */
export async function recordUsage(ai: ResolvedAI, usage: { in: number; out: number } | undefined, audio = 0) {
  if (!ai.admin || !ai.orgId) return;
  if (ai.slot) { try { await ai.admin.rpc("service_ai_slot_ok", { slot_name: ai.slot }); } catch { /* informativo */ } }
  try {
    await ai.admin.rpc("service_ai_usage_add", {
      org: ai.orgId, provider_name: ai.provider, source_name: ai.source ?? "propria",
      n_calls: audio ? 0 : 1, n_in: usage?.in ?? 0, n_out: usage?.out ?? 0, n_audio: audio,
    });
  } catch { /* consumo é informativo */ }
}

/** Guarda a última falha da posição da plataforma (aviso em Plataforma → Conectores). */
async function markSlotError(ai: ResolvedAI, err?: string) {
  if (!ai.slot || !ai.admin) return;
  try { await ai.admin.rpc("service_ai_slot_error", { slot_name: ai.slot, err: err ?? "falha" }); } catch { /* informativo */ }
}

const SLOT_LABEL: Record<string, string> = { principal: "Principal", reserva1: "Reserva 1", reserva2: "Reserva 2" };

/** E-mail de segurança quando a IA da plataforma troca para a reserva (no máximo 1 a cada 30 min por posição). */
async function alertFailover(from: ResolvedAI, to: ResolvedAI, err?: string) {
  if (!from.slot || !from.admin) return;
  try {
    const { data: go } = await from.admin.rpc("service_ai_failover_alert", { slot_name: from.slot });
    if (go !== true) return;
    const { data: to_ } = await from.admin.rpc("service_platform_alert_recipients");
    const what = `${SLOT_LABEL[from.slot] ?? from.slot} (${from.provider}) falhou; usando ${SLOT_LABEL[to.slot ?? ""] ?? "reserva"} (${to.provider})`;
    const text = `A IA da plataforma trocou para a reserva.

${what}.
Erro: ${err ?? "sem detalhe"}
Horário: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}

Confira em Plataforma → Conectores → IA da Clubetec.`;
    for (const addr of ((to_ as string[] | null) ?? []).slice(0, 5)) {
      await sendSystemEmail(from.admin, {
        to: addr, subject: `[Deixa com a IA] IA: ${what}`, text,
        html: `<p>A IA da plataforma trocou para a reserva.</p><p><b>${esc(what)}</b><br>Erro: ${esc(err ?? "sem detalhe")}</p><p>Confira em Plataforma → Conectores → IA da Clubetec.</p>`,
      });
    }
  } catch (e) {
    console.error("[ia] aviso de troca falhou", e instanceof Error ? e.message : e);
  }
}

// Falhas que justificam tentar a reserva (fora do ar, limite, chave inválida, modelo inexistente, sem resposta).
const SWITCH = new Set([401, 403, 404, 408, 429, 500, 502, 503, 504]);

/**
 * Chamada de IA com o provedor resolvido: tenta a Principal e, se falhar, as reservas
 * da plataforma na ordem. Registra o consumo da empresa e a falha da posição.
 */
export async function chatAI(ai: ResolvedAI, messages: ChatMsg[], tools?: ToolDef[], opts: ChatOpts = {}): Promise<ChatResult> {
  const task = ai.task;
  let r = await chat(ai.apiKey, ai.provider, ai.model, messages, tools, { task, ...ai.opts, ...opts });
  if (r.ok) { await recordUsage(ai, r.usage); return r; }
  for (const next of ai.fallbacks ?? []) {
    if (r.status && !SWITCH.has(r.status)) break;
    await markSlotError(ai, r.error);
    console.error("[ia] trocando para a reserva", { de: ai.slot, para: next.slot, status: r.status });
    await alertFailover(ai, next, r.error);
    ai = next;
    r = await chat(next.apiKey, next.provider, next.model, messages, tools, { task, ...next.opts, ...opts });
    if (r.ok) { await recordUsage(next, r.usage); return r; }
  }
  if (!r.ok) await markSlotError(ai, r.error);
  return r;
}

/** Nível máximo (cérebro): o mais robusto conhecido e aprovado por fornecedor. */
export const MAX_MODEL: Record<string, string> = { openai: "gpt-4.1", gemini: "gemini-2.5-pro", anthropic: "claude-haiku-4-5" };

/** Modelo mais capaz por provedor para tarefas de análise (entrevista, Arquiteto, avaliações, prova…). */
export const ANALYSIS_MODEL: Record<string, string> = { openai: "gpt-4.1-mini", gemini: "gemini-2.5-flash", anthropic: "claude-haiku-4-5" };

export async function chat(apiKey: string, provider: string, model: string, messages: ChatMsg[], tools?: ToolDef[], opts: ChatOpts = {}): Promise<ChatResult> {
  const p = AI_PROVIDERS[provider] ?? AI_PROVIDERS.groq;
  const chosen = String(model || "").trim() || p.model;
  const o = { ...opts, jsonMode: !!opts.json && !tools?.length && JSON_MODE.has(provider) };
  // Sem modelo escolhido: o modelo fixo do nível (análise ou máximo); atendimento usa o padrão do fornecedor.
  const auto = !String(model || "").trim() || model === "auto";
  const pick = auto && opts.task === "maxima" ? MAX_MODEL[provider] ?? ANALYSIS_MODEL[provider] ?? chosen
    : auto && opts.task === "analise" ? ANALYSIS_MODEL[provider] ?? chosen : chosen;
  if (provider !== "groq") {
    const r = await once(p.endpoint, apiKey, pick, messages, tools, o);
    // Modelo escolhido inexistente ou sem acesso: volta para o padrão do fornecedor (nunca deixa o agente sem resposta).
    if (!r.ok && pick !== p.model && r.status && [400, 403, 404].includes(r.status)) return once(p.endpoint, apiKey, p.model, messages, tools, o);
    return r;
  }
  let last: ChatResult = { ok: false, error: "nenhum modelo disponível" };
  for (const m of await resolveModelChain(apiKey, chosen, opts.task)) {
    last = await once(p.endpoint, apiKey, m, messages, tools, o);
    if (last.ok || !last.status || !FAILOVER.has(last.status)) break;
  }
  return last;
}

export interface ResolvedAI {
  provider: string; apiKey: string; model: string;
  /** Tarefa (escolhe o modelo quando a posição não fixou um): atendimento = rápido; analise = o mais capaz. */
  task?: AITask;
  /** Padrões do tipo de agente (teto de tokens, temperatura); a chamada pode sobrescrever. */
  opts?: ChatOpts;
  /** "propria" = chave da empresa; "plataforma" = IA da Clubetec (posição em slot). */
  source?: "propria" | "plataforma"; slot?: string;
  /** Reservas da plataforma, na ordem, usadas por chatAI se esta falhar. */
  fallbacks?: ResolvedAI[];
  orgId?: string;
  // deno-lint-ignore no-explicit-any
  admin?: any;
}

/**
 * Provedor/modelo para um agente: o do bloco (se escolhido) → o PADRÃO DA
 * EMPRESA (settings.ai_provider / ai_model, em Configurações → Chaves de IA) → a IA da
 * Clubetec (Plataforma → Conectores: OpenAI principal) → chave Groq antiga da empresa.
 * null = a empresa não tem chave para esse provedor.
 */
// deno-lint-ignore no-explicit-any
export async function resolveAI(admin: any, orgId: string, override?: { provider?: string | null; model?: string | null }): Promise<ResolvedAI | null> {
  const { data: o } = await admin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  const s = (o?.settings ?? {}) as Record<string, unknown>;
  const own = override?.provider && AI_PROVIDERS[override.provider] ? override.provider : null;
  const chosen = own ?? (typeof s.ai_provider === "string" && AI_PROVIDERS[s.ai_provider] ? s.ai_provider : null);
  // Sem provedor escolhido (no bloco ou em Configurações → Chaves de IA): IA da Clubetec
  // (Principal → reservas). Uma chave Groq antiga da empresa só entra se a plataforma não tiver IA.
  const provider = chosen ?? "groq";
  const apiKey = chosen ? await providerKey(admin, orgId, provider) : null;
  if (!apiKey) {
    // Sem chave própria: IA da Clubetec (Principal, com as reservas para chatAI).
    const [first, ...rest] = await platformChain(admin, orgId);
    if (first) return { ...first, fallbacks: rest };
    if (chosen) return null;
    const legacy = await providerKey(admin, orgId, "groq");
    if (!legacy) return null;
    const { data: a } = await admin.from("agent_configs").select("groq_model").eq("organization_id", orgId).maybeSingle();
    return { provider: "groq", apiKey: legacy, model: a?.groq_model || "auto", source: "propria", orgId, admin };
  }
  let model = String(override?.model ?? "").trim();
  if (!model && !own) model = String(s.ai_model ?? "").trim();
  if (!model && provider === "groq") {
    const { data: a } = await admin.from("agent_configs").select("groq_model").eq("organization_id", orgId).maybeSingle();
    model = a?.groq_model || "auto";
  }
  return { provider, apiKey, model, source: "propria", orgId, admin };
}
