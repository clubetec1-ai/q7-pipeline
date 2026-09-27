import { Link } from "react-router-dom";
import { useOrg } from "@/contexts/OrgContext";

type Section = "conversas" | "kanban" | "equipe" | "numeros";

const base = "px-3 py-1.5 text-sm rounded-md transition";
const activeCls = `${base} bg-muted font-medium`;
const idleCls = `${base} text-muted-foreground hover:bg-muted`;

/** Menu principal. "Equipe" só aparece para quem gerencia membros ou departamentos. */
export function MainNav({ active }: { active: Section }) {
  const { can } = useOrg();
  const showTeam = can("members.manage") || can("departments.manage");
  const showNumbers = can("org.settings");
  return (
    <nav className="hidden sm:flex items-center gap-1 ml-2">
      <Link to="/" className={active === "conversas" ? activeCls : idleCls}>Conversas</Link>
      <Link to="/kanban" className={active === "kanban" ? activeCls : idleCls}>Kanban</Link>
      {showTeam && <Link to="/equipe" className={active === "equipe" ? activeCls : idleCls}>Equipe</Link>}
      {showNumbers && <Link to="/numeros" className={active === "numeros" ? activeCls : idleCls}>Números</Link>}
    </nav>
  );
}
