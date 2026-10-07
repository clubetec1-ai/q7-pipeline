import { assertEquals } from "jsr:@std/assert@1";
import { headTail, repeatedOf } from "./repeat-guard.ts";

const feitas = [
  "Olá! Vamos falar um pouco sobre a sua empresa. Quais são as principais dúvidas que os clientes costumam ter ao entrar em contato com vocês?",
  "Você poderia confirmar quais são as certificações que a Clubetec possui e como isso pode impactar a confiança dos clientes nos serviços que vocês oferecem?",
];

Deno.test("pergunta repetida (caso real da Clubetec) é reconhecida", () => {
  const nova = "Você poderia me confirmar quais são as certificações que a Clubetec possui e como isso pode impactar a confiança dos clientes nos serviços que vocês oferecem?";
  assertEquals(repeatedOf(nova, feitas), feitas[1]);
  assertEquals(repeatedOf("Quais são as certificações que a Clubetec possui?", feitas), feitas[1], "versão curta da mesma pergunta");
});

Deno.test("pergunta nova sobre outro assunto passa", () => {
  assertEquals(repeatedOf("Qual é a cidade ou região que a Clubetec atende, além de Campinas?", feitas), null);
  assertEquals(repeatedOf("Quais canais vocês usam para atender e qual o horário?", feitas), null);
});

Deno.test("texto longo da etapa: mantém começo e fim", () => {
  const t = "A".repeat(3000) + "MEIO" + "Z".repeat(8000);
  const r = headTail(t);
  assertEquals(r.startsWith("A".repeat(2000)), true);
  assertEquals(r.endsWith("Z".repeat(7000)), true);
  assertEquals(r.includes("MEIO"), false);
  assertEquals(headTail("curto"), "curto");
});
