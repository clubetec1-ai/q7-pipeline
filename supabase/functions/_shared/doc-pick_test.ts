import { assert, assertEquals } from "jsr:@std/assert@1";
import { pickDocText } from "./doc-pick.ts";

const pad = (s: string) => s + " " + "x".repeat(900);

Deno.test("cabendo, entra tudo, na ordem, sem repetir o mesmo arquivo anexado duas vezes", () => {
  const out = pickDocText([
    { doc_id: "b", ord: 0, content: "Manual do colaborador" },
    { doc_id: "a", ord: 1, content: "Valores: honestidade" },
    { doc_id: "a", ord: 0, content: "Missão: tornar o mundo mais seguro" },
    { doc_id: "c", ord: 0, content: "Missão: tornar o mundo mais seguro" }, // cópia
  ], ["a", "b", "c"], "", 10_000, { a: "cultura.docx", b: "manual.pdf" });
  assertEquals(out, "=== Documento: cultura.docx ===\nMissão: tornar o mundo mais seguro\nValores: honestidade\n\n=== Documento: manual.pdf ===\nManual do colaborador");
});

Deno.test("sem espaço, o trecho sobre o assunto da pergunta entra mesmo estando no fim", () => {
  const chunks = Array.from({ length: 20 }, (_, i) => ({ doc_id: "m", ord: i, content: pad(`Página ${i}: política de uso de veículos e EPIs`) }));
  chunks[15] = { doc_id: "m", ord: 15, content: pad("Página 15: jamais discutir com clientes; direcionar reclamações para os canais apropriados") };
  const out = pickDocText(chunks, ["m"], "O que vocês fazem quando chega uma reclamação de cliente insatisfeito?", 3_000);
  assert(out.includes("reclamações"), "o trecho da reclamação precisa entrar");
  assert(out.includes("Página 0"), "o começo do documento dá o contexto");
  assert(out.includes("[...]"), "marca onde houve corte");
  assert(out.length < 3_200);
});
