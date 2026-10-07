import { assertEquals } from "jsr:@std/assert@1";
import { aiKindOf } from "./knowledge-ai.ts";

Deno.test("tipo de leitura com IA por arquivo", () => {
  assertEquals(aiKindOf("contrato escaneado.pdf", "application/pdf"), "pdf");
  assertEquals(aiKindOf("foto.JPG", ""), "image");
  assertEquals(aiKindOf("treinamento.mp4", "video/mp4"), "audio");
  assertEquals(aiKindOf("reuniao.m4a", "audio/mp4"), "audio");
  assertEquals(aiKindOf("planilha.xlsx", ""), null);
});
