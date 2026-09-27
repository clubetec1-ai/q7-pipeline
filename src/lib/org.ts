import { supabase } from "@/integrations/supabase/client";

/**
 * Organização ativa do usuário. Provisório até o OrgContext (plano 1D):
 * hoje cada usuário pertence a uma organização só. Quem garante o acesso é a
 * RLS; isto só escolhe o contexto.
 */
export async function getActiveOrgId(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("organization_members" as any)
    .select("organization_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  return (data as { organization_id?: string } | null)?.organization_id ?? null;
}
