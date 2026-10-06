import { assertEquals } from "jsr:@std/assert@1";
import { audioAI, resolveAI } from "./ai-chat.ts";

// Banco falso: só o que resolveAI/audioAI leem (settings da empresa, posições da plataforma, cofre).
function fakeAdmin(o: { settings?: Record<string, unknown>; slots?: { slot: string; provider: string; model: string }[]; secrets: Record<string, string> }) {
  const q = (rows: unknown) => {
    const b = { select: () => b, eq: () => b, maybeSingle: () => Promise.resolve({ data: rows }), then: (r: (v: unknown) => void) => r({ data: rows }) };
    return b;
  };
  return {
    from: (t: string) => q(t === "organizations" ? { settings: o.settings ?? {} } : t === "platform_ai_slots" ? (o.slots ?? []) : null),
    rpc: (_: string, a: { secret_name: string }) => Promise.resolve({ data: o.secrets[a.secret_name] ?? null }),
  };
}
const SLOTS = [{ slot: "principal", provider: "openai", model: "gpt-4o-mini" }, { slot: "reserva1", provider: "groq", model: "auto" }];

Deno.test("sem IA escolhida, a chave Groq antiga da empresa NAO passa na frente da OpenAI da plataforma", async () => {
  const admin = fakeAdmin({ slots: SLOTS, secrets: { "org:o1:groq_api_key": "g-own", "platform:ai:principal": "sk-plat", "platform:ai:reserva1": "g-plat" } });
  const ai = await resolveAI(admin, "o1");
  assertEquals([ai?.provider, ai?.source, ai?.slot], ["openai", "plataforma", "principal"]);
  assertEquals(ai?.fallbacks?.map((f) => f.provider), ["groq"]);
  assertEquals((await audioAI(admin, "o1"))?.provider, "openai");
});

Deno.test("provedor escolhido pela empresa com chave propria continua valendo", async () => {
  const admin = fakeAdmin({ settings: { ai_provider: "groq" }, slots: SLOTS, secrets: { "org:o2:groq_api_key": "g-own2", "platform:ai:principal": "sk-plat" } });
  const ai = await resolveAI(admin, "o2");
  assertEquals([ai?.provider, ai?.source], ["groq", "propria"]);
  assertEquals((await audioAI(admin, "o2"))?.source, "propria");
});

Deno.test("sem IA na plataforma (recusada), usa a chave Groq antiga como ultimo recurso", async () => {
  const admin = fakeAdmin({ settings: { ai_platform: false }, slots: SLOTS, secrets: { "org:o3:groq_api_key": "g-own3", "platform:ai:principal": "sk-plat" } });
  const ai = await resolveAI(admin, "o3");
  assertEquals([ai?.provider, ai?.source], ["groq", "propria"]);
});
