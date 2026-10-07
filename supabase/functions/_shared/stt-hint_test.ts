import { assert, assertEquals } from "jsr:@std/assert@1";
import { sttHint } from "./stt-hint.ts";

Deno.test("dica de vocabulário: nome da empresa e nomes próprios do Diagnóstico, sem palavras comuns", () => {
  const h = sttHint("Clubetec", ["Atendemos Campinas, Valinhos e Vinhedo. Somos autorizados Intelbras. Temos NR10 e NR35. Normalmente a gente instala."]);
  assert(h.includes("Clubetec"));
  for (const w of ["Campinas", "Valinhos", "Vinhedo", "Intelbras", "NR10", "NR35"]) assert(h.includes(w), w);
  assertEquals(h.includes("Normalmente"), false);
  assert(h.length <= 800);
});
