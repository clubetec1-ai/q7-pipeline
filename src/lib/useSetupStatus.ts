import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * O que a empresa já configurou (contagens pela RLS de quem está vendo). Alimenta
 * a central de Configurações e os "Primeiros passos" do Início. Só números, nada
 * de conteúdo.
 */
export interface SetupStatus {
  whatsapp: number; whatsappOnline: number; email: number; emailNoDept: number; ramais: number; nvoip: boolean;
  tags: number; tagScopes: number; groups: number; library: number; aiOn: number; flowsLive: number; knowledge: number;
  integrations: number; payments: boolean; aiKeys: number; platformAI: boolean; departments: number; members: number; diagApproved: number; brand: boolean; processes: number; planned: number;
  /** Horário de atendimento salvo; quem atende: só o dono ou com equipe (null = ainda não respondeu). */
  hours: boolean; teamMode: "solo" | "equipe" | null;
}
const EMPTY: SetupStatus = {
  whatsapp: 0, whatsappOnline: 0, email: 0, emailNoDept: 0, ramais: 0, nvoip: false, tags: 0, tagScopes: 0, groups: 0, library: 0, aiOn: 0,
  flowsLive: 0, knowledge: 0, integrations: 0, payments: false, aiKeys: 0, platformAI: false, departments: 0, members: 0, diagApproved: 0, brand: false, processes: 0, planned: 0,
  hours: false, teamMode: null,
};

export function useSetupStatus(orgId: string | undefined) {
  const [status, setStatus] = useState<SetupStatus>(EMPTY);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!orgId) return;
    const n = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0);
    const head = { count: "exact" as const, head: true };
    const [whatsapp, whatsappOnline, email, emailNoDept, ramais, tags, tagScopes, groups, library, aiOn, flowsLive, knowledge, integrations, departments, members, voice, profile, orgRow, keys, pAI] = await Promise.all([
      n(supabase.from("whatsapp_instances").select("id", head).eq("organization_id", orgId)),
      n(supabase.from("whatsapp_instances").select("id", head).eq("organization_id", orgId).eq("status", "connected")),
      n(supabase.from("email_accounts").select("id", head).eq("organization_id", orgId)),
      n(supabase.from("email_accounts").select("id", head).eq("organization_id", orgId).is("department_id", null).neq("status", "disabled")),
      n(supabase.from("pbx_extensions").select("id", head).eq("organization_id", orgId)),
      n(supabase.from("tags").select("id", head).eq("organization_id", orgId)),
      n(supabase.from("tag_departments").select("tag_id", head).eq("organization_id", orgId)),
      n(supabase.from("contact_groups").select("id", head).eq("organization_id", orgId)),
      n(supabase.from("library_files").select("id", head).eq("organization_id", orgId)),
      n(supabase.from("agent_configs").select("organization_id", head).eq("organization_id", orgId).eq("enabled", true)),
      n(supabase.from("flow_versions").select("id", head).eq("organization_id", orgId).eq("status", "published")),
      n(supabase.from("knowledge_docs").select("id", head).eq("organization_id", orgId)),
      n(supabase.from("integration_guides").select("id", head).eq("organization_id", orgId)),
      n(supabase.from("departments").select("id", head).eq("organization_id", orgId)),
      n(supabase.from("organization_members").select("user_id", head).eq("organization_id", orgId).eq("status", "active")),
      supabase.from("voice_integrations").select("has_credentials").eq("organization_id", orgId).maybeSingle(),
      supabase.from("company_profiles").select("steps, sections, brand, processes").eq("organization_id", orgId).maybeSingle(),
      supabase.from("organizations").select("settings").eq("id", orgId).maybeSingle(),
      supabase.rpc("ai_keys_status", { org: orgId }),
      supabase.rpc("platform_ai_available", { org: orgId }),
    ]);
    const p = profile.data as { steps?: Record<string, { approved_at?: string }>; sections?: Record<string, string>; brand?: { colors?: unknown[] }; processes?: { implementar?: string }[] } | null;
    setStatus({
      whatsapp, whatsappOnline, email, emailNoDept, ramais, nvoip: !!voice.data?.has_credentials, tags, tagScopes, groups, library, aiOn, flowsLive,
      knowledge, integrations, departments, members,
      platformAI: pAI.data === true,
      aiKeys: Object.values((keys.data as Record<string, boolean> | null) ?? {}).filter(Boolean).length,
      payments: ((orgRow.data?.settings ?? {}) as { payments?: { provider?: string } }).payments?.provider === "asaas",
      diagApproved: Object.values(p?.steps ?? {}).filter((s) => s?.approved_at).length,
      brand: !!(p?.sections?.marca_voz?.trim() || (p?.brand?.colors?.length ?? 0) > 0),
      processes: (p?.processes ?? []).length,
      planned: (p?.processes ?? []).filter((x) => x.implementar).length,
      hours: !!(orgRow.data?.settings as { business_hours?: unknown } | null)?.business_hours,
      teamMode: ((m) => (m === "solo" || m === "equipe" ? m : null))((orgRow.data?.settings as { team_mode?: string } | null)?.team_mode),
    });
    setLoading(false);
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);
  return { status, loading, reload: load };
}
