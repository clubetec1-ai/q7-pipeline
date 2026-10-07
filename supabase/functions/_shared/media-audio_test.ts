import { assertEquals } from "jsr:@std/assert@1";
import { sniffMime } from "./media.ts";

const mp4 = (brand: string) => { const b = new Uint8Array(16); b.set(new TextEncoder().encode("ftyp"), 4); b.set(new TextEncoder().encode(brand), 8); return b; };

Deno.test("áudio gravado no navegador (MP4 com marca genérica) vai como áudio, não como vídeo", () => {
  assertEquals(sniffMime(mp4("iso5"), "audio-2026-10-07.m4a"), "audio/mp4");
  assertEquals(sniffMime(mp4("isom"), "video.mp4"), "video/mp4");
  assertEquals(sniffMime(mp4("M4A "), "x"), "audio/mp4");
});
