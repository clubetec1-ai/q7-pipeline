import { assert, assertEquals } from "jsr:@std/assert@1";
import { pickTemplate, processDocText } from "./implementation.ts";
import type { ProcessDesign } from "./process-design.ts";

const design = (passos: { o_que: string; decisao: "fluxo" | "modelo" | "ia" | "pessoa"; quem_detalhe?: string; ferramenta?: string }[]): ProcessDesign => ({
  gatilho: "Cliente pede orçamento no WhatsApp", objetivo: "Enviar o orçamento em até 1 dia útil",
  passos: passos.map((p, i) => ({ n: i + 1, quem: "pessoa", quem_detalhe: p.quem_detalhe ?? "", ferramenta: p.ferramenta ?? "", dados: [], prazo: "", motivo: "", ...p })),
  excecoes: [{ quando: "o cliente mora fora da cidade", o_que_fazer: "informar a taxa de deslocamento" }],
  dados_cliente: [{ dado: "Nome", sensivel: false }, { dado: "Endereço", sensivel: false }], base_legal: "execução de contrato",
  sla: "1 dia útil", indicadores: [], riscos: [], dono_do_processo: "Gerente comercial",
});

Deno.test("documento para o agente: o que o cliente precisa saber e quando passar para uma pessoa; sem ferramenta interna", () => {
  const t = processDocText("Orçamento", "Comercial", design([
    { o_que: "Enviar a tabela de preços", decisao: "modelo", ferramenta: "Planilha interna X" },
    { o_que: "Fechar o valor final com desconto", decisao: "pessoa", quem_detalhe: "Vendedor" },
  ]));
  assert(t.startsWith("Como funciona: Orçamento"));
  assert(t.includes("Cliente pede orçamento"));
  assert(t.includes("1 dia útil"));
  assert(t.includes("Nome, Endereço"));
  assert(t.includes("mora fora da cidade"));
  assert(t.includes("Fechar o valor final com desconto") && t.includes("Vendedor"), "passos de pessoa viram regra de passagem");
  assert(!t.includes("Planilha interna X"), "ferramenta interna não vai para o documento do atendimento");
});

Deno.test("fluxo pronto indicado por regra fixa (só da lista); sem passo automatizável, nenhum", () => {
  assertEquals(pickTemplate("Orçamento", design([{ o_que: "Enviar a tabela de preços e o catálogo", decisao: "modelo" }])), "catalogo");
  assertEquals(pickTemplate("Pesquisa pós-atendimento", design([{ o_que: "Perguntar a nota de satisfação", decisao: "fluxo" }])), "pesquisa");
  assertEquals(pickTemplate("Atendimento inicial", design([{ o_que: "Encaminhar para o setor certo", decisao: "fluxo" }])), "triagem");
  assertEquals(pickTemplate("Dúvidas", design([{ o_que: "Responder dúvidas sobre os serviços", decisao: "ia" }])), "faq_ia");
  assertEquals(pickTemplate("Instalação", design([{ o_que: "Instalar o equipamento na casa do cliente", decisao: "pessoa" }])), null);
});
