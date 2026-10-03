import type { ComponentProps, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, LogOut, Mail, MessagesSquare, Moon, Phone, ShieldCheck, Sun, UserCog } from "lucide-react";
import { Link } from "react-router-dom";
import { useOrg } from "@/contexts/OrgContext";
import { togglePhonePanel, usePhoneState } from "@/lib/phoneBus";
import { useAuth } from "@/contexts/AuthContext";
import { Logo } from "@/components/Logo";
import { MainNav } from "@/components/MainNav";
import { NotificationsBell } from "@/components/NotificationsBell";
import { AppAssistant } from "@/components/AppAssistant";
import { useOrgLogo } from "@/components/OrgTheme";
import { useTheme } from "@/components/ThemeProvider";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

/** Cabeçalho único das telas: logo, menu, avisos e o menu da pessoa (conta, tema, sair) (extra: ex. presença em Conversas). */
export function AppHeader({ active, extra }: { active: ComponentProps<typeof MainNav>["active"]; extra?: ReactNode }) {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const sair = async () => { await signOut(); navigate("/login"); };
  const phone = usePhoneState();
  const { invitations, isOperator } = useOrg();
  const { theme, toggleTheme } = useTheme();
  const orgLogo = useOrgLogo();
  return (
    <header className="border-b px-4 h-14 flex items-center justify-between shrink-0 bg-card sticky top-0 z-40"
      style={{ borderTop: "3px solid hsl(var(--brand-secondary, var(--primary)))" }}>
      <div className="flex items-center gap-3 min-w-0">
        <Logo horizontal width={26} height={26} />
        {orgLogo && <img src={orgLogo} alt="Logo da empresa" className="h-8 max-w-[110px] object-contain shrink-0 pl-3 border-l" />}
        <MainNav active={active} />
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {invitations.length > 0 && (
          <Button asChild size="sm" variant="default" className="h-8"><Link to="/convite"><Mail className="w-4 h-4 xl:mr-1" /><span className="hidden xl:inline">Convite</span>&nbsp;({invitations.length})</Link></Button>
        )}
        {extra}
        {phone.available && (
          <Button variant="ghost" size="icon" title={`Ramal: ${phone.status}`} onClick={togglePhonePanel}
            className={`relative ${phone.ringing ? "bg-emerald-600 text-white animate-pulse hover:bg-emerald-700" : ""}`}>
            <Phone className="w-4 h-4" />
            <span className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${phone.dot}`} />
          </Button>
        )}
        <Button asChild variant="ghost" size="sm" className="h-9 px-2 hidden lg:inline-flex" title="Equipe (chat interno)">
          <Link to="/chat"><MessagesSquare className="w-4 h-4 xl:mr-1" /><span className="hidden xl:inline">Equipe</span></Link>
        </Button>
        <AppAssistant />
        <NotificationsBell />
        {/* Menu da pessoa: conta, tema e sair num lugar só (cabeçalho mais limpo). */}
        <DropdownMenu>
          <DropdownMenuTrigger className="h-9 w-9 inline-flex items-center justify-center rounded-md hover:bg-muted" title="Conta" aria-label="Conta">
            <UserCog className="w-4 h-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {user?.email && <DropdownMenuLabel className="text-xs font-normal text-muted-foreground truncate">{user.email}</DropdownMenuLabel>}
            <DropdownMenuItem asChild><Link to="/seguranca" className="gap-2"><ShieldCheck className="w-4 h-4" /> Segurança</Link></DropdownMenuItem>
            {isOperator && <DropdownMenuItem asChild><Link to="/plataforma" className="gap-2"><Building2 className="w-4 h-4" /> Plataforma</Link></DropdownMenuItem>}
            <DropdownMenuItem className="gap-2" onSelect={(e) => { e.preventDefault(); toggleTheme(); }}>
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />} {theme === "dark" ? "Tema claro" : "Tema escuro"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2" onSelect={() => void sair()}><LogOut className="w-4 h-4" /> Sair</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
