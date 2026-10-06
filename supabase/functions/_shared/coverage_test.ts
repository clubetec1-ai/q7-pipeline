import { assertEquals } from "jsr:@std/assert@1";
import { parseCoverage } from "./coverage.ts";
import { specialistFor } from "./specialists.ts";

const spec = specialistFor("posvenda")!;

Deno.test("item fora da lista é ignorado; o que a IA não avaliou fica faltando; ordem e textos vêm da lista", () => {
  const out = parseCoverage([
    { n: 2, status: "completo", nota: "reclamação vai para o suporte em 24 h" },
    { n: 99, status: "completo" },
    { n: 1, status: "talvez" },
  ], spec);
  assertEquals(out.length, spec.precisa.length);
  assertEquals(out.map((x) => x.n), spec.precisa.map((_, i) => i + 1));
  assertEquals(out[0].status, "faltando");
  assertEquals(out[1].status, "completo");
  assertEquals(out[1].item, spec.precisa[1].item);
  assertEquals(out[1].porque, spec.precisa[1].porque);
  assertEquals(out[2].status, "faltando");
});

Deno.test("resposta sem lista vira tudo faltando (nunca quebra)", () => {
  assertEquals(parseCoverage("lixo", spec).every((x) => x.status === "faltando"), true);
});
