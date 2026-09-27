import { supabase } from "@/integrations/supabase/client";

export interface MemberName { name: string; email: string; named: boolean }

/**
 * Nome das pessoas da equipe NESTA organização (organization_members.display_name),
 * com o início do e-mail como reserva. Um só lugar para as telas não divergirem.
 */
export async function memberNames(orgId: string, ids?: string[]): Promise<Map<string, MemberName>> {
  let q = supabase.from("organization_members").select("user_id, display_name").eq("organization_id", orgId);
  if (ids) {
    if (!ids.length) return new Map();
    q = q.in("user_id", ids);
  }
  const { data: rows } = await q;
  const userIds = (rows ?? []).map((r) => r.user_id);
  const { data: profs } = userIds.length
    ? await supabase.from("profiles").select("user_id, email").in("user_id", userIds)
    : { data: [] as { user_id: string; email: string | null }[] };
  const email = new Map((profs ?? []).map((p) => [p.user_id, p.email ?? ""]));
  return new Map((rows ?? []).map((r) => {
    const e = email.get(r.user_id) ?? "";
    return [r.user_id, { name: r.display_name || e.split("@")[0] || "Sem nome", email: e, named: !!r.display_name }];
  }));
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || "um atendente";
