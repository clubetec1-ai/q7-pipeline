import { assert, assertEquals } from "jsr:@std/assert@1";
import { guessStage, parseAnswer, takeFalta } from "./network.ts";

Deno.test("marca [FALTA: …] sai da resposta ao cliente e vira pergunta sem dado pessoal", () => {
  const r = takeFalta("Vou verificar com a equipe e já te retorno.\n[FALTA: Vocês atendem aos sábados? O cliente João 11 98888-7777 pediu]");
  assertEquals(r.reply, "Vou verificar com a equipe e já te retorno.");
  assert(r.falta && r.falta.includes("sábados"));
  assert(!r.falta!.includes("98888"), "telefone do cliente não entra na pergunta");
  assertEquals(takeFalta("Abrimos às 8h.").falta, null);
});

Deno.test("resposta de agente: só vale com sabe=true, texto e fonte da lista; o resto é 'não sei'", () => {
  assertEquals(parseAnswer({ sabe: true, resposta: "Sim, das 8h às 12h.", fonte: "diagnostico" }), { sabe: true, resposta: "Sim, das 8h às 12h.", fonte: "diagnostico" });
  assertEquals(parseAnswer({ sabe: true, resposta: "", fonte: "diagnostico" }).sabe, false);
  assertEquals(parseAnswer({ sabe: true, resposta: "x", fonte: "achismo" }).sabe, false);
  assertEquals(parseAnswer({ sabe: "sim", resposta: "x", fonte: "processos" }).sabe, false);
  assertEquals(parseAnswer("lixo").sabe, false);
});

Deno.test("etapa provável do Diagnóstico pela pergunta (cai em Empresa quando não sabe)", () => {
  assertEquals(guessStage("Vocês atendem aos sábados?"), "empresa");
  assertEquals(guessStage("Qual o prazo para trocar um produto com defeito?"), "posvenda");
  assertEquals(guessStage("Pode dar desconto à vista?"), "regras");
  assertEquals(guessStage("Qual a cor oficial da marca?"), "marca");
  assertEquals(guessStage("Que pergunta estranha"), "empresa");
});
