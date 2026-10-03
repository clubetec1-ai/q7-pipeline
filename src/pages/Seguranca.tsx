import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
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
import { callFunction } from "@/lib/callFunction";

/** Segurança da conta: verificação em duas etapas e exigência para donos/admins. */
export default function Seguranca() {
  const { signOut } = useAuth();
  const { org, can } = useOrg();
  const { toast } = useToast();
  const navigate = useNavigate();
  const mfa = useMfa();
  const [enrolling, setEnrolling] = useState(false);
  const [required, setRequired] = useState<boolean | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  useEffect(() => { void supabase.rpc("my_recovery_codes_left").then(({ data }) => setLeft((data as number | null) ?? 0)); }, [codes]);

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
    await callFunction("mfa-recovery", { action: "notify_disabled" });
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

  const generate = async () => {
    if (left && !window.confirm("Gerar códigos novos? Os anteriores param de funcionar.")) return;
    const r = await callFunction<{ codes: string[] }>("mfa-recovery", { action: "generate" });
    if (!r.ok) return toast({ variant: "destructive", title: r.message });
    setCodes(r.data.codes);
  };
  const download = () => {
    const txt = `Deixa com a IA — códigos de recuperação (cada um funciona uma vez)\n\n${codes!.join("\n")}\n\nGuarde em lugar seguro, longe do celular.\n`;
    const url = URL.createObjectURL(new Blob([txt], { type: "text/plain" }));
    Object.assign(document.createElement("a"), { href: url, download: "clubecrm-codigos-recuperacao.txt" }).click();
    URL.revokeObjectURL(url);
  };

  const on = !!mfa.status?.enrolled;
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="seguranca" />
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

        {on && (
          <section className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">Códigos de recuperação</p>
              {left !== null && <Badge variant={left ? "secondary" : "destructive"}>{left} disponíveis</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              Se perder o celular, um destes códigos deixa você entrar e cadastrar o celular novo. Cada código funciona uma vez.
            </p>
            {codes ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Guarde agora: eles não aparecem de novo.</p>
                <div className="grid grid-cols-2 gap-1 font-mono text-sm rounded-md bg-muted p-3 select-all">
                  {codes.map((c) => <span key={c}>{c}</span>)}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={download}>Baixar .txt</Button>
                  <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(codes.join("\n")); toast({ title: "Códigos copiados" }); }}>Copiar</Button>
                  <Button size="sm" onClick={() => setCodes(null)}>Já guardei</Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" onClick={generate}>{left ? "Gerar novos códigos" : "Gerar códigos"}</Button>
            )}
          </section>
        )}

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
