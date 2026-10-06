import { useEffect, useState } from "react";
import { LifeBuoy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Row {
  org_id: string; name: string; desde: string; implantacao: number; ultimos_30: number; abertos: number; pelo_assistente: number;
  telas: { tela: string; n: number }[];
}

/**
 * Plataforma → Pedidos de ajuda (só a Clubetec; desenho 07, fatia 10): quantos chamados cada empresa abriu nos primeiros
 * 30 dias (a implantação) e em quais telas. A meta é o número cair a cada empresa nova; tela que concentra chamados é a
 * próxima a ganhar guia melhor. Só contagens, sem o conteúdo dos chamados.
 */
export function SupportMetricsPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    void supabase.rpc("platform_support_metrics").then(({ data, error }) => {
      if (error) setErro(error.message);
      else setRows((data as unknown as Row[]) ?? []);
    });
  }, []);

  if (erro) return <p className="text-sm text-danger-text">Medição de chamados não carregou: {erro}</p>;
  if (!rows) return null;
  return (
    <section className="rounded-xl border bg-card p-4 space-y-2">
      <h2 className="font-semibold flex items-center gap-2"><LifeBuoy className="w-4 h-4" /> Chamados por empresa</h2>
      <p className="text-xs text-muted-foreground">
        Empresas da mais nova para a mais antiga. "Na implantação" são os chamados dos primeiros 30 dias: a meta é esse número cair a
        cada empresa nova. As telas com mais chamados são as próximas a ganhar um passo a passo melhor.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr><th className="py-1 pr-3">Empresa</th><th className="pr-3">Desde</th><th className="pr-3">Na implantação</th><th className="pr-3">Últimos 30 dias</th><th className="pr-3">Abertos</th><th>Telas com mais chamados</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.org_id} className="border-t">
                <td className="py-1 pr-3">{r.name}</td>
                <td className="pr-3">{new Date(r.desde).toLocaleDateString("pt-BR")}</td>
                <td className="pr-3 font-medium">{r.implantacao}</td>
                <td className="pr-3">{r.ultimos_30}</td>
                <td className="pr-3">{r.abertos}</td>
                <td className="text-xs text-muted-foreground">{r.telas.length ? r.telas.map((t) => `${t.tela} (${t.n})`).join(" · ") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
