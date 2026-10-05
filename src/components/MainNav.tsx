import { Link } from "react-router-dom";
import {
  Activity, BarChart3, Brain, Building2, ChevronDown, ClipboardCheck, ClipboardList, Contact, Filter, Home, Megaphone, Menu,
  MessageSquare, MessagesSquare, RefreshCw, Settings2, ShieldCheck, Trello, UserCog, Wallet,
  type LucideIcon,
} from "lucide-react";
import { useOrg } from "@/contexts/OrgContext";
import { useAreaApprover } from "@/lib/useAreaApprover";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Section = "inicio" | "conversas" | "kanban" | "registros" | "cobrancas" | "integracoes" | "equipe" | "numeros" | "fluxos" | "biblioteca"
  | "diagnostico" | "supervisor" | "avaliacoes" | "campanhas" | "seguranca" | "melhorias" | "conhecimento" | "clientes" | "agente"
  | "relatorios" | "etiquetas" | "chat" | "ramais" | "setores" | "configuracoes" | "plataforma" | "funil" | "cerebro";
interface Item { key: Section; to: string; label: string; icon: LucideIcon; show: boolean; also?: Section[] }

/** Telas de instalação e da empresa: ficam dentro da central de Configurações (o menu destaca "Configurações"). */
const CONFIG_PAGES: Section[] = ["configuracoes", "numeros", "ramais", "etiquetas", "biblioteca", "agente", "fluxos", "conhecimento", "integracoes",
  "diagnostico", "setores", "equipe", "seguranca"];

// Desktop: só o nome (sem ícone), ativo sublinhado na cor principal. Ícones só no ☰ do celular.
const base = "relative inline-flex h-9 items-center gap-1 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors";
const activeCls = `${base} text-foreground after:absolute after:inset-x-3 after:-bottom-[10px] after:h-0.5 after:rounded-full after:bg-primary`;
const idleCls = `${base} text-muted-foreground hover:bg-muted hover:text-foreground`;

/**
 * Menu principal com no máximo 6 itens, sempre com nome: Início, Conversas, Funil,
 * Clientes, Resultados e Configurações (uma central só, que também reúne a empresa,
 * setores e equipe). O chat interno fica no cabeçalho ("Equipe"); conta e segurança,
 * no menu da pessoa. Grupo com um item só vira link direto. No celular, tudo no ☰.
 */
export function MainNav({ active }: { active: Section }) {
  const { can, isOperator, orgs, org, selectOrg, hasModule } = useOrg();
  const manage = can("org.settings");
  const reports = can("reports.view");
  const attend = can("conversations.attend");
  const approver = useAreaApprover(org?.id);
  const configures = manage || isOperator || can("library.manage") || can("departments.manage") || can("members.manage");
  const top: Item[] = [
    { key: "inicio", to: "/inicio", label: "Início", icon: Home, show: true },
    { key: "conversas", to: "/", label: "Conversas", icon: MessageSquare, show: true },
    { key: "kanban", to: "/kanban", label: "Funil", icon: Trello, show: true },
  ];
  const groups: { label: string; icon: LucideIcon; items: Item[] }[] = [
    { label: "Clientes", icon: Contact, items: [
      { key: "clientes", to: "/clientes", label: "Clientes e fichas", icon: Contact, show: attend || manage || reports },
      { key: "registros", to: "/registros", label: "Registros", icon: ClipboardList, show: manage || reports },
      { key: "cobrancas", to: "/cobrancas", label: "Cobranças", icon: Wallet, show: (manage || reports || attend) && hasModule("cobrancas") },
      { key: "campanhas", to: "/campanhas", label: "Campanhas", icon: Megaphone, show: can("campaigns.manage") && hasModule("campanhas") },
    ] },
    { label: "Resultados", icon: BarChart3, items: [
      { key: "cerebro", to: "/cerebro", label: "Cérebro", icon: Brain, show: (manage && hasModule("gestao")) || approver },
      { key: "supervisor", to: "/supervisor", label: "Agora (equipe e fila)", icon: Activity, show: reports && hasModule("gestao") },
      { key: "relatorios", to: "/relatorios", label: "Relatórios", icon: BarChart3, show: manage || reports || attend },
      { key: "funil", to: "/funil", label: "Funil de vendas", icon: Filter, show: manage || reports },
      { key: "avaliacoes", to: "/avaliacoes", label: "Avaliações", icon: ClipboardCheck, show: (reports || attend) && hasModule("gestao") },
      { key: "melhorias", to: "/melhorias", label: "Melhorias", icon: RefreshCw, show: (manage || reports) && hasModule("gestao") },
    ] },
    { label: "Configurações", icon: Settings2, items: [
      { key: "configuracoes", to: "/configuracoes", label: "Configurações", icon: Settings2, show: configures, also: CONFIG_PAGES },
    ] },
    { label: "Conta", icon: UserCog, items: [
      { key: "seguranca", to: "/seguranca", label: "Segurança", icon: ShieldCheck, show: true },
      { key: "plataforma", to: "/plataforma", label: "Plataforma", icon: Building2, show: isOperator },
    ] },
  ];
  const isActive = (i: Item) => active === i.key || !!i.also?.includes(active);
  const visible = groups.map((g) => ({ ...g, items: g.items.filter((i) => i.show) })).filter((g) => g.items.length);
  const link = (i: Item) => (
    <Link key={i.to} to={i.to} className={isActive(i) ? activeCls : idleCls}>{i.label}</Link>
  );
  // "Conta" fica no menu da pessoa, à direita do cabeçalho (no celular, continua no ☰).
  const desktop = visible.filter((g) => g.label !== "Conta");

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
          {[...top, { key: "chat" as Section, to: "/chat", label: "Equipe (chat interno)", icon: MessagesSquare, show: true }].map((i) => (
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

      <nav className="hidden lg:flex items-center gap-0.5 ml-1 min-w-0">
        {orgs.length > 1 && (
          <select className="h-8 max-w-[140px] rounded-md border bg-background px-2 text-xs mr-1" value={org?.id ?? ""}
            title="Empresa" onChange={(e) => selectOrg(e.target.value)}>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
        {top.map((i) => link(i))}
        {desktop.map((g) => {
          if (g.items.length === 1) return link(g.items[0]);
          const current = g.items.find(isActive);
          return (
            <DropdownMenu key={g.label}>
              <DropdownMenuTrigger className={current ? activeCls : idleCls}>
                {g.label}<ChevronDown className="w-3.5 h-3.5 opacity-60" />
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
