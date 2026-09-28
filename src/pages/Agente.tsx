import { useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Logo } from "@/components/Logo";
import { MainNav } from "@/components/MainNav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ConfigDrawer } from "@/components/ConfigDrawer";
import { Button } from "@/components/ui/button";

/**
 * Caminho no menu para a configuração do agente de IA do atendimento, do
 * follow-up automático e dos números (a mesma gaveta de Conversas/Kanban).
 */
export default function Agente() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b px-4 h-14 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Logo horizontal width={26} height={26} />
          <MainNav active="agente" />
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" size="icon" title="Sair" onClick={async () => { await signOut(); navigate("/login"); }}><LogOut className="w-4 h-4" /></Button>
        </div>
      </header>
      <main className="flex-1 w-full max-w-3xl mx-auto p-6 text-sm text-muted-foreground">
        A configuração do agente de IA, do follow-up automático e dos números abre ao lado. Ao fechar, você volta para Conversas.
      </main>
      <ConfigDrawer open onOpenChange={(o) => { if (!o) navigate("/"); }} />
    </div>
  );
}
