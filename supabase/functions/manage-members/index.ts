import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { HttpError, requirePermission, requireUser, resolveOrg } from "../_shared/auth.ts";
import { forOrg } from "../_shared/tenant.ts";

/**
 * Gestão de membros de uma organização (spec §8.2).
 *
 * Alterações em membros existentes usam o client do PRÓPRIO usuário: passam
 * pela RLS (members.manage) e pelo trigger guard_owner (só owner mexe em
 * owner). O service_role só entra onde é indispensável — convidar por e-mail
 * (Auth admin) e criar a associação de quem ainda não é membro.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const ROLES = ["owner", "admin", "supervisor", "agent"] as const;
type Role = (typeof ROLES)[number];
const INVITES_PER_HOUR = 20;
const APP_URL = Deno.env.get("APP_URL") ?? "https://clubecrm-clubetec.vercel.app";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function dbError(error: { code?: string; message?: string } | null): never {
  // 42501 = permissão (RLS ou guard_owner); 23514 = regra (ex.: último owner).
  if (error?.code === "42501") throw new HttpError(403, "Sem permissão para esta alteração");
  if (error?.code === "23514") throw new HttpError(409, error.message ?? "Alteração não permitida");
  throw new HttpError(400, "Não foi possível salvar a alteração");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const action: string = body?.action ?? "";
    const ctx = await requireUser(req);
    const orgId = await resolveOrg(ctx, body?.organization_id);
    await requirePermission(ctx, orgId, "members.manage");

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const org = forOrg(admin, orgId);

    // Papel de quem chama, para as regras de owner.
    const { data: me } = await org
      .select("organization_members", "role")
      .eq("user_id", ctx.user.id)
      .maybeSingle();
    const callerIsOwner = me?.role === "owner";

    if (action === "invite") {
      const email = String(body?.email ?? "").trim().toLowerCase();
      const role = String(body?.role ?? "agent") as Role;
      const departmentIds: string[] = Array.isArray(body?.department_ids) ? body.department_ids : [];
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "E-mail inválido");
      if (!ROLES.includes(role)) throw new HttpError(400, "Papel inválido");
      if (role === "owner" && !callerIsOwner) throw new HttpError(403, "Só um owner pode convidar outro owner");

      const since = new Date(Date.now() - 3600_000).toISOString();
      const { count } = await admin
        .from("audit_log")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("action", "member.insert")
        .gte("created_at", since);
      if ((count ?? 0) >= INVITES_PER_HOUR) {
        throw new HttpError(429, "Limite de convites por hora atingido. Tente de novo mais tarde.");
      }

      // Departamentos informados precisam ser desta organização.
      if (departmentIds.length) {
        const { data: depts } = await org.select("departments", "id").in("id", departmentIds);
        if ((depts ?? []).length !== departmentIds.length) throw new HttpError(400, "Departamento inválido");
      }

      // Pessoa já tem conta? (perfil é criado no cadastro)
      const { data: profile } = await admin.from("profiles").select("user_id").eq("email", email).maybeSingle();
      let userId: string | null = profile?.user_id ?? null;
      let emailSent = false;

      if (!userId) {
        const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(email, {
          redirectTo: `${APP_URL}/convite`,
        });
        if (error || !invited?.user) {
          console.error("[manage-members] convite por e-mail falhou", { code: error?.code });
          throw new HttpError(502, "Não foi possível enviar o convite por e-mail");
        }
        userId = invited.user.id;
        emailSent = true;
      }

      const { data: existing } = await org
        .select("organization_members", "status, role")
        .eq("user_id", userId)
        .maybeSingle();
      if (existing?.status === "active") throw new HttpError(409, "Esta pessoa já é membro ativo");
      // Este caminho usa service_role (o trigger não vê quem chama): a regra
      // "só owner mexe em owner" é conferida aqui.
      if (existing?.role === "owner" && !callerIsOwner) {
        throw new HttpError(403, "Só um owner pode alterar outro owner");
      }
      if (existing) {
        const { error } = await org
          .update("organization_members", { role, status: "invited", invited_by: ctx.user.id })
          .eq("user_id", userId);
        if (error) dbError(error);
      } else {
        const { error } = await org.insert("organization_members", {
          user_id: userId, role, status: "invited", invited_by: ctx.user.id,
        });
        if (error) dbError(error);
      }
      if (departmentIds.length) {
        await org.insert(
          "department_members",
          departmentIds.map((department_id) => ({ department_id, user_id: userId })),
        );
      }
      return json({ ok: true, user_id: userId, email_sent: emailSent });
    }

    const userId: string = body?.user_id ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new HttpError(400, "user_id inválido");

    if (action === "change_role") {
      const role = String(body?.role ?? "") as Role;
      if (!ROLES.includes(role)) throw new HttpError(400, "Papel inválido");
      const { data, error } = await ctx.userClient
        .from("organization_members")
        .update({ role })
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .select("user_id");
      if (error) dbError(error);
      if (!data?.length) throw new HttpError(404, "Membro não encontrado");
      return json({ ok: true });
    }

    if (action === "disable" || action === "enable") {
      if (action === "disable" && userId === ctx.user.id) {
        throw new HttpError(400, "Você não pode desativar a si mesmo");
      }
      const { data, error } = await ctx.userClient
        .from("organization_members")
        .update({ status: action === "disable" ? "disabled" : "active" })
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .select("user_id");
      if (error) dbError(error);
      if (!data?.length) throw new HttpError(404, "Membro não encontrado");
      return json({ ok: true });
    }

    if (action === "remove") {
      if (userId === ctx.user.id) throw new HttpError(400, "Você não pode remover a si mesmo");
      const { data, error } = await ctx.userClient
        .from("organization_members")
        .delete()
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .select("user_id");
      if (error) dbError(error);
      if (!data?.length) throw new HttpError(404, "Membro não encontrado");
      return json({ ok: true });
    }

    if (action === "resend") {
      const { data: member } = await org
        .select("organization_members", "status")
        .eq("user_id", userId)
        .maybeSingle();
      if (member?.status !== "invited") throw new HttpError(400, "Só convites pendentes podem ser reenviados");
      const { data: u } = await admin.auth.admin.getUserById(userId);
      const email = u?.user?.email;
      if (!email) throw new HttpError(404, "Usuário não encontrado");
      if (u.user.last_sign_in_at) {
        // Já tem conta ativa: o convite aparece quando a pessoa entrar.
        return json({ ok: true, email_sent: false });
      }
      const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${APP_URL}/convite` });
      if (error) {
        console.error("[manage-members] reenvio falhou", { code: error.code });
        throw new HttpError(502, "Não foi possível reenviar o convite");
      }
      return json({ ok: true, email_sent: true });
    }

    return json({ ok: false, error: "Ação inválida" }, 400);
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    console.error("[manage-members] erro", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Erro interno" }, 500);
  }
});
