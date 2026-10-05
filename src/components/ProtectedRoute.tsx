import { SubscriptionGate } from "@/components/SubscriptionGate";
import { CreateCompany } from "@/components/CreateCompany";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { Button } from "@/components/ui/button";
import { NamePrompt } from "@/components/NamePrompt";
import { MfaChallenge, MfaEnroll, useMfa } from "@/components/Mfa";

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

/**
 * Exige login e, salvo `allowWithoutOrg`, uma organização ativa. Quem ainda
 * não é membro de nenhuma organização mas tem convite vai para /convite.
 */
export const ProtectedRoute = ({
  children,
  allowWithoutOrg = false,
}: {
  children: React.ReactNode;
  allowWithoutOrg?: boolean;
}) => {
  const { user, loading, signOut } = useAuth();
  const { loading: orgLoading, orgs, invitations } = useOrg();
  const mfa = useMfa();

  if (loading || (user && (orgLoading || mfa.loading))) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  // Segundo passo antes de qualquer tela (o banco também bloqueia sem ele).
  // Depois do código, recarrega para as permissões virem com a sessão nova.
  if (mfa.needsCode) return <MfaChallenge onDone={() => window.location.reload()} />;
  if (mfa.status?.required && !mfa.status.enrolled) return <MfaEnroll mandatory onDone={() => window.location.reload()} />;
  if (orgs.length > 0) return <SubscriptionGate>{children}<NamePrompt /></SubscriptionGate>;
  if (allowWithoutOrg) return <>{children}</>;
  if (invitations.length > 0) return <Navigate to="/convite" replace />;

  // Sem empresa e sem convite: pode criar a própria (teste grátis) ou esperar um convite.
  return <CreateCompany onSignOut={() => void signOut()} />;
};
