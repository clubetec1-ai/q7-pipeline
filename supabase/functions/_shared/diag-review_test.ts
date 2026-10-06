import { assert, assertEquals } from "jsr:@std/assert@1";
import { parseFindings } from "./diag-review.ts";
import { reviewerFor } from "./specialists.ts";
import { STAGES } from "./company.ts";

const KEYS = STAGES.map((s) => s.key);

Deno.test("só tipos e gravidades da lista; etapas desconhecidas saem; texto vazio sai; no máximo 5", () => {
  const out = parseFindings([
    { tipo: "incoerencia", gravidade: "critica", texto: "Empresa diz que atende até 18h, Pós-venda diz suporte 24h", etapas: ["empresa", "posvenda", "inventada"], sugestao: "Defina um horário só" },
    { tipo: "opiniao", gravidade: "critica", texto: "x", etapas: [] },
    { tipo: "risco", gravidade: "urgente", texto: "Promete reembolso sem prazo", etapas: ["empresa"], sugestao: "" },
    { tipo: "lacuna_critica", gravidade: "media", texto: "", etapas: ["empresa"] },
    ...Array.from({ length: 6 }, (_, i) => ({ tipo: "risco", gravidade: "baixa", texto: `item ${i}`, etapas: ["regras"] })),
  ], KEYS);
  assertEquals(out.length, 5);
  assertEquals(out[0], { n: 1, tipo: "incoerencia", gravidade: "critica", texto: "Empresa diz que atende até 18h, Pós-venda diz suporte 24h", etapas: ["empresa", "posvenda"], sugestao: "Defina um horário só" });
  assertEquals(out[1].tipo, "risco");
  assertEquals(out[1].gravidade, "media"); // gravidade fora da lista vira média
  assert(out.every((f) => f.texto));
});

Deno.test("resposta que não é lista vira nenhuma revisão (nunca quebra)", () => {
  assertEquals(parseFindings({ itens: "x" }, KEYS), []);
});

Deno.test("toda etapa tem um revisor de área (diretor), diferente do especialista que entrevistou", () => {
  for (const st of STAGES) {
    const r = reviewerFor(st.key);
    assert(r && r.papel.endsWith("(IA)") && r.foco.length > 20, `etapa sem revisor: ${st.key}`);
  }
});
