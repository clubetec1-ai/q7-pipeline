import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useOrg } from "@/contexts/OrgContext";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Section = "conversas" | "kanban" | "registros" | "cobrancas" | "integracoes" | "equipe" | "numeros" | "fluxos" | "biblioteca" | "diagnostico" | "supervisor" | "avaliacoes" | "campanhas" | "seguranca" | "melhorias" | "plataforma";
interface Item { key: Section; to: string; label: string; show: boolean }

const base = "px-3 py-1.5 text-sm rounded-md transition inline-flex items-center gap-1";
const activeCls = `${base} bg-muted font-medium`;
const idleCls = `${base} text-muted-foreground hover:bg-muted`;

/**
 * Menu principal enxuto: Conversas e Kanban sempre à mão; o resto em grupos
 * (Clientes, Gestão, Configurar, Conta). Grupo com um item só vira link direto,
 * então o atendente vê poucos botões e quem gerencia não fica com uma fila longa.
 */
export function MainNav({ active }: { active: Section }) {
  const { can, isOperator, orgs, org, selectOrg } = useOrg();
  const manage = can("org.settings");
  const reports = can("reports.view");
  const groups: { label: string; items: Item[] }[] = [
    { label: "Clientes", items: [
      { key: "registros", to: "/registros", label: "Registros", show: true },
      { key: "cobrancas", to: "/cobrancas", label: "Cobranças", show: manage || reports },
      { key: "campanhas", to: "/campanhas", label: "Campanhas", show: can("campaigns.manage") },
    ] },
    { label: "Gestão", items: [
      { key: "supervisor", to: "/supervisor", label: "Supervisor", show: reports },
      { key: "melhorias", to: "/melhorias", label: "Melhorias", show: manage || reports },
      { key: "avaliacoes", to: "/avaliacoes", label: "Avaliações", show: reports || can("conversations.attend") },
      { key: "equipe", to: "/equipe", label: "Equipe", show: can("members.manage") || can("departments.manage") },
    ] },
    { label: "Configurar", items: [
      { key: "diagnostico", to: "/diagnostico", label: "Diagnóstico", show: manage },
      { key: "fluxos", to: "/fluxos", label: "Fluxos", show: manage },
      { key: "numeros", to: "/numeros", label: "Números e e-mails", show: manage },
      { key: "integracoes", to: "/integracoes", label: "Integrações", show: manage },
      { key: "biblioteca", to: "/biblioteca", label: "Biblioteca", show: can("library.manage") },
    ] },
    { label: "Conta", items: [
      { key: "seguranca", to: "/seguranca", label: "Segurança", show: true },
      { key: "plataforma", to: "/plataforma", label: "Plataforma (Clubetec)", show: isOperator },
    ] },
  ];

  return (
    <nav className="hidden sm:flex items-center gap-1 ml-2">
      {orgs.length > 1 && (
        <select className="h-8 max-w-[180px] rounded-md border bg-background px-2 text-xs mr-1" value={org?.id ?? ""}
          title="Empresa" onChange={(e) => selectOrg(e.target.value)}>
          {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      )}
      <Link to="/" className={active === "conversas" ? activeCls : idleCls}>Conversas</Link>
      <Link to="/kanban" className={active === "kanban" ? activeCls : idleCls}>Kanban</Link>
      {groups.map((g) => {
        const items = g.items.filter((i) => i.show);
        if (!items.length) return null;
        if (items.length === 1) {
          const i = items[0];
          return <Link key={i.key} to={i.to} className={active === i.key ? activeCls : idleCls}>{i.label}</Link>;
        }
        const current = items.find((i) => i.key === active);
        return (
          <DropdownMenu key={g.label}>
            <DropdownMenuTrigger className={current ? activeCls : idleCls}>
              {current ? current.label : g.label} <ChevronDown className="w-3.5 h-3.5 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {items.map((i) => (
                <DropdownMenuItem key={i.key} asChild className={active === i.key ? "font-medium" : ""}>
                  <Link to={i.to}>{i.label}</Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
    </nav>
  );
}
