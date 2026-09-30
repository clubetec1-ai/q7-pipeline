import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { useOrg, type ModuleKey } from "@/contexts/OrgContext";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";

export const MODULE_INFO: Record<ModuleKey, { label: string; desc: string }> = {
  diagnostico: { label: "Diagnóstico e Plano", desc: "Entrevista guiada, marca, setores e processos, plano de implementação." },
  ia: { label: "Agentes de IA e Automação", desc: "IA que atende, fluxos, base de conhecimento e automações." },
  canais: { label: "Canais extras", desc: "Mais números de WhatsApp, número oficial da Meta e e-mail." },
  telefonia: { label: "Telefonia", desc: "Ramais, clique-para-ligar, histórico e ligações perdidas." },
  campanhas: { label: "Campanhas e Marca", desc: "Disparos para grupos de clientes e textos com a voz da marca." },
  cobrancas: { label: "Cobranças", desc: "Cobrança pelo WhatsApp com PIX, boleto e cartão (Asaas)." },
  gestao: { label: "Qualidade e Gestão", desc: "Avaliação automática dos atendimentos, supervisor e melhoria contínua." },
};

/**
 * Tela de um módulo não contratado: explica e leva de volta. A trava de verdade
 * é no banco e nas funções do servidor; isto só evita a pessoa cair numa tela vazia.
 */
export function ModuleGate({ m, children }: { m: ModuleKey; children: ReactNode }) {
  const { hasModule, org } = useOrg();
  if (!org || hasModule(m)) return <>{children}</>;
  const info = MODULE_INFO[m];
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="inicio" />
      <main className="flex-1 grid place-items-center p-6">
        <div className="max-w-md text-center space-y-3 rounded-xl border bg-card p-6">
          <Lock className="w-8 h-8 mx-auto text-muted-foreground" />
          <h1 className="text-xl font-semibold">Módulo {info.label}</h1>
          <p className="text-sm text-muted-foreground">{info.desc}</p>
          <p className="text-sm">Este módulo ainda não está ativo para a {org.name}. Fale com a Clubetec para ativar.</p>
          <Button asChild variant="outline"><Link to="/inicio">Voltar ao Início</Link></Button>
        </div>
      </main>
    </div>
  );
}
