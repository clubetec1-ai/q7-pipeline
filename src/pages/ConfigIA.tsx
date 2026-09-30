import { Link, Navigate } from "react-router-dom";
import { ArrowLeft, KeyRound } from "lucide-react";
import { useOrg } from "@/contexts/OrgContext";
import { AppHeader } from "@/components/AppHeader";
import { NumberHealthBanner } from "@/components/NumberHealthBanner";
import { FlowSecrets } from "./fluxos/FlowSecrets";

/**
 * Configurações → Chaves de IA (dono/admin): chave de cada provedor, provedor
 * padrão, leitura de imagens/PDF e segredos do bloco "Consultar sistema".
 * Os valores vão para o cofre e nunca voltam para a tela.
 */
export default function ConfigIA() {
  const { org, can } = useOrg();
  if (!org) return null;
  if (!can("org.settings")) return <Navigate to="/" replace />;
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="configuracoes" />
      <NumberHealthBanner />
      <main className="flex-1 w-full max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
        <Link to="/configuracoes" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:underline"><ArrowLeft className="w-4 h-4" /> Configurações</Link>
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><KeyRound className="w-6 h-6" /> Chaves de IA</h1>
          <p className="text-sm text-muted-foreground">
            Cole a chave uma vez: ela vai para o cofre e não aparece mais (só mostramos se está cadastrada). O provedor padrão vale para o agente de
            atendimento, os fluxos, o follow-up e o Diagnóstico.
          </p>
        </div>
        <FlowSecrets orgId={org.id} />
      </main>
    </div>
  );
}
