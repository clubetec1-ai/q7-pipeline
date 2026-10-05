import { Link } from "react-router-dom";
import { useOrg } from "@/contexts/OrgContext";
import { useAreaApprover } from "@/lib/useAreaApprover";

type Group = "resultados" | "clientes";
interface Tab { key: string; to: string; label: string; show: boolean }

/**
 * Abas no topo das telas de um mesmo grupo do menu (Resultados e Clientes): a pessoa
 * passa de uma tela para outra sem voltar ao menu. Cada aba só aparece com a
 * permissão e o módulo certos (as mesmas regras do MainNav).
 */
export function SectionTabs({ group, active }: { group: Group; active: string }) {
  const { can, hasModule, org } = useOrg();
  const approver = useAreaApprover(org?.id);
  const manage = can("org.settings");
  const reports = can("reports.view");
  const attend = can("conversations.attend");
  const tabs: Tab[] = group === "resultados"
    ? [
      { key: "cerebro", to: "/cerebro", label: "Cérebro", show: (can("org.settings") && hasModule("gestao")) || approver },
      { key: "supervisor", to: "/supervisor", label: "Agora", show: reports && hasModule("gestao") },
      { key: "relatorios", to: "/relatorios", label: "Relatórios", show: manage || reports || attend },
      { key: "funil", to: "/funil", label: "Funil de vendas", show: manage || reports },
      { key: "avaliacoes", to: "/avaliacoes", label: "Avaliações", show: (reports || attend) && hasModule("gestao") },
      { key: "melhorias", to: "/melhorias", label: "Melhorias", show: (manage || reports) && hasModule("gestao") },
    ]
    : [
      { key: "clientes", to: "/clientes", label: "Clientes", show: attend || manage || reports },
      { key: "registros", to: "/registros", label: "Registros", show: manage || reports },
      { key: "cobrancas", to: "/cobrancas", label: "Cobranças", show: (manage || reports || attend) && hasModule("cobrancas") },
      { key: "campanhas", to: "/campanhas", label: "Campanhas", show: can("campaigns.manage") && hasModule("campanhas") },
    ];
  const visible = tabs.filter((t) => t.show);
  if (visible.length < 2) return null;
  return (
    <nav className="border-b bg-card px-4" aria-label={group === "resultados" ? "Resultados" : "Clientes"}>
      <div className="flex gap-1 overflow-x-auto">
        {visible.map((t) => (
          <Link key={t.key} to={t.to}
            className={`relative inline-flex h-10 items-center px-3 text-sm font-medium whitespace-nowrap transition-colors ${
              t.key === active
                ? "text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary"
                : "text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
