import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { Logo } from "@/components/Logo";
import { MainNav } from "@/components/MainNav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { MfaEnroll, useMfa } from "@/components/Mfa";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

/** Segurança da conta: verificação em duas etapas e exigência para donos/admins. */
export default function Seguranca() {
  const { signOut } = useAuth();
  const { org, can } = useOrg();
  const { toast } = useToast();
  const navigate = useNavigate();
  const mfa = useMfa();
  const [enrolling, setEnrolling] = useState(false);
  const [required, setRequired] = useState<boolean | null>(null);

  const loadOrg = useCallback(async () => {
    if (!org) return;
    const { data } = await supabase.from("organizations").select("settings").eq("id", org.id).maybeSingle();
    setRequired(((data?.settings ?? {}) as Record<string, unknown>).require_mfa === true);
  }, [org]);
  useEffect(() => { void loadOrg(); }, [loadOrg]);

  if (enrolling) return <MfaEnroll onDone={() => { toast({ title: "Verificação em duas etapas ativada" }); window.location.reload(); }} />;

  const remove = async () => {
    if (!window.confirm("Desativar a verificação em duas etapas? A conta fica protegida só pela senha.")) return;
    const { data } = await supabase.auth.mfa.listFactors();
    for (const f of data?.all ?? []) {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id });
      if (error) return toast({ variant: "destructive", title: "Não foi possível desativar", description: "Entre de novo com o código e tente outra vez." });
    }
    toast({ title: "Verificação em duas etapas desativada" });
    window.location.reload();
  };
  const toggleRequired = async (v: boolean) => {
    if (!org) return;
    const { error } = await supabase.rpc("set_require_mfa", { org: org.id, required: v });
    if (error) return toast({ variant: "destructive", title: "Não foi possível", description: error.message });
    setRequired(v);
    toast({ title: v ? "Agora donos e administradores precisam do código no login" : "Exigência desligada" });
  };

  const on = !!mfa.status?.enrolled;
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b px-4 h-14 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Logo horizontal width={26} height={26} />
          <MainNav active="seguranca" />
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" size="icon" title="Sair" onClick={async () => { await signOut(); navigate("/login"); }}><LogOut className="w-4 h-4" /></Button>
        </div>
      </header>
      <main className="flex-1 w-full max-w-2xl mx-auto p-4 sm:p-6 space-y-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2"><ShieldCheck className="w-6 h-6" /> Segurança</h1>

        <section className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-medium">Verificação em duas etapas</p>
            {on ? <Badge>Ativada</Badge> : <Badge variant="outline">Desativada</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            Além da senha, o login pede um código do aplicativo autenticador do seu celular. Mesmo que a senha vaze, ninguém entra sem o celular.
          </p>
          {on ? (
            <Button variant="outline" onClick={remove} disabled={mfa.status?.required}>
              {mfa.status?.required ? "Obrigatória para você (não dá para desativar)" : "Desativar"}
            </Button>
          ) : (
            <Button onClick={() => setEnrolling(true)}>Ativar agora</Button>
          )}
        </section>

        {can("org.settings") && required !== null && (
          <section className="rounded-lg border p-4 space-y-2">
            <label className="flex items-start gap-3">
              <Switch checked={required} onCheckedChange={toggleRequired} disabled={!on && !required} />
              <span className="text-sm">
                <b>Exigir de donos e administradores desta empresa.</b> Quem ainda não ativou vai ser levado a ativar no próximo acesso.
                {!on && !required && <span className="block text-muted-foreground">Ative na sua conta primeiro.</span>}
              </span>
            </label>
          </section>
        )}
      </main>
    </div>
  );
}
