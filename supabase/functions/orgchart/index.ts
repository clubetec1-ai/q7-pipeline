import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { requireModule } from "../_shared/modules.ts";
import { HttpError, requirePermission, requireUser, resolveOrg } from "../_shared/auth.ts";
import { forOrg } from "../_shared/tenant.ts";
import { buildOrgChart } from "../_shared/orgchart.ts";
import { checkAgent } from "../_shared/guardian.ts";

/**
 * Organograma de IA (desenho 07, fatia 4): o cérebro monta o time de agentes POR REGRA (sem IA, sem custo)
 * a partir de setores, áreas, tamanho da equipe e processos aprovados, e grava como "proposto". O dono
 * aprova na tela. O banco confere o crachá de cada agente contra o catálogo (service_org_chart_save).
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    if (String(body?.action ?? "") !== "propose") throw new HttpError(400, "Ação inválida");
    const ctx = await requireUser(req);
    const orgId = await resolveOrg(ctx, body?.organization_id);
    await requirePermission(ctx, orgId, "org.settings");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await requireModule(admin, orgId, "gestao");
    const org = forOrg(admin, orgId);

    const [{ count: members }, { data: depts }, { data: areas }, { data: procs }] = await Promise.all([
      admin.from("organization_members").select("user_id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "active"),
      org.select("departments", "id, name"),
      org.select("org_areas", "key, department_id").eq("enabled", true),
      org.select("process_designs", "id, setor, nome, status, design").neq("status", "arquivado"),
    ]);
    const agents = buildOrgChart({
      members: members ?? 1,
      departments: (depts ?? []) as { id: string; name: string }[],
      areas: (areas ?? []) as { key: string; department_id: string | null }[],
      processes: (procs ?? []) as { id: string; setor: string; nome: string; status: string; design: { passos?: { decisao?: string }[] } }[],
    });
    const { data, error } = await admin.rpc("service_org_chart_save", { org: orgId, p_agents: agents });
    if (error) {
      console.error("[orgchart] não gravou", error.message);
      throw new HttpError(500, "Não consegui montar o time agora. Tente de novo.");
    }
    // Guardião (fatia 5): revisa cada agente (só regras fixas — o time sai de regra, sem IA).
    const { data: saved } = await org.select("ai_agents", "id, version, level, papel, autonomia, cracha");
    let reprovados = 0;
    for (const a of (saved ?? []) as { id: string; version: number; level: string; papel: string; autonomia: string; cracha: { dados: string[]; acoes: string[] } }[]) {
      const { data: st, error: gErr } = await admin.rpc("service_guardian_save",
        { org: orgId, p_type: "agente", p_id: a.id, p_version: a.version, p_findings: checkAgent(a) });
      if (gErr) console.error("[orgchart] revisão do Guardião não gravada", gErr.message);
      if (st === "reprovado") reprovados++;
    }
    return json({ ok: true, ...(data as Record<string, unknown>), reprovados });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error("[orgchart]", e instanceof Error ? e.message : e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Erro" }, status);
  }
});
