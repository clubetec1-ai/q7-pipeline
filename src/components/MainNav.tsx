import { Link } from "react-router-dom";
import { useOrg } from "@/contexts/OrgContext";

type Section = "conversas" | "kanban" | "registros" | "cobrancas" | "equipe" | "numeros" | "fluxos" | "biblioteca" | "diagnostico" | "supervisor" | "plataforma";

const base = "px-3 py-1.5 text-sm rounded-md transition";
const activeCls = `${base} bg-muted font-medium`;
const idleCls = `${base} text-muted-foreground hover:bg-muted`;

/** Menu principal. "Equipe" só aparece para quem gerencia membros ou departamentos. */
export function MainNav({ active }: { active: Section }) {
  const { can, isOperator, orgs, org, selectOrg } = useOrg();
  const showTeam = can("members.manage") || can("departments.manage");
  const showNumbers = can("org.settings");
  const showSupervisor = can("reports.view");
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
      <Link to="/registros" className={active === "registros" ? activeCls : idleCls}>Registros</Link>
      {(showNumbers || showSupervisor) && <Link to="/cobrancas" className={active === "cobrancas" ? activeCls : idleCls}>Cobranças</Link>}
      {showTeam && <Link to="/equipe" className={active === "equipe" ? activeCls : idleCls}>Equipe</Link>}
      {showNumbers && <Link to="/numeros" className={active === "numeros" ? activeCls : idleCls}>Números</Link>}
      {showNumbers && <Link to="/fluxos" className={active === "fluxos" ? activeCls : idleCls}>Fluxos</Link>}
      {can("library.manage") && <Link to="/biblioteca" className={active === "biblioteca" ? activeCls : idleCls}>Biblioteca</Link>}
      {showNumbers && <Link to="/diagnostico" className={active === "diagnostico" ? activeCls : idleCls}>Diagnóstico</Link>}
      {showSupervisor && <Link to="/supervisor" className={active === "supervisor" ? activeCls : idleCls}>Supervisor</Link>}
      {isOperator && <Link to="/plataforma" className={active === "plataforma" ? activeCls : idleCls}>Plataforma</Link>}
    </nav>
  );
}
