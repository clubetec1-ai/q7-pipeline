import { assertEquals } from "jsr:@std/assert@1";
import { ANALYSIS_PREFERENCE, MODEL_PREFERENCE, preferenceFor } from "./get-ai-config.ts";
import { forTask, type ResolvedAI } from "./ai-chat.ts";

Deno.test("modelo por tarefa: atendimento rápido primeiro; análise o mais capaz primeiro", () => {
  assertEquals(preferenceFor(), MODEL_PREFERENCE);
  assertEquals(preferenceFor("atendimento")[0], "llama-3.1-8b-instant");
  assertEquals(preferenceFor("analise"), ANALYSIS_PREFERENCE);
  assertEquals(ANALYSIS_PREFERENCE.indexOf("llama-3.1-8b-instant") > ANALYSIS_PREFERENCE.indexOf("llama-3.3-70b-versatile"), true);
});

Deno.test("a tarefa acompanha as reservas (a troca para a reserva não volta para o modelo rápido)", () => {
  const ai: ResolvedAI = { provider: "openai", apiKey: "x", model: "", fallbacks: [{ provider: "groq", apiKey: "y", model: "auto" }] };
  const t = forTask(ai, "analise");
  assertEquals(t.task, "analise");
  assertEquals(t.fallbacks?.[0].task, "analise");
  assertEquals(ai.task, undefined, "não altera o original");
});
