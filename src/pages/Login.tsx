import { PLAN_KEY } from "./Planos";
import { translateError } from "@/lib/translateError";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { LogIn } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

const schema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "Senha deve ter ao menos 6 caracteres"),
  fullName: z.string().optional(),
});

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  // /login?modo=cadastro&plano=x (vindo da página de planos): já abre o cadastro e guarda o plano escolhido.
  const params = new URLSearchParams(window.location.search);
  const [mode, setMode] = useState<"signin" | "signup">(params.get("modo") === "cadastro" ? "signup" : "signin");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const plano = params.get("plano");
  if (plano) { try { localStorage.setItem(PLAN_KEY, plano); } catch { /* ok */ } }
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      schema.parse({ email, password, fullName });
      if (mode === "signup") {
        const { error, session } = await signUp(email, password, fullName);
        if (error) {
          toast({ variant: "destructive", title: "Erro no cadastro", description: translateError(error) });
        } else if (!session) {
          // Confirmação de e-mail ligada: só entra depois de clicar no link.
          setSentTo(email);
        } else {
          toast({ title: "Conta criada!" });
          navigate("/inicio");
        }
      } else {
        const { error } = await signIn(email, password);
        if (error) {
          toast({ variant: "destructive", title: "Erro ao entrar", description: translateError(error) });
        } else {
          navigate("/");
        }
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast({ variant: "destructive", title: "Erro", description: translateError(error.errors[0].message) });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm space-y-8 animate-fade-in">
        <div className="text-center space-y-2 flex flex-col items-center">
          <Logo width={110} height={46} />
        </div>

        <div className="rounded-2xl border-2 border-primary/40 p-6 space-y-5 bg-card">
          <div className="text-center">
            <span className="text-sm font-bold text-primary-text uppercase tracking-wide">
              {mode === "signin" ? "Entrar" : "Criar conta"}
            </span>
          </div>

          {sentTo ? (
            <div className="space-y-3 text-center text-sm">
              <p className="font-medium">Confirme o seu e-mail</p>
              <p className="text-muted-foreground">
                Enviamos um link para <b>{sentTo}</b>. Clique nele e depois entre por aqui para criar a sua empresa e
                começar o teste grátis. Não chegou? Olhe a caixa de spam.
              </p>
              <Button variant="outline" className="w-full" onClick={() => { setSentTo(null); setMode("signin"); }}>Já confirmei, quero entrar</Button>
            </div>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Nome completo</Label>
                <Input
                  id="fullName"
                  type="text"
                  placeholder="Seu nome"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <span>Aguarde...</span>
              ) : (
                <span className="inline-flex items-center">
                  <LogIn className="mr-2 h-4 w-4" />
                  {mode === "signin" ? "Entrar" : "Criar conta"}
                </span>
              )}
            </Button>
          </form>
          )}

          <div className="text-center">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            >
              {mode === "signin" ? "Não tem conta? Cadastre-se" : "Já tem conta? Entrar"}
            </Button>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          <Link to="/planos" className="underline">Conheça os planos</Link> · © 2026 Clubetec
        </p>
      </div>
    </div>
  );
};

export default Login;
