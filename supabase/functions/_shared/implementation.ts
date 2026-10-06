/**
 * Implantação pelo organograma (desenho 07, fatia 9) — regras puras.
 *  - processDocText: o documento "Como funciona" que o agente usa no atendimento: o que o cliente precisa saber
 *    (começo, objetivo, prazo, o que informar, passos, casos diferentes) e QUANDO PASSAR PARA UMA PESSOA. Detalhes
 *    internos (ferramenta, base legal, riscos, indicadores) ficam de fora.
 *  - pickTemplate: o fluxo pronto mais adequado, por regra fixa e só da lista do Implementador (ou nenhum).
 */
import type { ProcessDesign } from "./process-design.ts";

export function processDocText(nome: string, setor: string, d: ProcessDesign): string {
  const linhas: string[] = [`Como funciona: ${nome} (setor ${setor})`];
  if (d.gatilho) linhas.push(`Começa quando: ${d.gatilho}`);
  if (d.objetivo) linhas.push(`Objetivo: ${d.objetivo}`);
  if (d.sla) linhas.push(`Prazo: ${d.sla}`);
  if (d.dados_cliente.length) linhas.push(`O que o cliente precisa informar: ${d.dados_cliente.map((x) => x.dado).join(", ")}`);
  linhas.push("Passo a passo:", ...d.passos.map((p) => `${p.n}. ${p.o_que}${p.prazo ? ` (${p.prazo})` : ""}`));
  if (d.excecoes.length) linhas.push("Casos diferentes:", ...d.excecoes.map((e) => `- Quando ${e.quando}: ${e.o_que_fazer}`));
  const pessoa = d.passos.filter((p) => p.decisao === "pessoa");
  if (pessoa.length) {
    linhas.push("Quando passar para uma pessoa da equipe (o agente não decide isso sozinho):",
      ...pessoa.map((p) => `- ${p.o_que}${p.quem_detalhe ? ` → ${p.quem_detalhe}` : ""}`));
  }
  return linhas.join("\n").slice(0, 12_000);
}

const RULES: [string, RegExp][] = [
  ["pesquisa", /pesquisa|satisfa[çc][ãa]o|nota de|avalia/i],
  ["catalogo", /cat[aá]logo|tabela de pre[çc]o|tabela|or[çc]amento padr/i],
  ["qualificacao", /qualific|interesse|lead|prospec/i],
  ["followup", /lembrete|retornar|n[ãa]o respondeu|follow/i],
  ["dados_ficha", /coletar dados|cadastr|pedir (o )?(nome|e-?mail|cpf|endere)/i],
  ["fora_horario", /fora do hor[aá]rio|hor[aá]rio de atendimento/i],
  ["triagem", /triagem|encaminh|setor certo|direcionar/i],
];

export function pickTemplate(nome: string, d: ProcessDesign): string | null {
  const auto = d.passos.filter((p) => p.decisao !== "pessoa");
  if (!auto.length) return null;
  const texto = `${nome} ${auto.map((p) => p.o_que).join(" ")}`;
  for (const [key, re] of RULES) if (re.test(texto)) return key;
  return auto.some((p) => p.decisao === "ia") ? "faq_ia" : null;
}
