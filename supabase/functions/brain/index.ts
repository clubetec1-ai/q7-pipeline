import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { HttpError, permissionsIn, requireUser, resolveOrg } from "../_shared/auth.ts";
import { getSecret, safeEqual } from "../_shared/secrets.ts";
import { chatAI, type ChatMsg, resolveAI, type ResolvedAI } from "../_shared/ai-chat.ts";
import { AREA_FOCUS, BRAIN_MODELS, BRAIN_RULES, kindsOf } from "../_shared/brain/rules.ts";
import { type Packet, type PacketArea, packetHash, sanitizePacket, validateOrchestration, validateProposals } from "../_shared/brain/validate.ts";

/**
 * Cérebro (docs/design/03-cerebro.md §3): análise semanal (cron, segunda) ou manual
 * ("Analisar agora", dono/admin). O servidor monta um pacote FECHADO só com números e o
 * texto do Diagnóstico; a IA devolve só JSON (sem ferramentas); o validador descarta o
 * que foge das listas e refaz as evidências com os números reais. A única escrita é
 * service_brain_propose: tudo nasce "sugerida" e só segue com aprovação de uma pessoa.
 * No máximo 4 chamadas de IA por análise (1 cérebro + até 3 áreas).
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const parseJson = (reply: string | undefined): Record<string, unknown> => {
  try { return JSON.parse(String(reply ?? "").match(/\{[\s\S]*\}/)?.[0] ?? "{}"); } catch { return {}; }
};
// O texto vai como JSON com "<" escapado: nada dentro dos dados consegue fechar o bloco <dados>.
const dados = (o: unknown) => `<dados>\n${JSON.stringify(o).replace(/</g, "\\u003c")}\n</dados>`;
/** O texto do Diagnóstico é a visão do dono, não medição: o nome do campo deixa isso claro para a IA. */
function labelled<T extends { empresa?: unknown; areas: unknown[] }>(p: T) {
  const { empresa, ...rest } = p;
  return { visao_do_dono_nao_medida: empresa, ...rest };
}
/** Cabe no limite tirando áreas inteiras do fim, nunca cortando o JSON no meio. */
function fit<T extends { areas: unknown[] }>(p: T, max: number): T {
  let out = p;
  while (JSON.stringify(out).length > max && out.areas.length > 1) out = { ...out, areas: out.areas.slice(0, -1) };
  return out;
}

// deno-lint-ignore no-explicit-any
type Admin = any;
interface Usage { calls: number; tin: number; tout: number }

async function ask(ai: ResolvedAI, system: string, user: string, u: Usage, maxTokens: number) {
  const msgs: ChatMsg[] = [{ role: "system", content: `${BRAIN_RULES}\n\n${system}` }, { role: "user", content: user }];
  const r = await chatAI(ai, msgs, undefined, { json: true, maxTokens, timeoutMs: 45_000 });
  u.calls += 1; u.tin += r.usage?.in ?? 0; u.tout += r.usage?.out ?? 0;
  if (!r.ok) throw new Error(r.error || "IA indisponível");
  return parseJson(r.reply);
}

async function runFor(admin: Admin, orgId: string, kind: "semanal" | "manual", who: string | null) {
  const { data: run, error: startErr } = await admin.rpc("service_brain_start_run", { org: orgId, p_kind: kind, who });
  if (startErr || !run) return { ok: false, skipped: true, error: "análise já feita nesta semana" };
  const u: Usage = { calls: 0, tin: 0, tout: 0 };
  const finish = (status: string, summary: unknown, model: string | null, error: string | null, hash: string | null) =>
    admin.rpc("service_brain_finish_run", {
      run, org: orgId, p_status: status, p_summary: summary, p_calls: u.calls, p_in: u.tin, p_out: u.tout,
      p_model: model, p_error: error, p_hash: hash,
    });
  let model: string | null = null;
  try {
    const { data: packet } = await admin.rpc("service_brain_packet", { org: orgId });
    // Tudo que vai para a IA passa pela anonimização (e-mail, telefone, CPF...), inclusive textos do Diagnóstico.
    const p = sanitizePacket((packet ?? { areas: [] }) as Packet & { empresa?: unknown; prioridades_anteriores?: unknown });
    const hash = await packetHash(p);
    if (kind === "semanal") {
      const { data: last } = await admin.rpc("service_brain_last_hash", { org: orgId });
      if (last && last === hash) {
        await finish("pulado", { resumo: "Nada mudou desde a última análise." }, null, null, hash);
        return { ok: true, skipped: true };
      }
    }
    if (!p.areas.length) {
      await finish("pulado", { resumo: "Nenhuma área ligada." }, null, null, hash);
      return { ok: true, skipped: true };
    }
    const ai = await resolveAI(admin, orgId);
    if (!ai) throw new Error("A IA ainda não está disponível para esta empresa.");
    model = ai.model;
    const { data: allowed } = await admin.rpc("service_ai_take", { org: orgId });
    if (allowed === false) throw new Error("Limite de IA por minuto da empresa; tente de novo em instantes.");

    // 1. Cérebro (visão de CEO): resumo, até 3 prioridades e quais áreas delegar.
    const orchRaw = await ask(ai, [
      "Você é o cérebro de gestão (visão de CEO) desta empresa. Leia o pacote: objetivos da empresa e, por área, indicadores",
      "dos últimos 7 dias × 7 anteriores, metas com semáforo (calculado pelo sistema), pendências e resultados recentes.",
      "Escreva um resumo da semana (até 5 frases curtas), escolha até 3 prioridades (cada uma ligada a uma área do pacote pelo campo id e, se houver, à meta pelo id),",
      "escolha até 3 áreas (pelo id) para o agente da área propor melhorias (só as com agente_ligado=true e onde há algo a melhorar) e liste o que cobrar.",
      'JSON: {"resumo":"","prioridades":[{"area_id":"","titulo":"","por_que":"cite o indicador pela chave","meta_id":""}],"delegar":["area_id"],"cobrar":[""]}',
    ].join(" "), `Áreas (id → nome): ${p.areas.map((a) => `${a.id} → ${a.nome}${a.agente_ligado ? " (agente ligado)" : ""}`).join("; ")}\n${dados(fit(labelled(p), 14_000))}`, u, 900);
    const orch = validateOrchestration(orchRaw, p);

    // 2. Agentes das áreas delegadas: até 3 propostas cada, com evidência dos números do pacote.
    let created = 0;
    const delegou: { area_id: string; area_key: string; propostas: number }[] = [];
    for (const areaId of orch.delegar) {
      const area = p.areas.find((a) => a.id === areaId) as PacketArea | undefined;
      if (!area) continue;
      const raw = await ask(ai, [
        `Você é o agente da área "${area.nome}" (${AREA_FOCUS[area.key] ?? AREA_FOCUS.outra}). Proponha até 3 melhorias concretas e baratas,`,
        `cada uma com evidência (chaves de indicadores do pacote), tipo permitido (${kindsOf(area.key).join(", ")}),`,
        `modelo pronto quando servir (${Object.entries(BRAIN_MODELS).map(([k, v]) => `${k}: ${v}`).join("; ")}),`,
        "meta_id quando ajudar uma meta, processo (nome exato de um processo do pacote) quando for melhoria de processo, e prazo em dias.",
        "Não repita o que já está em 'abertas' nem o que funcionou em 'resultados_recentes'.",
        'JSON: {"propostas":[{"titulo":"","problema":"","como":"passo a passo curto","tipo":"","modelo":"","meta_id":"","evidencias":["chave"],"processo":"","prioridade":1,"prazo_dias":7}]}',
      ].join(" "), dados({ visao_do_dono_nao_medida: p.empresa, area }), u, 1_200);
      const items = validateProposals(raw, area);
      const { data: n } = await admin.rpc("service_brain_propose_area", { org: orgId, run, area: area.id, items });
      created += Number(n) || 0;
      delegou.push({ area_id: area.id, area_key: area.key, propostas: Number(n) || 0 });
    }

    await finish("ok", { resumo: orch.resumo, prioridades: orch.prioridades, delegou, cobrar: orch.cobrar, propostas: created }, model, null, hash);
    return { ok: true, propostas: created };
  } catch (e) {
    const msg = (e as Error).message?.slice(0, 280) || "erro";
    console.error("brain:", orgId, msg);
    await finish("erro", null, model, msg, null);
    return { ok: false, error: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const body = await req.json().catch(() => ({}));

    // Cron semanal (segredo do cron): até 10 empresas por chamada, sem passar de ~2 min.
    if (body?.action === "weekly") {
      const secret = await getSecret(admin, "platform:cron_secret");
      if (!secret || !safeEqual(req.headers.get("x-cron-secret") ?? "", secret)) return json({ ok: false, error: "unauthorized" }, 401);
      const { data: due } = await admin.rpc("service_brain_due");
      const started = Date.now();
      const results: unknown[] = [];
      for (const orgId of (due ?? []) as string[]) {
        if (Date.now() - started > 110_000) break;
        results.push({ org: orgId, ...(await runFor(admin, orgId, "semanal", null)) });
      }
      return json({ ok: true, processed: results.length });
    }

    // "Analisar agora" (dono/admin).
    const ctx = await requireUser(req);
    const orgId = await resolveOrg(ctx, body?.organization_id);
    const perms = await permissionsIn(ctx, orgId);
    if (!perms.includes("org.settings")) throw new HttpError(403, "Só o dono ou administrador pode pedir a análise.");
    const { data: can } = await admin.rpc("service_brain_can_run_manual", { org: orgId });
    if (can !== "ok") throw new HttpError(409, String(can || "Não é possível analisar agora."));
    const r = await runFor(admin, orgId, "manual", ctx.user.id);
    if (!r.ok) throw new HttpError(502, `A análise não terminou: ${r.error ?? "tente de novo mais tarde"}`);
    return json({ ok: true, propostas: (r as { propostas?: number }).propostas ?? 0, skipped: !!(r as { skipped?: boolean }).skipped });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error("brain:", e);
    return json({ ok: false, error: e instanceof HttpError ? e.message : "Erro interno" }, status);
  }
});
