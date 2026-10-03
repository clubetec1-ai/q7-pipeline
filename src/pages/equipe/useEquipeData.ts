import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface Member {
  user_id: string;
  role: string;
  status: string;
  name: string;
  email: string;
  /** Tem nome definido nesta organização (senão, mostra o início do e-mail). */
  named: boolean;
}
export interface Department {
  id: string; name: string; color: string | null; distribution_mode: string; max_concurrent: number;
  overflow_to: string[]; overflow_after_minutes: number | null;
  preferred_agent: boolean; preferred_days: number;
}
export interface Team { id: string; name: string; department_id: string }
export interface Link { a: string; user_id: string } // a = department_id ou team_id

export const ROLE_LABEL: Record<string, string> = {
  owner: "Dono",
  admin: "Administrador",
  supervisor: "Supervisor",
  agent: "Atendente",
};
export const STATUS_LABEL: Record<string, string> = {
  active: "Ativo",
  invited: "Convite pendente",
  disabled: "Desativado",
};

/** Tudo que a tela Equipe mostra, lido com o JWT do usuário (a RLS filtra). */
export function useEquipeData(orgId: string | undefined) {
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [deptMembers, setDeptMembers] = useState<Link[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamMembers, setTeamMembers] = useState<Link[]>([]);

  const reload = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [m, d, dm, t, tm] = await Promise.all([
      supabase.from("organization_members").select("user_id, role, status, display_name").eq("organization_id", orgId),
      supabase.from("departments").select("id, name, color, distribution_mode, max_concurrent, overflow_to, overflow_after_minutes, preferred_agent, preferred_days").eq("organization_id", orgId).order("name"),
      supabase.from("department_members").select("department_id, user_id").eq("organization_id", orgId),
      supabase.from("teams").select("id, name, department_id").eq("organization_id", orgId).order("name"),
      supabase.from("team_members").select("team_id, user_id").eq("organization_id", orgId),
    ]);
    const ids = (m.data ?? []).map((r) => r.user_id);
    const { data: profiles } = ids.length
      ? await supabase.from("profiles").select("user_id, full_name, email").in("user_id", ids)
      : { data: [] as { user_id: string; full_name: string | null; email: string | null }[] };
    const byId = new Map((profiles ?? []).map((p) => [p.user_id, p]));
    setMembers(
      (m.data ?? [])
        .map((r) => {
          const p = byId.get(r.user_id);
          return {
            user_id: r.user_id,
            role: r.role,
            status: r.status,
            name: r.display_name || p?.email?.split("@")[0] || "Sem nome",
            named: !!r.display_name,
            email: p?.email ?? "",
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
    setDepartments(d.data ?? []);
    setDeptMembers((dm.data ?? []).map((r) => ({ a: r.department_id, user_id: r.user_id })));
    setTeams(t.data ?? []);
    setTeamMembers((tm.data ?? []).map((r) => ({ a: r.team_id, user_id: r.user_id })));
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { loading, members, departments, deptMembers, teams, teamMembers, reload };
}

export type EquipeData = ReturnType<typeof useEquipeData>;
