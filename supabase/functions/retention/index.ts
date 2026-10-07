import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getSecret, safeEqual } from "../_shared/secrets.ts";

/**
 * Retenção automática (LGPD; Etapa B, item 6). Chamada todo dia pelo agendamento (x-cron-secret) só quando alguma
 * empresa ligou a retenção. O banco apaga o conteúdo antigo em lotes (service_retention_batch) e devolve os arquivos;
 * aqui eles saem do armazenamento. Até 20 lotes por rodada; o resto fica para o dia seguinte.
 */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const secret = await getSecret(admin, "platform:cron_secret");
  if (!secret || !safeEqual(req.headers.get("x-cron-secret") ?? "", secret)) return json({ ok: false, error: "unauthorized" }, 401);
  let mensagens = 0, arquivos = 0;
  for (let i = 0; i < 20; i++) {
    const { data, error } = await admin.rpc("service_retention_batch", { p_limit: 500 });
    if (error) { console.error("[retention]", error.message); break; }
    const r = data as { mensagens: number; media: string[]; mais: boolean };
    mensagens += r.mensagens ?? 0;
    const media = (r.media ?? []).filter((p) => typeof p === "string" && /^[0-9a-f-]{36}\//.test(p));
    for (let j = 0; j < media.length; j += 100) {
      const { data: gone } = await admin.storage.from("media").remove(media.slice(j, j + 100));
      arquivos += gone?.length ?? 0;
    }
    if (!r.mais && !r.mensagens) break;
  }
  return json({ ok: true, mensagens, arquivos });
});
