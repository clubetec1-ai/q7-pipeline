import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/Logo";
import { useToast } from "@/hooks/use-toast";

const ROLE_LABEL: Record<string, string> = {
  owner: "Dono",
  admin: "Administrador",
  supervisor: "Supervisor",
  agent: "Atendente",
};

/**
 * Chegada de um convite: quem foi convidado por e-mail cria a senha e aceita;
 * quem já tinha conta só aceita.
 */
export default function Convite() {
  const { user, signOut } = useAuth();
  const { invitations, orgs, reload } = useOrg();
  const navigate = useNavigate();
  const { toast } = useToast();
  const needsPassword = !!user?.invited_at && !user?.user_metadata?.password_set;
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);

  const savePassword = async () => {
    if (password.length < 8) {
      toast({ variant: "destructive", title: "A senha precisa ter pelo menos 8 caracteres" });
      return;
    }
    if (password !== confirm) {
      toast({ variant: "destructive", title: "As senhas não conferem" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password, data: { password_set: true } });
    setSaving(false);
    if (error) {
      toast({ variant: "destructive", title: "Não foi possível salvar a senha", description: error.message });
      return;
    }
    toast({ title: "Senha criada!" });
  };

  const accept = async (orgId: string) => {
    setAccepting(orgId);
    const { data, error } = await supabase.rpc("accept_invitation", { org: orgId });
    setAccepting(null);
    if (error || !data) {
      toast({ variant: "destructive", title: "Não foi possível aceitar o convite" });
      return;
    }
    await reload();
    navigate("/", { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <Logo horizontal width={32} height={32} />
        </div>

        {needsPassword && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Crie sua senha</CardTitle>
              <CardDescription>Você vai usar esta senha para entrar no ClubeCRM com o e-mail {user?.email}.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="senha">Senha</Label>
                <Input id="senha" type="password" autoComplete="new-password" value={password}
                  onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirma">Confirme a senha</Label>
                <Input id="confirma" type="password" autoComplete="new-password" value={confirm}
                  onChange={(e) => setConfirm(e.target.value)} />
              </div>
              <Button className="w-full" onClick={savePassword} disabled={saving}>
                {saving ? "Salvando..." : "Salvar senha"}
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Convites</CardTitle>
            <CardDescription>
              {invitations.length ? "Aceite para entrar na equipe." : "Não há convites pendentes para você."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {invitations.map((inv) => (
              <div key={inv.organization_id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div>
                  <p className="font-medium">{inv.organization_name}</p>
                  <p className="text-xs text-muted-foreground">Como {ROLE_LABEL[inv.role] ?? inv.role}</p>
                </div>
                <Button size="sm" onClick={() => accept(inv.organization_id)}
                  disabled={accepting === inv.organization_id || (needsPassword)}>
                  {accepting === inv.organization_id ? "Entrando..." : "Aceitar"}
                </Button>
              </div>
            ))}
            {needsPassword && invitations.length > 0 && (
              <p className="text-xs text-muted-foreground">Crie sua senha acima para poder aceitar.</p>
            )}
            <div className="flex justify-between pt-2">
              {orgs.length > 0 ? (
                <Button variant="ghost" size="sm" onClick={() => navigate("/")}>Ir para o ClubeCRM</Button>
              ) : <span />}
              <Button variant="ghost" size="sm" onClick={() => signOut()}>Sair</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
