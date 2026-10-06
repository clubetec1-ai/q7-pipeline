import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildOrgChart, EXECUTOR_ONLY } from "./orgchart.ts";

const D = (id: string, name: string) => ({ id, name });
const P = (id: string, setor: string, nome: string, decisoes: string[], status = "aprovado") =>
  ({ id, setor, nome, status, design: { passos: decisoes.map((decisao, i) => ({ n: i + 1, decisao })) } });

Deno.test("empresa com equipe: cérebro → diretores → coordenadores → especialistas e executores; apoio fixo", () => {
  const out = buildOrgChart({
    members: 8,
    departments: [D("d1", "Comercial"), D("d2", "Suporte"), D("d3", "Financeiro")],
    areas: [],
    processes: [
      P("p1", "Comercial", "Orçamento", ["modelo", "ia", "pessoa"]),
      P("p2", "Comercial", "Pós-venda", ["pessoa"], "proposto"), // só aprovado vira especialista
      P("p3", "Financeiro", "Cobrança", ["pessoa", "pessoa"]),
    ],
  });
  const k = (key: string) => out.find((a) => a.key === key)!;
  assertEquals(k("cerebro").level, "cerebro");
  assertEquals(k("dir:comercial").parent, "cerebro");
  assertEquals(k("dir:atendimento").parent, "cerebro");
  assertEquals(k("dir:financeiro").parent, "cerebro");
  assertEquals(k("coord:d1").parent, "dir:comercial");
  assertEquals(k("coord:d2").parent, "dir:atendimento");
  assertEquals(k("esp:p1").parent, "coord:d1");
  assertEquals(k("esp:p1").papel, "Especialista em Orçamento (IA)");
  assertEquals(out.some((a) => a.key === "esp:p2"), false);
  assertEquals(k("exec:d1").parent, "coord:d1"); // Comercial tem passo automatizável
  assertEquals(out.some((a) => a.key === "exec:d3"), false); // Financeiro só tem passos de pessoa
  assert(out.filter((a) => a.level === "apoio").length >= 7);
  assert(out.every((a) => a.papel.endsWith("(IA)")));
});

Deno.test("empresa pequena junta os níveis: sem diretores nem coordenadores", () => {
  const out = buildOrgChart({
    members: 3, departments: [D("d1", "Atendimento")], areas: [],
    processes: [P("p1", "Atendimento", "Agendamento", ["ia", "fluxo"])],
  });
  assertEquals(out.filter((a) => a.level === "diretor" || a.level === "coordenador").length, 0);
  assertEquals(out.find((a) => a.key === "esp:p1")!.parent, "cerebro");
  assertEquals(out.find((a) => a.key === "exec:d1")!.parent, "cerebro");
});

Deno.test("crachá: só o executor vê a conversa e fala com o cliente; ninguém começa executando sozinho", () => {
  const out = buildOrgChart({ members: 10, departments: [D("d1", "Vendas")], areas: [], processes: [P("p1", "Vendas", "Venda", ["ia"])] });
  for (const a of out) {
    const exclusivo = [...a.cracha.dados, ...a.cracha.acoes].filter((x) => EXECUTOR_ONLY.has(x));
    if (a.level === "executor") assert(exclusivo.length > 0);
    else assertEquals(exclusivo, [], `${a.key} não pode ter item de executor`);
    assert(["A0", "A1", "A2"].includes(a.autonomia), `${a.key} começa no máximo preparando rascunho`);
  }
  assertEquals(out.find((a) => a.level === "executor")!.autonomia, "A1"); // sombra: sugere, a pessoa envia
});

Deno.test("áreas do cérebro definem os diretores quando existem", () => {
  const out = buildOrgChart({
    members: 9, departments: [D("d1", "Loja")],
    areas: [{ key: "vendas", department_id: "d1" }], processes: [],
  });
  assertEquals(out.find((a) => a.key === "coord:d1")!.parent, "dir:comercial");
});

Deno.test("o Assistente principal sempre entra como Atendente geral (IA), mesmo sem processos", () => {
  const out = buildOrgChart({ members: 2, departments: [], areas: [], processes: [] });
  const g = out.find((a) => a.key === "exec:geral")!;
  assertEquals([g.level, g.parent, g.autonomia], ["executor", "cerebro", "A1"]);
  assert(g.cracha.acoes.includes("passar_para_pessoa"));
});
