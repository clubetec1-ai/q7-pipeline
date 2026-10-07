import { assert, assertEquals } from "jsr:@std/assert@1";
import { AGENT_KEYS, AGENT_MODELS, MODEL_OPTIONS, modelFor } from "./ai-agents-models.ts";

Deno.test("todo agente tem sugestão para OpenAI e Groq; os de alto volume são rápidos e com teto de resposta", () => {
  for (const k of AGENT_KEYS) {
    assert(AGENT_MODELS[k].sugerido.openai, k);
    assert(AGENT_MODELS[k].sugerido.groq, k);
  }
  for (const k of ["atendimento", "avaliacao_atendimento", "guardiao"] as const) {
    assertEquals(AGENT_MODELS[k].capacidade, "atendimento");
    assert((AGENT_MODELS[k].maxTokens ?? 0) > 0, k);
  }
  assertEquals(AGENT_MODELS.entrevista.capacidade, "analise");
  assertEquals(AGENT_MODELS.cerebro.capacidade, "maxima", "o cérebro usa o mais robusto");
  assertEquals(AGENT_MODELS.plataforma.capacidade, "maxima");
  assertEquals(AGENT_MODELS.avaliador.temperature, 0);
});

Deno.test("escolha da Clubetec vale por fornecedor; sem escolha (ou inválida), o sugerido", () => {
  assertEquals(modelFor("entrevista", "openai"), "gpt-4.1-mini");
  assertEquals(modelFor("cerebro", "openai"), "gpt-4.1", "o cérebro com o mais robusto");
  assertEquals(modelFor("atendimento", "openai"), "gpt-4o-mini");
  assertEquals(modelFor("entrevista", "openai", { "entrevista:openai": "gpt-4.1" }), "gpt-4.1");
  assertEquals(modelFor("entrevista", "groq", { "entrevista:openai": "gpt-4.1" }), "auto");
  assertEquals(modelFor("entrevista", "openai", { "entrevista:openai": "x; drop table" }), "gpt-4.1-mini");
  assert(MODEL_OPTIONS.openai.includes(AGENT_MODELS.atendimento.sugerido.openai));
});
