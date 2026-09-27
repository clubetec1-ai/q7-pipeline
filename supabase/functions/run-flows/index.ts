import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { forOrg } from "../_shared/tenant.ts";
import { getSecret, safeEqual } from "../_shared/secrets.ts";
import { instForSend, runFlow } from "../_shared/flow/executor.ts";

/**
 * Retoma fluxos cujo relógio venceu (spec fluxo §6.2 item 4): bloco de espera,
 * tempo limite de menu/pergunta/pesquisa e início do pós-atendimento. Chamado
 * pelo cron (private.run_flows_tick, pg_net + x-cron-secret) só quando há run
 * vencido. Cada run é reservado por um UPDATE condicional: duas execuções
 * simultâneas nunca processam o mesmo.
 */

const BATCH = 30;

function ok(body: unknown = { ok: true }, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const expected = await getSecret(admin, "platform:cron_secret");
  if (!expected || !safeEqual(req.headers.get("x-cron-secret") ?? "", expected)) {
    return ok({ ok: false, error: "unauthorized" }, 401);
  }

  const now = new Date().toISOString();
  const { data: due, error } = await admin.from("flow_runs")
    .select("id, organization_id, wait_until")
    .in("state", ["waiting_input", "waiting_timer"]).lte("wait_until", now)
    .order("wait_until", { ascending: true }).limit(BATCH);
  if (error) return ok({ ok: false, error: error.message }, 500);

  let processed = 0;
  for (const d of due ?? []) {
    try {
      const org = forOrg(admin, d.organization_id);
      // Reserva: só quem zerar o wait_until processa.
      const { data: run } = await org.update("flow_runs", { wait_until: null })
        .eq("id", d.id).eq("wait_until", d.wait_until).in("state", ["waiting_input", "waiting_timer"])
        .select().maybeSingle();
      if (!run) continue;

      const { data: ticket } = await org.select("tickets").eq("id", run.ticket_id).maybeSingle();
      const { data: conv } = await org.select("conversations").eq("id", run.conversation_id).maybeSingle();
      // Em "bot" (espera dentro do atendimento) ou finalizado (pós-atendimento).
      if (!ticket || !conv || !["bot", "closed"].includes(ticket.status)) {
        await org.update("flow_runs", { state: "cancelled", finished_at: now, vars: {} }).eq("id", run.id);
        continue;
      }
      const { data: instRow } = await org.select("whatsapp_instances").eq("id", conv.instance_id).maybeSingle();
      if (!instRow) {
        await org.update("flow_runs", { state: "error", error: "numero removido", finished_at: now, vars: {} }).eq("id", run.id);
        continue;
      }
      const inst = await instForSend(admin, instRow);
      await runFlow({ admin, orgId: d.organization_id, inst, conv, ticket, text: null, timer: true, run });
      processed++;
    } catch (e) {
      console.error("[run-flows] falhou", { run: d.id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return ok({ ok: true, processed });
});
