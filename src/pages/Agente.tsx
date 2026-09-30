import { useNavigate } from "react-router-dom";
import { AppHeader } from "@/components/AppHeader";
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
      <AppHeader active="agente" />
      <main className="flex-1 w-full max-w-3xl mx-auto p-6 text-sm text-muted-foreground">
        A configuração do agente de IA, do follow-up automático e dos números abre ao lado. Ao fechar, você volta para Conversas.
      </main>
      <ConfigDrawer open onOpenChange={(o) => { if (!o) navigate("/"); }} />
    </div>
  );
}
