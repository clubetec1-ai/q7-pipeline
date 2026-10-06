import { assert, assertEquals } from "jsr:@std/assert@1";
import { STAGES } from "./company.ts";
import { needsText, specialistFor } from "./specialists.ts";

Deno.test("toda etapa do Diagnóstico tem especialista com o que o agente precisa e o porquê", () => {
  for (const st of STAGES) {
    const s = specialistFor(st.key);
    assert(s, `etapa sem especialista: ${st.key}`);
    assert(s.precisa.length >= 3, `poucos itens em ${st.key}`);
    for (const n of s.precisa) assert(n.item && n.porque, `item sem porquê em ${st.key}`);
  }
});

Deno.test("em Processos o especialista é do setor e a lista sai numerada", () => {
  const s = specialistFor("processos", "Financeiro")!;
  assertEquals(s.papel, "especialista em processos do setor Financeiro");
  assert(needsText(s).startsWith("1. "));
  assertEquals(specialistFor("inexistente"), null);
});
