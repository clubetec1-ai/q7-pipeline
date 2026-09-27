import { assertEquals } from "jsr:@std/assert@1";
import { advance, FlowCtx, FlowGraph, validate } from "./engine.ts";

const ctx: FlowCtx = {
  firstContact: true, weekday: 1, minutes: 10 * 60, tagIds: [], groupIds: [], contactName: "Maria Silva",
  vars: {}, attempts: 0, aiTurns: 0, businessHours: { "1": [{ start: "08:00", end: "18:00" }] },
};

const graph: FlowGraph = {
  nodes: [
    { id: "s", type: "start", data: {} },
    { id: "h", type: "business_hours", data: {} },
    { id: "m", type: "menu", data: { text: "Oi {nome}!", options: [{ id: "v", label: "Vendas" }, { id: "s2", label: "Suporte" }] } },
    { id: "t", type: "transfer", data: { department_id: "D1", text: "Vou te passar para Vendas" } },
    { id: "fechado", type: "message", data: { text: "Estamos fechados" } },
  ],
  edges: [
    { source: "s", sourceHandle: "first_contact", target: "h" },
    { source: "h", sourceHandle: "open", target: "m" },
    { source: "h", sourceHandle: "closed", target: "fechado" },
    { source: "m", sourceHandle: "opt:v", target: "t" },
  ],
};

Deno.test("aberto: mostra o menu numerado com o nome e espera", () => {
  const r = advance(graph, "s", null, ctx);
  assertEquals(r.state, "waiting_input");
  assertEquals(r.currentNodeId, "m");
  assertEquals(r.actions[0], { type: "send", text: "Oi Maria!\n\n1 - Vendas\n2 - Suporte" });
});

Deno.test("resposta 1 transfere para o departamento", () => {
  const r = advance(graph, "m", "1", ctx);
  assertEquals(r.state, "done");
  assertEquals(r.actions.at(-1), { type: "transfer", departmentId: "D1", userId: null });
});

Deno.test("opcao sem ligacao termina na fila geral", () => {
  const r = advance(graph, "m", "suporte", ctx);
  assertEquals(r.actions.at(-1), { type: "queue" });
});

Deno.test("invalida pede de novo e depois segue 'invalid' (sem ligacao = fila)", () => {
  const r1 = advance(graph, "m", "xyz", ctx);
  assertEquals(r1.state, "waiting_input");
  assertEquals(r1.attempts, 1);
  const r2 = advance(graph, "m", "xyz", { ...ctx, attempts: 1 });
  assertEquals(r2.actions.at(-1), { type: "queue" });
});

Deno.test("fechado: mensagem e fila geral", () => {
  const r = advance(graph, "s", null, { ...ctx, minutes: 20 * 60 });
  assertEquals(r.actions, [{ type: "send", text: "Estamos fechados" }, { type: "queue" }]);
});

Deno.test("ciclo sem espera para no limite", () => {
  const loop: FlowGraph = {
    nodes: [{ id: "a", type: "message", data: { text: "x" } }, { id: "b", type: "message", data: { text: "y" } }],
    edges: [{ source: "a", target: "b" }, { source: "b", target: "a" }],
  };
  const r = advance(loop, "a", null, ctx);
  assertEquals(r.state, "error");
});

Deno.test("IA: palavra de transbordo transfere", () => {
  const g: FlowGraph = { nodes: [{ id: "ai", type: "ai_agent", data: { handoff_department_id: "D9" } }], edges: [] };
  const r = advance(g, "ai", "quero falar com um atendente", { ...ctx, aiTurns: 1 });
  assertEquals(r.actions.at(-1), { type: "transfer", departmentId: "D9", userId: null });
});

Deno.test("validacoes", () => {
  assertEquals(validate("email", "A@B.com"), "a@b.com");
  assertEquals(validate("cpf_cnpj", "123.456.789-09"), "12345678909");
  assertEquals(validate("date", "31/02/2026"), null);
  assertEquals(validate("date", "05/03/2026"), "2026-03-05");
});
