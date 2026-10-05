import { assert, assertEquals } from "jsr:@std/assert@1";
import { renderSection } from "./report-format.ts";

Deno.test("resumo com variação e seta certa (menor é melhor)", () => {
  const r = renderSection("operacao", { resumo: { atendimentos: 12, fila_min: 3 }, por_setor: [{ setor: "Vendas", atendimentos: 12 }] },
    { resumo: { atendimentos: 10, fila_min: 5 } });
  assert(r.text.includes("Atendimentos: 12 (▲ 2 vs. antes)"));
  assert(r.text.includes("Fila média (min): 3 (▼ 2 vs. antes)"));
  assert(r.html.includes("#059669")); // fila caiu = verde
  assert(r.text.includes("Setor: Vendas"));
});

Deno.test("escapa HTML vindo dos dados", () => {
  const r = renderSection("operacao", { resumo: {}, por_setor: [{ setor: "<script>x</script>", atendimentos: 1 }] }, null);
  assert(!r.html.includes("<script>"));
  assert(r.html.includes("&lt;script&gt;"));
});

Deno.test("sem dados", () => {
  assertEquals(renderSection("ia", null, null).text, "IA e automação\nSem dados no período.");
});
