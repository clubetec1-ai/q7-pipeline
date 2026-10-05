import { assert, assertEquals } from "jsr:@std/assert@1";
import { book, freeSlots } from "./gcal.ts";

const realFetch = globalThis.fetch;
function stub(busy: { start: string; end: string }[], onEvent?: (body: unknown) => void) {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/freeBusy")) return new Response(JSON.stringify({ calendars: { primary: { busy } } }), { status: 200 });
    if (u.endsWith("/events")) {
      onEvent?.(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ htmlLink: "https://calendar.google.com/x" }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

Deno.test("horários livres: só dias úteis, dentro do expediente de Brasília e sem conflito", async () => {
  stub([]);
  const r = await freeSlots("t", { phone: "", vars: { quantos: "10", dias: "10" } });
  globalThis.fetch = realFetch;
  assert(r.ok);
  const isos = r.vars!.horarios_iso.split(",");
  assertEquals(isos.length, 10);
  for (const iso of isos) {
    const local = new Date(Date.parse(iso) - 3 * 3600_000);
    const dow = local.getUTCDay(), h = local.getUTCHours();
    assert(dow >= 1 && dow <= 5, `fim de semana: ${iso}`);
    assert(h >= 9 && h < 18, `fora do expediente: ${iso}`);
  }
  assert(r.vars!.horarios.startsWith("1) "));
});

Deno.test("horário ocupado não é oferecido", async () => {
  stub([]);
  const first = (await freeSlots("t", { phone: "", vars: { quantos: "1" } })).vars!.horarios_iso;
  const end = new Date(Date.parse(first) + 3600_000).toISOString();
  stub([{ start: first, end }]);
  const r = await freeSlots("t", { phone: "", vars: { quantos: "3" } });
  globalThis.fetch = realFetch;
  assert(!r.vars!.horarios_iso.split(",").includes(first));
});

Deno.test("agendar pelo número da lista e recusar horário ocupado", async () => {
  stub([]);
  const slots = (await freeSlots("t", { phone: "", vars: { quantos: "3" } })).vars!;
  let sent: { start: { dateTime: string }; summary: string } | null = null;
  stub([], (b) => (sent = b as typeof sent));
  const ok = await book("t", { phone: "5511999999999", name: "Maria Silva", vars: { horario: "2", horarios_iso: slots.horarios_iso } });
  assert(ok.ok);
  assertEquals(sent!.start.dateTime, slots.horarios_iso.split(",")[1]);
  assert(sent!.summary.includes("Maria Silva"));
  const iso = slots.horarios_iso.split(",")[0];
  stub([{ start: iso, end: new Date(Date.parse(iso) + 3600_000).toISOString() }]);
  const busy = await book("t", { phone: "", vars: { horario: "1", horarios_iso: slots.horarios_iso } });
  globalThis.fetch = realFetch;
  assertEquals(busy.error, "horário ocupado");
});
