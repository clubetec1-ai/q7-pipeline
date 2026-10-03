import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getSecret, safeEqual } from "../_shared/secrets.ts";
import { chatAI, resolveAI } from "../_shared/ai-chat.ts";
import { forOrg } from "../_shared/tenant.ts";
import { parseReview, redact, REVIEW_PROMPT } from "../_shared/review.ts";

/**
 * Avalia atendimentos finalizados (cron a cada minuto, x-cron-secret).
 * Até 5 por vez; respeita o limite de IA da empresa; guarda só a análise.
 */

const ok = (body: unknown = { ok: true }, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const mins = (a?: string | null, b?: string | null) =>
  a && b ? Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)) : null;

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const secret = await getSecret(admin, "platform:cron_secret");
  if (!secret || !safeEqual(req.headers.get("x-cron-secret") ?? "", secret)) return ok({ ok: false, error: "unauthorized" }, 401);

  const { data: pending } = await admin.from("ticket_reviews")
    .select("id, organization_id, ticket_id, attempts, organizations!inner(status, settings)")
    .eq("status", "pending").order("created_at").limit(5);

  let done = 0;
  for (const r of pending ?? []) {
    const orgId: string = r.organization_id;
    const org = forOrg(admin, orgId);
    const settings = ((r as any).organizations?.settings ?? {}) as Record<string, unknown>;
    if ((r as any).organizations?.status !== "active" || settings.auto_review !== true) {
      await org.update("ticket_reviews", { status: "skipped", error: "avaliação desligada" }).eq("id", r.id);
      continue;
    }
    const { data: allowed } = await admin.rpc("service_ai_take", { org: orgId });
    if (allowed === false) continue; // tenta no próximo minuto

    const [{ data: t }, { data: msgs }, { count: transfers }] = await Promise.all([
      org.select("tickets", "created_at, queued_at, opened_at, first_response_at, closed_at").eq("id", r.ticket_id).maybeSingle(),
      org.select("messages", "direction, sender, content, created_at").eq("ticket_id", r.ticket_id)
        .order("created_at", { ascending: true }).limit(80),
      admin.from("ticket_events").select("id", { count: "exact", head: true })
        .eq("organization_id", orgId).eq("ticket_id", r.ticket_id).eq("type", "transferred"),
    ]);
    const human = (msgs ?? []).filter((m: any) => m.sender === "human").length;
    if (!t || (msgs ?? []).length < 2 || human === 0) {
      await org.update("ticket_reviews", { status: "skipped", error: "conversa curta ou sem resposta da pessoa" }).eq("id", r.id);
      continue;
    }

    const who: Record<string, string> = { contact: "CLIENTE", human: "ATENDENTE", ai: "IA" };
    let transcript = (msgs ?? []).map((m: any) => `${who[m.sender] ?? m.sender}: ${redact(String(m.content ?? "")).slice(0, 600)}`).join("\n");
    if (transcript.length > 9000) transcript = "…\n" + transcript.slice(-9000);
    const facts = `Tempos (min): fila ${mins(t.queued_at, t.opened_at) ?? "?"}, 1ª resposta ${mins(t.opened_at, t.first_response_at) ?? "?"}, ` +
      `duração ${mins(t.created_at, t.closed_at) ?? "?"}. Transferências: ${transfers ?? 0}.`;

    const ai = await resolveAI(admin, orgId, { provider: (settings.review_provider as string) ?? null, model: (settings.review_model as string) ?? null });
    const fail = async (error: string) => {
      const attempts = (r.attempts ?? 0) + 1;
      await org.update("ticket_reviews", { attempts, error, status: attempts >= 3 ? "failed" : "pending" }).eq("id", r.id);
    };
    if (!ai) { await fail("sem chave de IA (Configurações → Chaves de IA)"); continue; }
    const model = ai.provider === "groq" && (!ai.model || ai.model === "auto") ? "llama-3.3-70b-versatile" : ai.model;

    const res = await chatAI({ ...ai, model }, [
      { role: "system", content: REVIEW_PROMPT },
      { role: "user", content: `${facts}\n\nHistórico:\n${transcript}` },
    ]);
    const out = res.ok && res.reply ? parseReview(res.reply) : null;
    if (!out) { await fail(res.ok ? "resposta fora do formato" : String(res.error ?? "falha na IA").slice(0, 200)); continue; }

    await org.update("ticket_reviews", {
      status: "done", satisfied: out.satisfied, score: out.score, reason: out.reason,
      agent_feedback: out.agent_feedback, process_issues: out.process_issues,
      model: `${ai.provider}:${model}`, error: null, reviewed_at: new Date().toISOString(),
    }).eq("id", r.id);
    done++;
  }
  return ok({ ok: true, done });
});
