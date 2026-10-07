import { assertEquals } from "jsr:@std/assert@1";
import { isDataDeletionRequest } from "./lgpd-request.ts";

Deno.test("pedido de apagar os dados é reconhecido", () => {
  for (const t of ["Quero que apaguem meus dados", "por favor excluam todos os meus dados", "Solicito excluir meus dados pessoais",
    "remover meu cadastro", "Exerço meu direito ao esquecimento"]) assertEquals(isDataDeletionRequest(t), true, t);
});

Deno.test("conversa normal não vira pedido", () => {
  for (const t of ["Não quero apagar meus dados, só atualizar o e-mail", "quais dados vocês precisam?", "apaguei a mensagem sem querer",
    "meus dados estão certos?", "ok"]) assertEquals(isDataDeletionRequest(t), false, t);
});
