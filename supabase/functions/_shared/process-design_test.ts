import { assert, assertEquals } from "jsr:@std/assert@1";
import { parseDesign } from "./process-design.ts";

const METRICS = ["fila_min", "resposta_min", "conversao_pct"];

Deno.test("decisão fora da lista vira pessoa; quem faz segue a decisão; passo vazio sai; no máximo 20 passos", () => {
  const d = parseDesign({
    gatilho: "Cliente pede orçamento no WhatsApp",
    objetivo: "Enviar orçamento em até 1 dia",
    passos: [
      { o_que: "Responder com a tabela de preços", decisao: "modelo", quem: "pessoa" },
      { o_que: "Tirar dúvidas sobre os serviços", decisao: "ia" },
      { o_que: "", decisao: "fluxo" },
      { o_que: "Lembrar o cliente depois de 2 dias", decisao: "teletransporte" },
      ...Array.from({ length: 25 }, (_, i) => ({ o_que: `passo ${i}`, decisao: "fluxo" })),
    ],
    indicadores: ["fila_min", "inventado"],
  }, METRICS)!;
  assertEquals(d.passos.length, 20);
  assertEquals(d.passos.map((p) => p.n).slice(0, 3), [1, 2, 3]);
  assertEquals([d.passos[0].decisao, d.passos[0].quem], ["modelo", "fluxo"]);
  assertEquals([d.passos[1].decisao, d.passos[1].quem], ["ia", "agente"]);
  assertEquals([d.passos[2].decisao, d.passos[2].quem], ["pessoa", "pessoa"]);
  assertEquals(d.indicadores, ["fila_min"]);
});

Deno.test("trava fixa: decisão com dinheiro, contrato, saúde ou jurídico nunca fica com a IA nem com fluxo", () => {
  const d = parseDesign({
    gatilho: "x",
    passos: [
      { o_que: "Conceder desconto para cliente antigo", decisao: "ia" },
      { o_que: "Aprovar o reembolso", decisao: "fluxo" },
      { o_que: "Orientar sobre o contrato de prestação de serviço", decisao: "ia" },
      { o_que: "Enviar o boleto da mensalidade", decisao: "fluxo" },
    ],
  }, METRICS)!;
  assertEquals(d.passos.map((p) => p.decisao), ["pessoa", "pessoa", "pessoa", "fluxo"]);
  assert(d.passos[0].motivo.startsWith("Regra fixa"));
});

Deno.test("dado sensível do cliente é sempre marcado; sem base legal vira risco", () => {
  const d = parseDesign({
    gatilho: "x", passos: [{ o_que: "Cadastrar o cliente", decisao: "fluxo" }],
    dados_cliente: [{ dado: "Nome", sensivel: false }, { dado: "CPF", sensivel: false }, { dado: "Problema de saúde", sensivel: false }],
  }, METRICS)!;
  assertEquals(d.dados_cliente.map((x) => x.sensivel), [false, true, true]);
  assert(d.riscos.some((r) => r.includes("base legal")));
});

Deno.test("sem passos ou resposta inválida: nenhum desenho (nunca quebra)", () => {
  assertEquals(parseDesign({ gatilho: "x", passos: [] }, METRICS), null);
  assertEquals(parseDesign("lixo", METRICS), null);
});
