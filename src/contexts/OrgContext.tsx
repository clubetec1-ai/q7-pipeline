import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Organização ativa, papel e permissões do usuário.
 *
 * Só serve para a interface (mostrar ou esconder botões e telas). Quem garante
 * o acesso é a RLS do banco e as Edge Functions: nada aqui é confiável como
 * controle de segurança.
 */

export interface OrgSummary {
  id: string;
  name: string;
  role: string;
}

export interface Invitation {
  organization_id: string;
  organization_name: string;
  role: string;
}

interface OrgContextValue {
  loading: boolean;
  orgs: OrgSummary[];
  org: OrgSummary | null;
  permissions: string[];
  isOperator: boolean;
  invitations: Invitation[];
  can: (perm: string) => boolean;
  /** Módulo contratado pela empresa (a trava de verdade é no banco e no servidor; aqui só esconde a tela). */
  hasModule: (m: ModuleKey) => boolean;
  reloadModules: () => void;
  selectOrg: (id: string) => void;
  reload: () => Promise<void>;
}

export type ModuleKey = "diagnostico" | "ia" | "canais" | "telefonia" | "campanhas" | "cobrancas" | "gestao";

const OrgContext = createContext<OrgContextValue | undefined>(undefined);
const STORAGE_KEY = "clubecrm:org";

function readStoredOrg(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function OrgProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [orgId, setOrgId] = useState<string | null>(readStoredOrg());
  const [permissions, setPermissions] = useState<string[]>([]);
  const [isOperator, setIsOperator] = useState(false);
  const [invitations, setInvitations] = useState<Invitation[]>([]);

  const reload = useCallback(async () => {
    if (!user) {
      setOrgs([]);
      setPermissions([]);
      setIsOperator(false);
      setInvitations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data: members }, { data: op }, { data: inv }] = await Promise.all([
      supabase
        .from("organization_members")
        .select("organization_id, role, organizations(name)")
        .eq("user_id", user.id)
        .eq("status", "active"),
      supabase.from("platform_operators").select("user_id").eq("user_id", user.id).maybeSingle(),
      supabase.rpc("my_invitations"),
    ]);
    const list: OrgSummary[] = (members ?? [])
      .filter((m) => m.organizations)
      .map((m) => ({
        id: m.organization_id,
        role: m.role,
        name: (m.organizations as { name: string } | null)?.name ?? "Organização",
      }));
    // Operador com acesso de suporte ativo (motivo + prazo, auditado) vê a empresa no seletor.
    if (op) {
      const { data: sup } = await supabase.rpc("my_support_access");
      for (const s of sup ?? []) {
        if (!list.some((o) => o.id === s.organization_id)) {
          const until = new Date(s.expires_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
          list.push({ id: s.organization_id, role: "support", name: `${s.name} (suporte até ${until})` });
        }
      }
    }
    setOrgs(list);
    setIsOperator(!!op);
    setInvitations((inv as Invitation[] | null) ?? []);

    // A organização lembrada só vale se o usuário ainda for membro dela.
    const chosen = list.find((o) => o.id === orgId) ?? list[0] ?? null;
    setOrgId(chosen?.id ?? null);
    if (chosen) {
      const { data: perms } = await supabase.rpc("my_permissions", { org: chosen.id });
      setPermissions((perms as string[] | null) ?? []);
    } else {
      setPermissions([]);
    }
    setLoading(false);
    // orgId de fora de propósito: esta função é que decide a organização.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    reload();
  }, [reload]);

  const selectOrg = useCallback((id: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // armazenamento indisponível: só não lembra a escolha
    }
    setOrgId(id);
    supabase.rpc("my_permissions", { org: id }).then(({ data }) => setPermissions((data as string[] | null) ?? []));
  }, []);

  const org = useMemo(() => orgs.find((o) => o.id === orgId) ?? null, [orgs, orgId]);

  // Sinal de vida por minuto em qualquer tela do sistema: sem ele há 3 min, a
  // distribuição automática considera a pessoa ausente. (O builder do
  // supabase-js só dispara a chamada quando alguém aguarda o resultado.)
  useEffect(() => {
    if (!org || !user) return;
    const beat = () => { void supabase.rpc("heartbeat", { org: org.id }).then(() => undefined); };
    beat();
    const id = window.setInterval(beat, 60_000);
    return () => window.clearInterval(id);
  }, [org, user]);
  const can = useCallback((perm: string) => permissions.includes(perm), [permissions]);

  // Módulos ativos da empresa (antes de carregar, não esconde nada para não piscar).
  const [modules, setModules] = useState<Set<string> | null>(null);
  const [modTick, setModTick] = useState(0);
  useEffect(() => {
    setModules(null);
    if (!org) return;
    let alive = true;
    void supabase.from("org_modules").select("module, enabled").eq("organization_id", org.id)
      .then(({ data }) => { if (alive) setModules(new Set((data ?? []).filter((r) => r.enabled).map((r) => r.module))); });
    return () => { alive = false; };
  }, [org, modTick]);
  const hasModule = useCallback((m: ModuleKey) => modules === null || modules.has(m), [modules]);
  const reloadModules = useCallback(() => setModTick((t) => t + 1), []);

  return (
    <OrgContext.Provider
      value={{ loading, orgs, org, permissions, isOperator, invitations, can, hasModule, reloadModules, selectOrg, reload }}
    >
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg precisa estar dentro de OrgProvider");
  return ctx;
}
