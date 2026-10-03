import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";

interface Bad { id: string; name: string; health_status: string | null; health_error: string | null }

/** Faixa no topo para quem administra: número com problema (spec números §9). */
export function NumberHealthBanner() {
  const { org, can } = useOrg();
  const [bad, setBad] = useState<Bad[]>([]);
  const allowed = can("org.settings");

  useEffect(() => {
    if (!org || !allowed) return;
    supabase.from("whatsapp_instances").select("id, name, health_status, health_error")
      .eq("organization_id", org.id).in("health_status", ["warning", "critical"]).neq("status", "disabled")
      .then(({ data }) => setBad((data as Bad[]) ?? []));
  }, [org, allowed]);

  if (!allowed || !bad.length) return null;
  const critical = bad.some((b) => b.health_status === "critical");
  return (
    <div className={`px-4 py-2 text-sm flex items-center gap-2 border-b ${critical
      ? "bg-danger-soft text-danger-text"
      : "bg-warning-soft text-warning-text"}`}>
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span className="truncate">
        {bad.map((b) => `${b.name}: ${b.health_error ?? "precisa de atenção"}`).join(" · ")}
      </span>
      <Link to="/numeros" className="ml-auto underline shrink-0">Ver números</Link>
    </div>
  );
}
