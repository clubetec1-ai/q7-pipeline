import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** A pessoa é responsável por alguma área nesta empresa? (a RLS só mostra as áreas dela; dono vê todas). */
export function useAreaApprover(orgId: string | undefined) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!orgId) { setCount(0); return; }
    let alive = true;
    void supabase.from("org_areas").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("enabled", true)
      .then(({ count: c }) => { if (alive) setCount(c ?? 0); });
    return () => { alive = false; };
  }, [orgId]);
  return count > 0;
}
