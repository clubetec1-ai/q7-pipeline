import { assertEquals } from "jsr:@std/assert@1";
import { isReasoning, pickOpenAI } from "./model-pick.ts";

const hoje = ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o-mini-transcribe", "gpt-4.1-2025-04-14", "whisper-1"];

Deno.test("escolhe o mais atual de cada nível entre os modelos da conta", () => {
  assertEquals(pickOpenAI(hoje, "maxima"), "gpt-4.1");
  assertEquals(pickOpenAI(hoje, "analise"), "gpt-4.1-mini");
  assertEquals(pickOpenAI(hoje, "atendimento"), "gpt-4o-mini");
});

Deno.test("saiu versão nova: o automático passa a usar sozinho", () => {
  const novo = [...hoje, "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5.1", "gpt-5.1-mini"];
  assertEquals(pickOpenAI(novo, "maxima"), "gpt-5.1");
  assertEquals(pickOpenAI(novo, "analise"), "gpt-5.1-mini");
  assertEquals(pickOpenAI(novo, "atendimento"), "gpt-4o-mini");
  assertEquals(isReasoning("gpt-5.1"), true);
  assertEquals(isReasoning("gpt-4.1-mini"), false);
});

Deno.test("conta sem lista ou modelo antigo saiu: nunca fica sem modelo", () => {
  assertEquals(pickOpenAI([], "maxima"), "gpt-4o-mini");
  assertEquals(pickOpenAI(["gpt-5-mini", "gpt-5"], "atendimento"), "gpt-5-mini");
});
