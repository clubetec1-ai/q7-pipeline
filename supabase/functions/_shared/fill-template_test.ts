import { assertEquals } from "jsr:@std/assert@1";
import { fillTemplate, hasFields } from "./fill-template.ts";

Deno.test("preenche os campos com os dados do cliente; o que falta fica marcado, nada é inventado", () => {
  const r = fillTemplate("Contratante: {{nome}}, CPF {{ CPF_CNPJ }}, em {{data}}. Plano: {{Plano escolhido}}.", {
    nome: "Maria Silva", cpf_cnpj: "123.456.789-09", data: "07/10/2026", plano_escolhido: "",
  });
  assertEquals(r.text, "Contratante: Maria Silva, CPF 123.456.789-09, em 07/10/2026. Plano: [preencher: Plano escolhido].");
  assertEquals(r.faltando, ["Plano escolhido"]);
  assertEquals(hasFields("sem campos"), false);
  assertEquals(hasFields("Olá {{nome}}"), true);
});
