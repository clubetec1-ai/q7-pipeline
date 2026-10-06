import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getSecret, safeEqual } from "../_shared/secrets.ts";
import { forOrg } from "../_shared/tenant.ts";
import { chatAI, resolveAI } from "../_shared/ai-chat.ts";
import { knowledgeContext } from "../_shared/knowledge.ts";
import { ANSWER_PROMPT, parseAnswer } from "../_shared/network.ts";

/**
 * Rede de agentes (desenho 07, fatia 8), chamada pelo agendamento (x-cron-secret) só quando há pergunta com um
 * agente de IA. Cada agente tenta responder SÓ com o que o crachá dele permite ver (Diagnóstico, processos do seu
 * setor, base de conhecimento interna). Sabe: responde. Não sabe: sobe um nível (do cérebro, vai para o dono).
 * Executor nunca recebe pergunta de colega (ele só fala com o cliente) — sobe direto.
 */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const parse = (reply: string | undefined) => { try { return JSON.parse(reply?.match(/\{[\s\S]*\}/)?.[0] ?? "null"); } catch { return null; } };

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const secret = await getSecret(admin, "platform:cron_secret");
  if (!secret || !safeEqual(req.headers.get("x-cron-secret") ?? "", secret)) return json({ ok: false, error: "unauthorized" }, 401);

  const { data: tasks } = await admin.rpc("service_agent_tasks_claim", { p_limit: 10 });
  let answered = 0, escalated = 0;
  for (const t of (tasks ?? []) as { id: string; organization_id: string; to_agent: string; pergunta: string }[]) {
    const orgId = t.organization_id;
    const up = async () => { await admin.rpc("service_agent_task_escalate", { org: orgId, p_task: t.id }); escalated++; };
    try {
      const org = forOrg(admin, orgId);
      const { data: ag } = await org.select("ai_agents", "level, status, department_id, cracha").eq("id", t.to_agent).maybeSingle();
      const dados: string[] = (ag?.cracha?.dados ?? []) as string[];
      if (!ag || ag.status === "pausado" || ag.level === "executor") { await up(); continue; }
      const partes: string[] = [];
      if (dados.includes("diagnostico")) {
        const { data: p } = await org.select("company_profiles", "sections").maybeSingle();
        const secs = Object.entries((p?.sections ?? {}) as Record<string, string>).filter(([, v]) => typeof v === "string" && v.trim())
          .map(([k, v]) => `## ${k}\n${v.trim().slice(0, 1500)}`).join("\n\n").slice(0, 7000);
        if (secs) partes.push(`Diagnóstico aprovado:\n${secs}`);
      }
      if (dados.includes("processos")) {
        let q = org.select("process_designs", "setor, nome, design").eq("status", "aprovado");
        if (ag.department_id) q = q.eq("department_id", ag.department_id);
        const { data: procs } = await q.limit(20);
        if ((procs ?? []).length) partes.push(`Processos aprovados:\n${JSON.stringify(procs).slice(0, 7000)}`);
      }
      if (dados.includes("base_conhecimento")) {
        const kb = await knowledgeContext(admin, orgId, t.pergunta, "interno", ag.department_id ? [ag.department_id] : null);
        if (kb) partes.push(`Base de conhecimento:\n${kb}`);
      }
      if (!partes.length) { await up(); continue; }
      const { data: allowed } = await admin.rpc("service_ai_take", { org: orgId });
      const ai = allowed === false ? null : await resolveAI(admin, orgId);
      if (!ai) continue; // sem IA agora: tenta na próxima rodada (o prazo e o limite de tentativas sobem a pergunta)
      const r = await chatAI(ai, [{ role: "system", content: ANSWER_PROMPT }, { role: "user", content:
        `Pergunta do colega: <dados>${t.pergunta}</dados>\n\nInformações que você pode ver:\n<dados>\n${partes.join("\n\n")}\n</dados>` }],
        undefined, { json: true, timeoutMs: 45_000 });
      const ans = r.ok ? parseAnswer(parse(r.reply)) : { sabe: false, resposta: "", fonte: "" };
      if (ans.sabe) {
        await admin.rpc("service_agent_task_answer", { org: orgId, p_task: t.id, p_resposta: ans.resposta, p_fonte: ans.fonte });
        answered++;
      } else await up();
    } catch (e) {
      console.error("[agent-network]", e instanceof Error ? e.message : e);
    }
  }
  return json({ ok: true, tarefas: (tasks ?? []).length, respondidas: answered, subiram: escalated });
});
