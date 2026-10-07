/**
 * Modelo de IA por tipo de agente (pedido do dono, 07/10): cada agente usa o modelo de acordo com a capacidade que o
 * trabalho exige — qualidade das respostas, segurança e menor gasto de tokens. O sistema sugere (automático) e a equipe
 * Clubetec pode trocar em Plataforma → IA (tabela platform_ai_agent_models). A empresa com chave própria e modelo escolhido
 * continua mandando no dela. Modelo inválido/indisponível → volta sozinho para o padrão do fornecedor.
 */
import type { AITask } from "./get-ai-config.ts";

export type AgentKey =
  | "atendimento" | "entrevista" | "arquiteto" | "avaliador" | "guardiao" | "avaliacao_atendimento"
  | "relatorios" | "cerebro" | "plataforma" | "integracoes";

export interface AgentModelSpec {
  label: string;
  para: string;
  capacidade: AITask; // atendimento = rápido e barato; analise = o mais capaz
  /** Sugestão por fornecedor ("auto" na Groq = a cadeia da capacidade). */
  sugerido: Record<string, string>;
  /** Teto de tamanho da resposta (só onde a resposta é sempre curta: economiza tokens sem cortar nada útil). */
  maxTokens?: number;
  temperature?: number;
}

const RAPIDO = { openai: "gpt-4o-mini", groq: "auto", gemini: "gemini-2.5-flash", anthropic: "claude-haiku-4-5", openrouter: "openai/gpt-4o-mini", deepseek: "deepseek-chat" };
// Modelos fixos e conhecidos por nível (decisão do dono, 07/10): versão nova só entra depois de testada e aprovada.
const CAPAZ = { openai: "gpt-4.1-mini", groq: "auto", gemini: "gemini-2.5-flash", anthropic: "claude-haiku-4-5", openrouter: "openai/gpt-4.1-mini", deepseek: "deepseek-chat" };

const MAXIMA = { ...CAPAZ, openai: "gpt-4.1", openrouter: "openai/gpt-4.1", gemini: "gemini-2.5-pro" };

export const AGENT_MODELS: Record<AgentKey, AgentModelSpec> = {
  atendimento: { label: "Atendimento ao cliente", para: "respostas no WhatsApp, Facebook, Instagram, e-mail e no bloco de IA dos fluxos", capacidade: "atendimento", sugerido: RAPIDO, maxTokens: 700 },
  guardiao: { label: "Guardião de segurança (leitura)", para: "pontos de atenção em textos e processos (as regras fixas é que bloqueiam)", capacidade: "atendimento", sugerido: RAPIDO, maxTokens: 400, temperature: 0 },
  avaliacao_atendimento: { label: "Avaliação dos atendimentos", para: "nota e motivo de cada atendimento finalizado (alto volume)", capacidade: "atendimento", sugerido: RAPIDO, maxTokens: 800, temperature: 0 },
  avaliador: { label: "Avaliador da prova", para: "cenários de teste e conferência das respostas dos agentes", capacidade: "analise", sugerido: CAPAZ, maxTokens: 900, temperature: 0 },
  entrevista: { label: "Entrevista do Diagnóstico", para: "perguntas, revisão e organização do que o dono conta", capacidade: "analise", sugerido: CAPAZ },
  arquiteto: { label: "Arquiteto de processos", para: "desenho dos processos passo a passo", capacidade: "analise", sugerido: CAPAZ },
  relatorios: { label: "Relatórios e melhorias", para: "relatório de avaliações e propostas de melhoria", capacidade: "analise", sugerido: CAPAZ },
  // O cérebro decide pela rede de agentes: o modelo mais robusto disponível.
  cerebro: { label: "Cérebro e rede de agentes", para: "análise semanal das áreas e perguntas entre agentes", capacidade: "maxima", sugerido: MAXIMA },
  plataforma: { label: "Cérebro da plataforma", para: "diagnóstico de incidentes do software (só metadados)", capacidade: "maxima", sugerido: MAXIMA },
  integracoes: { label: "Integrações", para: "guia para ligar outros sistemas", capacidade: "analise", sugerido: CAPAZ },
};

export const AGENT_KEYS = Object.keys(AGENT_MODELS) as AgentKey[];

/** Modelos oferecidos na tela por fornecedor (a pessoa também pode digitar outro). */
export const MODEL_OPTIONS: Record<string, string[]> = {
  openai: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1", "gpt-4o"],
  groq: ["auto", "llama-3.1-8b-instant", "llama-3.3-70b-versatile", "openai/gpt-oss-20b", "openai/gpt-oss-120b"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro"],
  anthropic: ["claude-haiku-4-5"],
  openrouter: ["openai/gpt-4o-mini", "openai/gpt-4.1-mini"],
  deepseek: ["deepseek-chat"],
};

/** Modelo para o agente neste fornecedor: o escolhido pela Clubetec (se houver) ou o sugerido. */
export function modelFor(agent: AgentKey, provider: string, overrides: Record<string, string> = {}): string {
  const o = String(overrides[`${agent}:${provider}`] ?? "").trim();
  if (o && /^[\w.:/-]{2,100}$/.test(o)) return o;
  return AGENT_MODELS[agent]?.sugerido[provider] ?? "";
}
