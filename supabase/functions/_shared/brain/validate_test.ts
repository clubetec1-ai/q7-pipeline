import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type PacketArea, sanitizePacket, validateOrchestration, validateProposals } from "./validate.ts";

const area: PacketArea = {
  id: "aaaaaaaa-0000-0000-0000-00000000000a", key: "vendas", nome: "Vendas", agente_ligado: true,
  indicadores: { leads_novos: 12, conversao_pct: 8 }, semana_anterior: { leads_novos: 20, conversao_pct: 10 },
  metas: [{ id: "11111111-1111-1111-1111-111111111111", titulo: "Mais leads", indicador: "leads_novos" }],
  processos: [{ nome: "Retorno da proposta" }],
};

Deno.test("evidencia inventada cai e o valor vem do pacote", () => {
  const out = validateProposals({
    propostas: [
      { titulo: "Retomar propostas paradas", tipo: "automacao", modelo: "followup", evidencias: [{ indicador: "conversao_pct", valor: 99 }, "inventado"] },
      { titulo: "Sem evidencia nenhuma", tipo: "automacao", evidencias: ["nao_existe"] },
    ],
  }, area);
  assertEquals(out.length, 1);
  assertEquals(out[0].evidencias, [{ indicador: "conversao_pct", valor: 8, semana_anterior: 10 }]);
  assertEquals(out[0].modelo, "followup");
});

Deno.test("processo existente vale sem evidencia; tipo, modelo e meta fora da lista caem", () => {
  const out = validateProposals({
    propostas: [{ titulo: "Padronizar retorno", tipo: "hackear", modelo: "rm_rf", meta_id: "x", processo: "retorno da proposta", evidencias: [] }],
  }, area);
  assertEquals(out.length, 1);
  assertEquals(out[0].tipo, "processo");
  assertEquals(out[0].modelo, null);
  assertEquals(out[0].meta_id, null);
  assertEquals(out[0].processo, "Retorno da proposta");
});

Deno.test("RH so propoe processo e no maximo 3 propostas", () => {
  const rh = { ...area, key: "rh", indicadores: { equipe_ativa: 4 } };
  const many = Array.from({ length: 6 }, (_, i) => ({ titulo: `Proposta ${i}`, tipo: "agente", evidencias: ["equipe_ativa"] }));
  const out = validateProposals({ propostas: many }, rh);
  assertEquals(out.length, 3);
  assertEquals(out.every((p) => p.tipo === "processo"), true);
});

Deno.test("orquestrador: so areas do pacote, delega so com agente ligado, texto anonimizado", () => {
  const o = validateOrchestration({
    resumo: "Ligar para (11) 99999-8888 e escrever para joao@x.com",
    prioridades: [{ area_id: area.id, titulo: "Recuperar conversão", meta_id: "11111111-1111-1111-1111-111111111111" }, { area_id: "inexistente", titulo: "X" }],
    delegar: [area.id, "bbbbbbbb-0000-0000-0000-00000000000b"],
  }, { areas: [area, { ...area, id: "bbbbbbbb-0000-0000-0000-00000000000b", key: "financeiro", agente_ligado: false }] });
  assertEquals(o.prioridades.length, 1);
  assertEquals(o.prioridades[0].meta_id, "11111111-1111-1111-1111-111111111111");
  assertEquals(o.delegar, [area.id]);
  assertEquals(o.prioridades[0].area_key, "vendas");
  assertEquals(/99999|joao@x\.com/.test(o.resumo), false);
});

Deno.test("pacote anonimizado antes de ir para a IA", () => {
  const p = sanitizePacket({ empresa: { objetivos: "Falar com Maria 11 98888-7777 maria@x.com CPF 123.456.789-00" }, areas: [{ id: "aaaaaaaa-0000-0000-0000-00000000000a" }] });
  assertEquals(/98888|maria@|123\.456/.test(JSON.stringify(p)), false);
  assertEquals(p.areas[0].id, "aaaaaaaa-0000-0000-0000-00000000000a");
});
