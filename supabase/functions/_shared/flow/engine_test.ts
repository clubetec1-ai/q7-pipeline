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

Deno.test("protocolo nos textos", () => {
  const g: FlowGraph = { nodes: [{ id: "m", type: "message", data: { text: "Protocolo {protocolo}" } }], edges: [] };
  const r = advance(g, "m", null, { ...ctx, protocol: "2026-000009" });
  assertEquals(r.actions[0], { type: "send", text: "Protocolo 2026-000009" });
});

Deno.test("espera: para no relogio e segue por elapsed ou replied", () => {
  const g: FlowGraph = {
    nodes: [
      { id: "s", type: "start", data: {} },
      { id: "w", type: "wait", data: { minutes: 5000 } },
      { id: "a", type: "message", data: { text: "passou" } },
      { id: "b", type: "message", data: { text: "respondeu" } },
    ],
    edges: [
      { source: "s", sourceHandle: "first_contact", target: "w" },
      { source: "w", sourceHandle: "elapsed", target: "a" },
      { source: "w", sourceHandle: "replied", target: "b" },
    ],
  };
  const r1 = advance(g, "s", null, ctx);
  assertEquals([r1.state, r1.currentNodeId, r1.waitMinutes], ["waiting_timer", "w", 1380]);
  const r2 = advance(g, "w", null, { ...ctx, timerFired: true });
  assertEquals(r2.actions[0], { type: "send", text: "passou" });
  const r3 = advance(g, "w", "oi", ctx);
  assertEquals(r3.actions[0], { type: "send", text: "respondeu" });
});

Deno.test("menu com tempo limite: timeout pelo relogio", () => {
  const g: FlowGraph = {
    nodes: [
      { id: "m", type: "menu", data: { text: "Escolha", options: [{ id: "x", label: "X" }], timeout_minutes: 30 } },
      { id: "t", type: "message", data: { text: "sumiu?" } },
    ],
    edges: [{ source: "m", sourceHandle: "timeout", target: "t" }],
  };
  assertEquals(advance(g, "m", null, ctx).waitMinutes, 30);
  const r = advance(g, "m", null, { ...ctx, timerFired: true });
  assertEquals(r.actions[0], { type: "send", text: "sumiu?" });
});

Deno.test("pesquisa: nota, comentario e resposta invalida", () => {
  const g: FlowGraph = {
    nodes: [{ id: "p", type: "survey", data: { kind: "csat", comment: "Quer comentar?" } }],
    edges: [],
  };
  const ask = advance(g, "p", null, ctx);
  assertEquals([ask.state, ask.waitMinutes, ask.vars.__sv], ["waiting_input", 1440, "r"]);
  const rated = advance(g, "p", "5 estrelas", { ...ctx, vars: ask.vars });
  assertEquals(rated.actions[0], { type: "rating", value: 5 });
  assertEquals(rated.vars.__sv, "c");
  const done = advance(g, "p", "otimo", { ...ctx, vars: rated.vars });
  assertEquals(done.actions[0], { type: "rating_comment", text: "otimo" });
  assertEquals(done.vars.__sv, undefined);
  const bad = advance(g, "p", "quero outra coisa", { ...ctx, vars: ask.vars });
  assertEquals([bad.state, bad.passthrough, bad.actions.length], ["done", true, 0]);
  assertEquals(advance(g, "p", "6", { ...ctx, vars: ask.vars }).passthrough, true);
});

Deno.test("http: para para o executor chamar e segue por success/error", () => {
  const g: FlowGraph = {
    nodes: [
      { id: "h", type: "http", data: { url: "https://api.x.com" } },
      { id: "ok", type: "message", data: { text: "Pedido {var.status}" } },
      { id: "err", type: "message", data: { text: "Sistema fora" } },
    ],
    edges: [{ source: "h", sourceHandle: "success", target: "ok" }, { source: "h", sourceHandle: "error", target: "err" }],
  };
  const r1 = advance(g, "h", null, ctx);
  assertEquals([r1.state, r1.currentNodeId], ["http", "h"]);
  const r2 = advance(g, "h", null, { ...ctx, vars: { status: "enviado" }, httpResult: "success" });
  assertEquals(r2.actions[0], { type: "send", text: "Pedido enviado" });
  assertEquals(advance(g, "h", null, { ...ctx, httpResult: "error" }).actions[0], { type: "send", text: "Sistema fora" });
});
