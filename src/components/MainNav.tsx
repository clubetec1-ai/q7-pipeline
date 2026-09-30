import { Link } from "react-router-dom";
import {
  Activity, BarChart3, Building2, ChevronDown, ClipboardCheck, ClipboardList, Contact, Home, Layers, Megaphone, Menu,
  MessageSquare, MessagesSquare, Palette, RefreshCw, Settings2, ShieldCheck, Target, Trello, UserCog, UsersRound, Wallet,
  type LucideIcon,
} from "lucide-react";
import { useOrg } from "@/contexts/OrgContext";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Section = "inicio" | "conversas" | "kanban" | "registros" | "cobrancas" | "integracoes" | "equipe" | "numeros" | "fluxos" | "biblioteca"
  | "diagnostico" | "supervisor" | "avaliacoes" | "campanhas" | "seguranca" | "melhorias" | "conhecimento" | "clientes" | "agente"
  | "relatorios" | "etiquetas" | "chat" | "ramais" | "setores" | "configuracoes" | "plataforma";
interface Item { key: Section; to: string; label: string; icon: LucideIcon; show: boolean; also?: Section[] }

/** Telas de instalação: ficam dentro da central de Configurações (o menu destaca "Configurações"). */
const CONFIG_PAGES: Section[] = ["configuracoes", "numeros", "ramais", "etiquetas", "biblioteca", "agente", "fluxos", "conhecimento", "integracoes"];

const base = "px-3 py-1.5 text-sm rounded-md transition inline-flex items-center gap-1.5";
const activeCls = `${base} bg-muted font-medium`;
const idleCls = `${base} text-muted-foreground hover:bg-muted`;

/**
 * Menu principal: o dia a dia no topo (Início, Conversas, Kanban, Chat) e o resto
 * em grupos — Clientes, Gestão, Minha empresa, Configurações (uma central só) e
 * Conta. Grupo com um item só vira link direto. No celular, tudo fica no botão ☰.
 */
export function MainNav({ active }: { active: Section }) {
  const { can, isOperator, orgs, org, selectOrg, hasModule } = useOrg();
  const manage = can("org.settings");
  const reports = can("reports.view");
  const attend = can("conversations.attend");
  const configures = manage || isOperator || can("library.manage") || can("departments.manage") || can("members.manage");
  const top: Item[] = [
    { key: "inicio", to: "/inicio", label: "Início", icon: Home, show: true },
    { key: "conversas", to: "/", label: "Conversas", icon: MessageSquare, show: true },
    { key: "kanban", to: "/kanban", label: "Kanban", icon: Trello, show: true },
    { key: "chat", to: "/chat", label: "Chat", icon: MessagesSquare, show: true },
  ];
  const groups: { label: string; icon: LucideIcon; items: Item[] }[] = [
    { label: "Clientes", icon: Contact, items: [
      { key: "clientes", to: "/clientes", label: "Clientes e fichas", icon: Contact, show: attend || manage || reports },
      { key: "registros", to: "/registros", label: "Registros", icon: ClipboardList, show: true },
      { key: "cobrancas", to: "/cobrancas", label: "Cobranças", icon: Wallet, show: (manage || reports || attend) && hasModule("cobrancas") },
      { key: "campanhas", to: "/campanhas", label: "Campanhas", icon: Megaphone, show: can("campaigns.manage") && hasModule("campanhas") },
    ] },
    { label: "Gestão", icon: Activity, items: [
      { key: "relatorios", to: "/relatorios", label: "Relatórios", icon: BarChart3, show: manage || reports || attend },
      { key: "supervisor", to: "/supervisor", label: "Supervisor", icon: Activity, show: reports && hasModule("gestao") },
      { key: "avaliacoes", to: "/avaliacoes", label: "Avaliações", icon: ClipboardCheck, show: (reports || attend) && hasModule("gestao") },
      { key: "melhorias", to: "/melhorias", label: "Melhorias", icon: RefreshCw, show: (manage || reports) && hasModule("gestao") },
    ] },
    { label: "Minha empresa", icon: Building2, items: [
      { key: "diagnostico", to: "/diagnostico", label: "Diagnóstico", icon: Target, show: manage && hasModule("diagnostico") },
      { key: "diagnostico", to: "/diagnostico?pagina=marca", label: "Marca", icon: Palette, show: manage && hasModule("diagnostico") },
      { key: "setores", to: "/setores", label: "Setores e processos", icon: Layers, show: manage || can("departments.manage") },
      { key: "equipe", to: "/equipe", label: "Equipe e permissões", icon: UsersRound, show: can("members.manage") || can("departments.manage") },
    ] },
    { label: "Configurações", icon: Settings2, items: [
      { key: "configuracoes", to: "/configuracoes", label: "Configurações", icon: Settings2, show: configures, also: CONFIG_PAGES },
    ] },
    { label: "Conta", icon: UserCog, items: [
      { key: "seguranca", to: "/seguranca", label: "Segurança", icon: ShieldCheck, show: true },
      { key: "plataforma", to: "/plataforma", label: "Plataforma (Clubetec)", icon: Building2, show: isOperator },
    ] },
  ];
  const isActive = (i: Item) => active === i.key || !!i.also?.includes(active);
  const visible = groups.map((g) => ({ ...g, items: g.items.filter((i) => i.show) })).filter((g) => g.items.length);
  const link = (i: Item) => (
    <Link key={i.to} to={i.to} className={isActive(i) ? activeCls : idleCls}><i.icon className="w-4 h-4" />{i.label}</Link>
  );

  return (
    <>
      {/* Celular: tudo num botão só */}
      <DropdownMenu>
        <DropdownMenuTrigger className="lg:hidden ml-1 p-2 rounded-md hover:bg-muted" aria-label="Menu"><Menu className="w-5 h-5" /></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 max-h-[80vh] overflow-y-auto">
          {orgs.length > 1 && (
            <div className="px-2 py-1.5">
              <select className="h-8 w-full rounded-md border bg-background px-2 text-xs" value={org?.id ?? ""} title="Empresa" onChange={(e) => selectOrg(e.target.value)}>
                {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}
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

      <nav className="hidden lg:flex items-center gap-1 ml-2">
        {orgs.length > 1 && (
          <select className="h-8 max-w-[180px] rounded-md border bg-background px-2 text-xs mr-1" value={org?.id ?? ""}
            title="Empresa" onChange={(e) => selectOrg(e.target.value)}>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
        {top.map(link)}
        {visible.map((g) => {
          if (g.items.length === 1) return link(g.items[0]);
          const current = g.items.find(isActive);
          const Icon = current?.icon ?? g.icon;
          return (
            <DropdownMenu key={g.label}>
              <DropdownMenuTrigger className={current ? activeCls : idleCls}>
                <Icon className="w-4 h-4" />{current ? current.label : g.label}<ChevronDown className="w-3.5 h-3.5 opacity-60" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {g.items.map((i) => (
                  <DropdownMenuItem key={i.to} asChild className={isActive(i) ? "font-medium" : ""}>
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
