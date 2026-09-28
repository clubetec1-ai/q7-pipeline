import { Link } from "react-router-dom";
import {
  Activity, BarChart3, BookOpen, Bot, Building2, ChevronDown, ClipboardCheck, ClipboardList, Contact, Library, Megaphone, Menu,
  MessageSquare, Phone, Tags, Plug, RefreshCw, Server, Settings2, ShieldCheck, Target, Trello, UserCog, UsersRound, Wallet, Workflow,
  type LucideIcon,
} from "lucide-react";
import { useOrg } from "@/contexts/OrgContext";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Section = "conversas" | "kanban" | "registros" | "cobrancas" | "integracoes" | "equipe" | "numeros" | "fluxos" | "biblioteca" | "diagnostico" | "supervisor" | "avaliacoes" | "campanhas" | "seguranca" | "melhorias" | "conhecimento" | "clientes" | "agente" | "relatorios" | "etiquetas" | "plataforma";
interface Item { key: Section; to: string; label: string; icon: LucideIcon; show: boolean }

const base = "px-3 py-1.5 text-sm rounded-md transition inline-flex items-center gap-1.5";
const activeCls = `${base} bg-muted font-medium`;
const idleCls = `${base} text-muted-foreground hover:bg-muted`;

/**
 * Menu principal enxuto, com ícone em cada item: Conversas e Kanban sempre à mão;
 * o resto em grupos (Clientes, Gestão, Configurar, Conta). Grupo com um item só
 * vira link direto. No celular, tudo fica no botão ☰.
 */
export function MainNav({ active }: { active: Section }) {
  const { can, isOperator, orgs, org, selectOrg } = useOrg();
  const manage = can("org.settings");
  const reports = can("reports.view");
  const top: Item[] = [
    { key: "conversas", to: "/", label: "Conversas", icon: MessageSquare, show: true },
    { key: "kanban", to: "/kanban", label: "Kanban", icon: Trello, show: true },
  ];
  const groups: { label: string; icon: LucideIcon; items: Item[] }[] = [
    { label: "Clientes", icon: Contact, items: [
      { key: "clientes", to: "/clientes", label: "Clientes e fichas", icon: Contact, show: can("conversations.attend") || manage || reports },
      { key: "registros", to: "/registros", label: "Registros", icon: ClipboardList, show: true },
      { key: "cobrancas", to: "/cobrancas", label: "Cobranças", icon: Wallet, show: manage || reports || can("conversations.attend") },
      { key: "campanhas", to: "/campanhas", label: "Campanhas", icon: Megaphone, show: can("campaigns.manage") },
      { key: "etiquetas", to: "/etiquetas", label: "Etiquetas e grupos", icon: Tags, show: can("library.manage") || can("contacts.groups_manage") },
    ] },
    { label: "Gestão", icon: Activity, items: [
      { key: "relatorios", to: "/relatorios", label: "Relatórios", icon: BarChart3, show: manage || reports || can("conversations.attend") },
      { key: "supervisor", to: "/supervisor", label: "Supervisor", icon: Activity, show: reports },
      { key: "melhorias", to: "/melhorias", label: "Melhorias", icon: RefreshCw, show: manage || reports },
      { key: "avaliacoes", to: "/avaliacoes", label: "Avaliações", icon: ClipboardCheck, show: reports || can("conversations.attend") },
      { key: "equipe", to: "/equipe", label: "Equipe", icon: UsersRound, show: can("members.manage") || can("departments.manage") },
    ] },
    { label: "Configurar", icon: Settings2, items: [
      { key: "diagnostico", to: "/diagnostico", label: "Diagnóstico", icon: Target, show: manage },
      { key: "agente", to: "/agente", label: "Agente de IA e follow-up", icon: Bot, show: manage },
      { key: "fluxos", to: "/fluxos", label: "Fluxos", icon: Workflow, show: manage },
      { key: "conhecimento", to: "/conhecimento", label: "Base de conhecimento", icon: BookOpen, show: manage || can("library.manage") },
      { key: "numeros", to: "/numeros", label: "Números e e-mails", icon: Phone, show: manage },
      { key: "integracoes", to: "/integracoes", label: "Integrações", icon: Plug, show: manage },
      { key: "biblioteca", to: "/biblioteca", label: "Biblioteca", icon: Library, show: can("library.manage") },
    ] },
    { label: "Conta", icon: UserCog, items: [
      { key: "seguranca", to: "/seguranca", label: "Segurança", icon: ShieldCheck, show: true },
      { key: "plataforma", to: "/plataforma", label: "Plataforma (Clubetec)", icon: Building2, show: isOperator },
      { key: "plataforma", to: "/admin/uazapi", label: "Uazapi global (Clubetec)", icon: Server, show: isOperator },
    ] },
  ];
  const visible = groups.map((g) => ({ ...g, items: g.items.filter((i) => i.show) })).filter((g) => g.items.length);
  const link = (i: Item) => (
    <Link key={i.to} to={i.to} className={active === i.key ? activeCls : idleCls}><i.icon className="w-4 h-4" />{i.label}</Link>
  );

  return (
    <>
      {/* Celular: tudo num botão só */}
      <DropdownMenu>
        <DropdownMenuTrigger className="sm:hidden ml-1 p-2 rounded-md hover:bg-muted" aria-label="Menu"><Menu className="w-5 h-5" /></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 max-h-[80vh] overflow-y-auto">
          {top.map((i) => (
            <DropdownMenuItem key={i.to} asChild><Link to={i.to} className="gap-2"><i.icon className="w-4 h-4" />{i.label}</Link></DropdownMenuItem>
          ))}
          {visible.map((g) => (
            <div key={g.label}>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">{g.label}</DropdownMenuLabel>
              {g.items.map((i) => (
                <DropdownMenuItem key={i.to} asChild><Link to={i.to} className="gap-2"><i.icon className="w-4 h-4" />{i.label}</Link></DropdownMenuItem>
              ))}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <nav className="hidden sm:flex items-center gap-1 ml-2">
        {orgs.length > 1 && (
          <select className="h-8 max-w-[180px] rounded-md border bg-background px-2 text-xs mr-1" value={org?.id ?? ""}
            title="Empresa" onChange={(e) => selectOrg(e.target.value)}>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
        {top.map(link)}
        {visible.map((g) => {
          if (g.items.length === 1) return link(g.items[0]);
          const current = g.items.find((i) => i.key === active);
          const Icon = current?.icon ?? g.icon;
          return (
            <DropdownMenu key={g.label}>
              <DropdownMenuTrigger className={current ? activeCls : idleCls}>
                <Icon className="w-4 h-4" />{current ? current.label : g.label}<ChevronDown className="w-3.5 h-3.5 opacity-60" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {g.items.map((i) => (
                  <DropdownMenuItem key={i.to} asChild className={active === i.key ? "font-medium" : ""}>
                    <Link to={i.to} className="gap-2"><i.icon className="w-4 h-4" />{i.label}</Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
      </nav>
    </>
  );
}
