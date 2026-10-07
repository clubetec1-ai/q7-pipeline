import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildDevTask, parseDiag, reviewDiag, TEAMS } from "./platform-brain.ts";

const base = {
  hipotese: "A função sync-email passa do tempo limite quando a caixa tem muitas mensagens.",
  evidencias: ["14 respostas 503 em 2 horas"], tipo: "codigo", plano: ["Ler em lotes menores", "Guardar o ponto onde parou"],
  arquivos: ["supabase/functions/sync-email/index.ts", "https://evil.example/x", "../segredo"], testes: ["Teste do lote de 50 mensagens"],
  risco: "Atrasar a leitura de e-mails", verificar: "As respostas 503 param de aparecer",
};

Deno.test("diagnóstico da IA: listas fechadas e só caminhos do repositório", () => {
  const d = parseDiag(base)!;
  assertEquals(d.tipo, "codigo");
  assertEquals(d.arquivos, ["supabase/functions/sync-email/index.ts"]);
  assertEquals(parseDiag({ hipotese: "x" }), null, "sem plano não é diagnóstico");
  assertEquals(parseDiag({ ...base, tipo: "apagar tudo" })!.tipo, "operacao");
});

Deno.test("Guardião da plataforma e QA por regra fixa", () => {
  assertEquals(reviewDiag(parseDiag(base)!).status, "aprovado");
  const semTeste = reviewDiag(parseDiag({ ...base, testes: [] })!);
  assert(semTeste.achados.some((a) => a.quem === "qa"), "código sem teste reprova");
  for (const p of ["Desativar o RLS da tabela messages", "Usar a service_role no front", "DROP TABLE messages", "Publicar direto na main", "pular os testes"]) {
    assertEquals(reviewDiag(parseDiag({ ...base, plano: [p] })!).status, "reprovado", p);
  }
  assertEquals(reviewDiag(parseDiag({ ...base, plano: ["Avisar o cliente 123.456.789-09"] })!).status, "reprovado", "dado pessoal no texto");
});

Deno.test("tarefa para o desenvolvimento: equipe, plano, testes obrigatórios, verificação e travas", () => {
  const t = buildDevTask({ titulo: "Chamadas internas com erro 503", kind: "chamada_interna_falhou", equipe: "engenharia_back", gravidade: "media", empresas: 0, ocorrencias: 14, evidencia: { codigo: 503 } }, parseDiag(base)!);
  assert(t.includes(TEAMS.engenharia_back.equipe));
  assert(t.includes("1. Ler em lotes menores"));
  assert(t.includes("- [ ] Teste do lote de 50 mensagens"));
  assert(t.includes("isolation.sql"));
  assert(t.includes("aprovação humana"));
});
