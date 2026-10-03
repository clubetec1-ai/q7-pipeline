import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

interface Check { key: string; label: string; ok: boolean; detail: string; path: string }

/**
 * Saúde do sistema (dono/admin): números, e-mails, IA, fila parada, fluxos com erro e
 * ramais, com verde/vermelho e o botão que leva à tela para corrigir.
 */
export function OrgHealth({ orgId }: { orgId: string }) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    void supabase.rpc("org_health", { org: orgId }).then(({ data }) => setChecks((data as unknown as Check[] | null) ?? []));
  }, [orgId]);
  if (!checks?.length) return null;
  const bad = checks.filter((c) => !c.ok);
  const list = showAll || bad.length ? (showAll ? checks : bad) : [];

  return (
    <section className={`rounded-xl border p-4 space-y-2 ${bad.length ? "border-danger/40 bg-danger-soft" : "bg-card"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium flex items-center gap-2">
          <Activity className="w-4 h-4" /> Saúde do sistema
          <span className={`inline-block w-2.5 h-2.5 rounded-full ${bad.length ? "bg-danger" : "bg-success"}`} />
          <span className="text-sm font-normal text-muted-foreground">{bad.length ? `${bad.length} ponto(s) precisam de atenção` : "Tudo funcionando"}</span>
        </p>
        <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>{showAll ? "Ver menos" : "Ver tudo"}</Button>
      </div>
      {list.length > 0 && (
        <ul className="space-y-1.5">
          {list.map((c) => (
            <li key={c.key} className="flex items-center gap-2 text-sm">
              <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${c.ok ? "bg-success" : "bg-danger"}`} />
              <span className="font-medium">{c.label}:</span>
              <span className="text-muted-foreground flex-1">{c.detail}</span>
              {!c.ok && <Button asChild size="sm" variant="outline"><Link to={c.path}>Corrigir</Link></Button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
