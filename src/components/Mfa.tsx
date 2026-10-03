import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { callFunction } from "@/lib/callFunction";

export interface MfaStatus { enrolled: boolean; required: boolean; aal2: boolean }

/** Situação do MFA de quem está logado (nível da sessão + exigência das empresas). */
export function useMfa() {
  const { user } = useAuth();
  const [state, setState] = useState<{ loading: boolean; needsCode: boolean; status: MfaStatus | null }>({ loading: true, needsCode: false, status: null });
  const reload = useCallback(async () => {
    if (!user) return setState({ loading: false, needsCode: false, status: null });
    const [{ data: aal }, { data: st }] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.rpc("my_mfa_status"),
    ]);
    setState({
      loading: false,
      needsCode: aal?.currentLevel === "aal1" && aal?.nextLevel === "aal2",
      status: (st as unknown as MfaStatus | null) ?? null,
    });
  }, [user]);
  useEffect(() => { void reload(); }, [reload]);
  return { ...state, reload };
}

/** Digitar o código do aplicativo autenticador depois da senha. */
export function MfaChallenge({ onDone }: { onDone: () => void }) {
  const { signOut } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState(false);
  // Perdeu o celular: um código de recuperação remove o autenticador antigo.
  const redeem = async () => {
    setBusy(true);
    setError(null);
    const r = await callFunction("mfa-recovery", { action: "redeem", code });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    onDone();
  };
  if (recovery) {
    return (
      <Shell title="Código de recuperação" text="Digite um dos códigos de recuperação que você guardou ao ativar a verificação. Ele remove o aplicativo do celular antigo; depois você cadastra o novo em Segurança.">
        <Input placeholder="XXXXX-XXXXX" value={code} autoFocus maxLength={11} autoComplete="off"
          onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && code.replace(/[^A-Z0-9]/g, "").length === 10 && redeem()} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button className="w-full" disabled={busy || code.replace(/[^A-Z0-9]/g, "").length !== 10} onClick={redeem}>{busy ? "Conferindo..." : "Usar código"}</Button>
        <Button variant="ghost" className="w-full" onClick={() => { setRecovery(false); setCode(""); setError(null); }}>Voltar</Button>
      </Shell>
    );
  }
  const verify = async () => {
    setBusy(true);
    setError(null);
    const { data } = await supabase.auth.mfa.listFactors();
    const factor = data?.totp?.find((f) => f.status === "verified");
    if (!factor) { setBusy(false); return setError("Nenhum aplicativo autenticador ativado nesta conta."); }
    const { error: e } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
    setBusy(false);
    if (e) return setError("Código inválido ou vencido. Confira o relógio do celular e tente o código novo.");
    onDone();
  };
  return (
    <Shell title="Verificação em duas etapas" text="Digite o código de 6 números que aparece no seu aplicativo autenticador (Google Authenticator, Microsoft Authenticator ou similar).">
      <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={code} autoFocus
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && code.length === 6 && verify()} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button className="w-full" disabled={busy || code.length !== 6} onClick={verify}>{busy ? "Conferindo..." : "Entrar"}</Button>
      <button type="button" className="text-xs text-muted-foreground underline" onClick={() => { setRecovery(true); setCode(""); setError(null); }}>
        Perdi o celular — usar código de recuperação
      </button>
      <Button variant="ghost" className="w-full" onClick={() => signOut()}>Sair</Button>
    </Shell>
  );
}

/** Ativar: QR code no aplicativo autenticador + primeiro código. */
export function MfaEnroll({ onDone, mandatory = false }: { onDone: () => void; mandatory?: boolean }) {
  const { signOut } = useAuth();
  const [factor, setFactor] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    setError(null);
    // Tentativas anteriores não concluídas atrapalham um novo cadastro.
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of list?.all ?? []) if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error: e } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Deixa com a IA ${new Date().toLocaleDateString("pt-BR")}` });
    setBusy(false);
    if (e || !data) return setError("Não foi possível começar. Tente de novo.");
    setFactor({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  };
  const verify = async () => {
    if (!factor) return;
    setBusy(true);
    setError(null);
    const { error: e } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
    setBusy(false);
    if (e) return setError("Código inválido. Confira o relógio do celular e digite o código novo.");
    onDone();
  };

  return (
    <Shell title="Ative a verificação em duas etapas"
      text={mandatory ? "Sua empresa exige um segundo passo no login para donos e administradores. Leva 1 minuto." : "Além da senha, o login pede um código do seu celular. Protege a empresa mesmo se a senha vazar."}>
      {!factor ? (
        <>
          <ol className="list-decimal pl-5 text-sm space-y-1 text-left">
            <li>Instale no celular um aplicativo autenticador (Google Authenticator, Microsoft Authenticator ou Authy).</li>
            <li>Clique em “Começar” e leia o QR code com o aplicativo.</li>
            <li>Digite o código de 6 números que aparecer.</li>
          </ol>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" disabled={busy} onClick={start}>{busy ? "Preparando..." : "Começar"}</Button>
        </>
      ) : (
        <>
          <img src={factor.qr} alt="QR code para o aplicativo autenticador" className="mx-auto w-48 h-48 bg-white rounded p-2" />
          <p className="text-xs text-muted-foreground break-all">Sem câmera? Digite a chave no aplicativo: <code className="select-all">{factor.secret}</code></p>
          <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={code} autoFocus
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && code.length === 6 && verify()} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" disabled={busy || code.length !== 6} onClick={verify}>{busy ? "Conferindo..." : "Ativar"}</Button>
        </>
      )}
      {mandatory && <Button variant="ghost" className="w-full" onClick={() => signOut()}>Sair</Button>}
    </Shell>
  );
}

function Shell({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-4 text-center">
        <ShieldCheck className="w-10 h-10 mx-auto text-primary-text" />
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{text}</p>
        {children}
      </div>
    </div>
  );
}
