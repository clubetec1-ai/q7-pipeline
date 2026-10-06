import { assert, assertEquals } from "jsr:@std/assert@1";
import { gate, MODE_RULE } from "./publish-gate.ts";

Deno.test("sombra: nunca envia; a resposta vira sugestão para a pessoa", () => {
  const g = gate("sombra", "Abrimos às 8h. [SIMPLES]");
  assertEquals([g.send, g.motivo, g.suggestion], [false, "sombra", "Abrimos às 8h."]);
});

Deno.test("assistido: envia o simples; o que precisa de pessoa (ou sem marca) não envia", () => {
  assertEquals(gate("assistido", "Abrimos às 8h.\n[SIMPLES]").send, true);
  assertEquals(gate("assistido", "Abrimos às 8h.\n[SIMPLES]").reply, "Abrimos às 8h.");
  const p = gate("assistido", "Sinto muito pelo atraso, vou verificar. [PESSOA]");
  assertEquals([p.send, p.motivo], [false, "precisa_pessoa"]);
  assertEquals(gate("assistido", "Resposta sem marca").send, false);
});

Deno.test("automático: envia, sem a marca aparecer para o cliente", () => {
  const g = gate("automatico", "Claro! O orçamento sai em até 2 dias. [PESSOA]");
  assertEquals([g.send, g.reply], [true, "Claro! O orçamento sai em até 2 dias."]);
});

Deno.test("trava em qualquer modo: promessa, pedir senha ou dado pessoal seguram a resposta e contam para o disjuntor", () => {
  for (const mode of ["assistido", "automatico"] as const) {
    const g = gate(mode, "Te dou 50% de desconto e me passa a senha do app. [SIMPLES]");
    assertEquals([g.send, g.motivo], [false, "bloqueio"]);
    assert(g.guard.includes("nao_promete") && g.guard.includes("nao_pede_senha"));
  }
  assertEquals(gate("automatico", "Não peça a senha a ninguém: nós nunca pedimos. [SIMPLES]").send, true);
});

Deno.test("a regra da marca fala em [SIMPLES] e [PESSOA]", () => {
  assert(MODE_RULE.includes("[SIMPLES]") && MODE_RULE.includes("[PESSOA]"));
});
