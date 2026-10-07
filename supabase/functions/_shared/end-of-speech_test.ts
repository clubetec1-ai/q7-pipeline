import { assertEquals } from "jsr:@std/assert@1";
import { createSilenceDetector } from "../../../src/lib/endOfSpeech.ts";

const run = (d: ReturnType<typeof createSilenceDetector>, rms: number, ms: number, paused = false) => {
  let stop = false;
  for (let t = 0; t < ms; t += 100) stop = d.update(rms, 100, paused) || stop;
  return stop;
};

Deno.test("silêncio antes de falar não encerra (a pessoa ainda está pensando)", () => {
  const d = createSilenceDetector();
  assertEquals(run(d, 0.005, 500), false); // calibra o ruído
  assertEquals(run(d, 0.005, 10_000), false);
});

Deno.test("fala e depois 3 s de silêncio encerra; pausa curta no meio não", () => {
  const d = createSilenceDetector();
  run(d, 0.005, 500);
  assertEquals(run(d, 0.2, 2000), false);
  assertEquals(run(d, 0.005, 1500), false, "pausa de 1,5 s no meio da frase");
  assertEquals(run(d, 0.2, 1000), false);
  assertEquals(run(d, 0.005, 3000), true);
});

Deno.test("pausado não conta silêncio; ambiente barulhento sobe o limite", () => {
  const d = createSilenceDetector();
  run(d, 0.005, 500);
  run(d, 0.2, 1000);
  assertEquals(run(d, 0.005, 5000, true), false);
  const n = createSilenceDetector();
  run(n, 0.08, 500); // ruído alto
  assertEquals(run(n, 0.1, 5000), false, "ruído parecido com o do ambiente não é fala");
});
