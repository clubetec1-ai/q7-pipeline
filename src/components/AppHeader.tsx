import type { ComponentProps } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Logo } from "@/components/Logo";
import { MainNav } from "@/components/MainNav";
import { NotificationsBell } from "@/components/NotificationsBell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";

/** Cabeçalho único das telas: logo, menu, avisos, tema e sair. */
export function AppHeader({ active }: { active: ComponentProps<typeof MainNav>["active"] }) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="border-b px-4 h-14 flex items-center justify-between shrink-0 bg-background/95 backdrop-blur sticky top-0 z-40">
      <div className="flex items-center gap-3 min-w-0">
        <Logo horizontal width={26} height={26} />
        <MainNav active={active} />
      </div>
      <div className="flex items-center gap-1">
        <NotificationsBell />
        <ThemeToggle />
        <Button variant="ghost" size="icon" title="Sair" onClick={async () => { await signOut(); navigate("/login"); }}>
          <LogOut className="w-4 h-4" />
        </Button>
      </div>
    </header>
  );
}
