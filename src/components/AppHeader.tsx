import type { ComponentProps, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Mail, Phone } from "lucide-react";
import { Link } from "react-router-dom";
import { useOrg } from "@/contexts/OrgContext";
import { togglePhonePanel, usePhoneState } from "@/lib/phoneBus";
import { useAuth } from "@/contexts/AuthContext";
import { Logo } from "@/components/Logo";
import { MainNav } from "@/components/MainNav";
import { NotificationsBell } from "@/components/NotificationsBell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";

/** Cabeçalho único das telas: logo, menu, avisos, tema e sair (extra: ex. presença em Conversas). */
export function AppHeader({ active, extra }: { active: ComponentProps<typeof MainNav>["active"]; extra?: ReactNode }) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const phone = usePhoneState();
  const { invitations } = useOrg();
  return (
    <header className="border-b px-4 h-14 flex items-center justify-between shrink-0 bg-background/95 backdrop-blur sticky top-0 z-40">
      <div className="flex items-center gap-3 min-w-0">
        <Logo horizontal width={26} height={26} />
        <MainNav active={active} />
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {invitations.length > 0 && (
          <Button asChild size="sm" variant="default" className="h-8"><Link to="/convite"><Mail className="w-4 h-4 mr-1" /> Convite ({invitations.length})</Link></Button>
        )}
        {extra}
        {phone.available && (
          <Button variant="ghost" size="icon" title={`Ramal: ${phone.status}`} onClick={togglePhonePanel}
            className={`relative ${phone.ringing ? "bg-emerald-600 text-white animate-pulse hover:bg-emerald-700" : ""}`}>
            <Phone className="w-4 h-4" />
            <span className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${phone.dot}`} />
          </Button>
        )}
        <NotificationsBell />
        <ThemeToggle />
        <Button variant="ghost" size="icon" title="Sair" onClick={async () => { await signOut(); navigate("/login"); }}>
          <LogOut className="w-4 h-4" />
        </Button>
      </div>
    </header>
  );
}
