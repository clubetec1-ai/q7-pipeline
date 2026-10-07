import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { HttpError, isPlatformOperator, requireUser } from "../_shared/auth.ts";
import { chatAI, platformChain, forAgent } from "../_shared/ai-chat.ts";
import { fence } from "../_shared/fence.ts";
import { buildDevTask, DIAG_PROMPT, type Equipe, parseDiag, reviewDiag, SYSTEM_MAP, TEAMS } from "../_shared/platform-brain.ts";

/**
 * Cérebro da plataforma (desenho 07 §12, fatia 11): a equipe de IA dona do incidente faz o diagnóstico com evidência e
 * propõe a correção; o Guardião da plataforma e o QA revisam por regra fixa; a proposta fica esperando a aprovação de um
 * operador Clubetec. Só metadados entram no prompt. Nada é publicado nem alterado aqui além do próprio incidente.
 * Orçamento próprio: até 30 diagnósticos por dia.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const LIMITE_DIA = 30;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    if (String(body?.action ?? "") !== "diagnose") throw new HttpError(400, "Ação inválida");
    const ctx = await requireUser(req);
    if (!(await isPlatformOperator(ctx))) throw new HttpError(403, "Só a equipe da plataforma");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: inc } = await admin.from("platform_incidents")
      .select("id, kind, equipe, gravidade, titulo, empresas, ocorrencias, pico, evidencia, status, first_seen, last_seen")
      .eq("id", String(body?.incident_id ?? "")).maybeSingle();
    if (!inc) throw new HttpError(404, "Incidente não encontrado");
    if (!["aberto", "proposta"].includes(inc.status)) throw new HttpError(422, "Este incidente não está esperando diagnóstico");

    const hoje = new Date(); hoje.setUTCHours(0, 0, 0, 0);
    const { count } = await admin.from("platform_incidents").select("id", { count: "exact", head: true })
      .gte("diagnostico->>at", hoje.toISOString());
    if ((count ?? 0) >= LIMITE_DIA) throw new HttpError(429, `Limite de ${LIMITE_DIA} diagnósticos por dia atingido`);

    // Uso de IA registrado na empresa do operador (a Clubetec).
    const { data: mem } = await admin.from("organization_members").select("organization_id").eq("user_id", ctx.user.id)
      .eq("status", "active").order("created_at").limit(1).maybeSingle();
    const ai = mem ? (await platformChain(admin, mem.organization_id))[0] : null;
    if (!ai) throw new HttpError(503, "IA da plataforma indisponível");

    const team = TEAMS[inc.equipe as Equipe];
    const r = await chatAI(await forAgent(admin, ai, "plataforma"), [
      { role: "system", content: `${DIAG_PROMPT}\n\nVocê é: ${team?.equipe ?? inc.equipe}, que cuida de ${team?.cuida ?? "-"}.\n\nMapa do sistema:\n${SYSTEM_MAP}` },
      { role: "user", content: `Incidente:\n<dados>\n${fence(JSON.stringify({
        regra: inc.kind, titulo: inc.titulo, gravidade: inc.gravidade, empresas_afetadas: inc.empresas, ocorrencias_na_janela: inc.ocorrencias,
        pico: inc.pico, evidencia: inc.evidencia, desde: inc.first_seen, ultimo_sinal: inc.last_seen,
      }))}\n</dados>` },
    ], undefined, { json: true, timeoutMs: 60_000, temperature: 0.2 });
    if (!r.ok || !r.reply) throw new HttpError(502, "A IA não respondeu; tente de novo");
    let raw: unknown = null;
    try { raw = JSON.parse(r.reply.match(/\{[\s\S]*\}/)?.[0] ?? "null"); } catch { /* inválido */ }
    const diag = parseDiag(raw);
    if (!diag) throw new HttpError(502, "A IA não trouxe um diagnóstico claro; tente de novo");
    const rev = reviewDiag(diag);
    const tarefa = buildDevTask(inc, diag);
    const { data: st, error } = await admin.rpc("service_platform_incident_propose", {
      p_id: inc.id, p_diag: { ...diag, tarefa, equipe_nome: team?.equipe ?? inc.equipe }, p_rev: rev,
    });
    if (error) throw new HttpError(422, error.message);
    return json({ ok: true, status: st, revisao: rev });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error("[platform-brain]", e instanceof Error ? e.message : e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Erro" }, status);
  }
});
