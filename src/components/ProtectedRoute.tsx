import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { Button } from "@/components/ui/button";
import { NamePrompt } from "@/components/NamePrompt";

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

  if (loading || (user && orgLoading)) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (allowWithoutOrg || orgs.length > 0) return <>{children}{orgs.length > 0 && <NamePrompt />}</>;
  if (invitations.length > 0) return <Navigate to="/convite" replace />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-sm text-center space-y-4">
        <h1 className="text-xl font-semibold">Você ainda não faz parte de nenhuma equipe</h1>
        <p className="text-sm text-muted-foreground">
          Peça ao responsável pela sua empresa para enviar um convite para o seu e-mail. Assim que
          ele chegar, entre de novo por aqui.
        </p>
        <Button variant="outline" onClick={() => signOut()}>
          Sair
        </Button>
      </div>
    </div>
  );
};
