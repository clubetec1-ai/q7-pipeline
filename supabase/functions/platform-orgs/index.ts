import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { HttpError, isPlatformOperator, requireUser } from "../_shared/auth.ts";
import { forOrg } from "../_shared/tenant.ts";

/**
 * Painel da plataforma: criar empresa cliente (só operador Clubetec).
 * Cria a organização com o modelo escolhido e convida o dono por e-mail
 * (conta nova recebe o convite do Supabase Auth; conta existente vê o convite
 * ao entrar). Listar, suspender e suporte são RPCs com a mesma checagem.
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
    if (body?.action !== "create") throw new HttpError(400, "Ação inválida");
    const ctx = await requireUser(req);
    if (!(await isPlatformOperator(ctx))) throw new HttpError(403, "Só a equipe da plataforma");

    const name = String(body?.name ?? "").trim().slice(0, 120);
    const template = String(body?.template_key ?? "generico");
    const email = String(body?.owner_email ?? "").trim().toLowerCase();
    if (name.length < 2) throw new HttpError(400, "Informe o nome da empresa");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "E-mail do dono inválido");

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: tpl } = await admin.from("org_templates").select("key").eq("key", template).eq("active", true).maybeSingle();
    if (!tpl) throw new HttpError(400, "Modelo inválido");

    const { data: orgId, error } = await admin.rpc("service_create_org", { org_name: name, template, creator: ctx.user.id });
    if (error || !orgId) throw new HttpError(400, "Não foi possível criar a empresa");

    const { data: appUrl } = await admin.from("app_settings").select("value").eq("key", "app_url").maybeSingle();
    const { data: profile } = await admin.from("profiles").select("user_id").eq("email", email).maybeSingle();
    let userId: string | null = profile?.user_id ?? null;
    let emailSent = false;
    if (!userId) {
      const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${String(appUrl?.value ?? "").replace(/\/$/, "")}/convite`,
      });
      if (invErr || !invited?.user) {
        console.error("[platform-orgs] convite falhou", { code: invErr?.code });
        return json({ ok: true, organization_id: orgId, warning: "Empresa criada, mas o convite por e-mail falhou. Convide o dono de novo." });
      }
      userId = invited.user.id;
      emailSent = true;
    }
    const { error: mErr } = await forOrg(admin, orgId).insert("organization_members", {
      user_id: userId, role: "owner", status: "invited", invited_by: ctx.user.id,
    });
    if (mErr) console.error("[platform-orgs] membro nao criado", { code: mErr.code });
    await admin.from("audit_log").insert({
      organization_id: orgId, actor_id: ctx.user.id, action: "platform.owner_invite", target: String(userId), meta: { email_sent: emailSent },
    });
    return json({ ok: true, organization_id: orgId, email_sent: emailSent });
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    console.error("[platform-orgs]", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Erro inesperado" }, 500);
  }
});
