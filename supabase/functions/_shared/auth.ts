/**
 * Quem está chamando e em nome de qual organização.
 *
 * Regra do spec §8.1: um organization_id vindo do corpo é só uma pergunta,
 * nunca uma credencial. A resposta vem do banco (my_permissions), com o JWT
 * do próprio usuário.
 */
import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.49.1";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface UserContext {
  user: User;
  /** Client com o JWT do usuário: passa pela RLS. */
  userClient: SupabaseClient;
}

export async function requireUser(req: Request): Promise<UserContext> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) throw new HttpError(401, "Não autorizado");
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
  const { data, error } = await userClient.auth.getUser();
  if (error || !data?.user) throw new HttpError(401, "Sessão inválida");
  return { user: data.user, userClient };
}

export async function permissionsIn(ctx: UserContext, orgId: string): Promise<string[]> {
  const { data, error } = await ctx.userClient.rpc("my_permissions", { org: orgId });
  if (error) return [];
  return (data as string[] | null) ?? [];
}

/**
 * Organização da operação: a informada (se o usuário tiver acesso a ela) ou a
 * única organização ativa do usuário.
 */
export async function resolveOrg(ctx: UserContext, bodyOrgId?: string | null): Promise<string> {
  if (bodyOrgId) {
    if ((await permissionsIn(ctx, bodyOrgId)).length === 0) {
      throw new HttpError(403, "Sem acesso a esta organização");
    }
    return bodyOrgId;
  }
  const { data } = await ctx.userClient
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", ctx.user.id)
    .eq("status", "active");
  const orgs = (data ?? []).map((r: { organization_id: string }) => r.organization_id);
  if (orgs.length !== 1) throw new HttpError(400, "Informe organization_id");
  return orgs[0];
}

export async function requirePermission(ctx: UserContext, orgId: string, perm: string) {
  if (!(await permissionsIn(ctx, orgId)).includes(perm)) {
    throw new HttpError(403, "Sem permissão para esta ação");
  }
}

export async function isPlatformOperator(ctx: UserContext): Promise<boolean> {
  const { data } = await ctx.userClient
    .from("platform_operators")
    .select("user_id")
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  return !!data;
}
