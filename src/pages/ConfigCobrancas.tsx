import { Link, Navigate } from "react-router-dom";
import { ArrowLeft, Wallet } from "lucide-react";
import { useOrg } from "@/contexts/OrgContext";
import { AppHeader } from "@/components/AppHeader";
import { NumberHealthBanner } from "@/components/NumberHealthBanner";
import { AsaasSettings } from "./cobrancas/AsaasSettings";

/** Configurações → Cobranças: conexão com o Asaas e regras (dono/admin). */
export default function ConfigCobrancas() {
  const { org, can } = useOrg();
  if (!org) return null;
  if (!can("org.settings")) return <Navigate to="/cobrancas" replace />;
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="configuracoes" />
      <NumberHealthBanner />
      <main className="flex-1 w-full max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
        <Link to="/configuracoes" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:underline"><ArrowLeft className="w-4 h-4" /> Configurações</Link>
        <div>
          <h1 className="font-brand text-2xl leading-tight">Cobranças</h1>
          <p className="text-sm text-muted-foreground">Conecte o Asaas e defina as regras. As cobranças do dia a dia ficam em Clientes → Cobranças.</p>
        </div>
        <AsaasSettings orgId={org.id} />
      </main>
    </div>
  );
}
