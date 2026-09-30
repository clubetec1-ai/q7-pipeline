import { Link, Navigate } from "react-router-dom";
import {
  Bot, BookOpen, KeyRound, Library, Mail, MessageSquare, PhoneCall, Plug, Server, Settings2, ShieldCheck, Shuffle, Tags, Wallet, Workflow, type LucideIcon,
} from "lucide-react";
import { useOrg } from "@/contexts/OrgContext";
import { AppHeader } from "@/components/AppHeader";
import { NumberHealthBanner } from "@/components/NumberHealthBanner";
import { useSetupStatus } from "@/lib/useSetupStatus";

type State = "ok" | "pending" | "optional";
interface Card { title: string; desc: string; to: string; icon: LucideIcon; color: string; state: State; detail?: string; show: boolean }

const PILL: Record<State, [string, string]> = {
  ok: ["✓ Configurado", "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"],
  pending: ["Pendente", "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"],
  optional: ["Opcional", "bg-muted text-muted-foreground"],
};

/**
 * Central de Configurações: tudo que é instalação num lugar só, em cartões com a
 * situação (configurado / pendente / opcional). Cada cartão abre a tela certa.
 */
export default function Configuracoes() {
  const { org, can, isOperator, hasModule } = useOrg();
  const { status: s } = useSetupStatus(org?.id);
  if (!org) return null;
  const manage = can("org.settings");
  const lib = can("library.manage");
  const team = can("members.manage") || can("departments.manage");
  if (!manage && !lib && !team && !isOperator) return <Navigate to="/" replace />;

  const groups: { title: string; cards: Card[] }[] = [
    { title: "Canais", cards: [
      { title: "WhatsApp", desc: "Conectar números (QR ou oficial da Meta), cor e saúde de cada número.", to: "/numeros", icon: MessageSquare, color: "#10B981",
        state: s.whatsappOnline ? "ok" : "pending", detail: s.whatsapp ? `${s.whatsappOnline} de ${s.whatsapp} conectado(s)` : "Nenhum número", show: manage },
      { title: "E-mail", desc: "Caixas de e-mail atendidas na mesma tela das conversas.", to: "/numeros", icon: Mail, color: "#6C8EF5",
        state: !s.email ? "optional" : s.emailNoDept ? "pending" : "ok",
        detail: s.email ? `${s.email} caixa(s)${s.emailNoDept ? ` · ${s.emailNoDept} sem setor (cai na Fila geral)` : ""}` : undefined, show: manage && hasModule("canais") },
      { title: "Telefonia e ramais", desc: "Ramal de cada atendente, MicroSIP ou navegador, e a integração Nvoip.", to: "/equipe?tab=ramais", icon: PhoneCall, color: "#3FB8BE",
        state: s.ramais ? "ok" : "optional", detail: s.ramais ? `${s.ramais} ramal(is)${s.nvoip ? " · Nvoip ativa" : ""}` : undefined, show: team && hasModule("telefonia") },
    ] },
    { title: "Atendimento", cards: [
      { title: "Distribuição e saudação", desc: "Setores, fila, quem recebe cada atendimento e a mensagem ao assumir.", to: "/equipe?tab=departamentos", icon: Shuffle, color: "#F59E0B",
        state: s.departments ? "ok" : "pending", detail: s.departments ? `${s.departments} setor(es) · ${s.members} pessoa(s)` : "Nenhum setor", show: team },
      { title: "Etiquetas e grupos", desc: "Etiquetas por setor, grupos de clientes, cores e ícones.", to: "/etiquetas", icon: Tags, color: "#EC4899",
        state: s.tagScopes || s.groups ? "ok" : "pending", detail: `${s.tags} etiqueta(s) · ${s.groups} grupo(s)`, show: lib || can("contacts.groups_manage") },
      { title: "Biblioteca e respostas", desc: "Arquivos e textos prontos para enviar no atendimento.", to: "/biblioteca", icon: Library, color: "#8B5CF6",
        state: s.library ? "ok" : "optional", detail: s.library ? `${s.library} arquivo(s)` : undefined, show: lib },
    ] },
    { title: "IA e automação", cards: [
      { title: "Chaves de IA", desc: "Chave de cada provedor (guardada no cofre, nunca aparece de novo), provedor padrão e leitura de imagens/PDF.",
        to: "/configuracoes/ia", icon: KeyRound, color: "#8B5CF6", state: s.aiKeys ? "ok" : "pending",
        detail: s.aiKeys ? `${s.aiKeys} provedor(es) com chave` : "Nenhuma chave", show: manage && hasModule("ia") },
      { title: "Agente de IA e follow-up", desc: "Ligar a IA, como ela se comporta, follow-up automático e teste.", to: "/agente", icon: Bot, color: "#6C8EF5",
        state: s.aiOn ? "ok" : "pending", detail: s.aiOn ? "Agente ligado" : "Agente desligado", show: manage && hasModule("ia") },
      { title: "Fluxos", desc: "Menus, triagem, horários e automações sem código.", to: "/fluxos", icon: Workflow, color: "#3FB8BE",
        state: s.flowsLive ? "ok" : "pending", detail: s.flowsLive ? `${s.flowsLive} publicado(s)` : "Nenhum publicado", show: manage && hasModule("ia") },
      { title: "Base de conhecimento", desc: "Documentos que a IA e a equipe consultam para responder.", to: "/conhecimento", icon: BookOpen, color: "#10B981",
        state: s.knowledge ? "ok" : "optional", detail: s.knowledge ? `${s.knowledge} documento(s)` : undefined, show: (manage || lib) && hasModule("ia") },
    ] },
    { title: "Integrações e conta", cards: [
      { title: "Cobranças (Asaas)", desc: "Chave de API do Asaas, ambiente e regras: quem pode cobrar, aviso de pagamento e lembretes.", to: "/configuracoes/cobrancas",
        icon: Wallet, color: "#10B981", state: s.payments ? "ok" : "optional", detail: s.payments ? "Asaas conectado" : undefined, show: manage && hasModule("cobrancas") },
      { title: "Integrações", desc: "Conectar outros sistemas (ERP, cobrança, agenda) para a IA e os fluxos.", to: "/integracoes", icon: Plug, color: "#64748B",
        state: s.integrations ? "ok" : "optional", detail: s.integrations ? `${s.integrations} integração(ões)` : undefined, show: manage },
      { title: "Uazapi — servidor global (Clubetec)", desc: "Servidor e token de administrador do WhatsApp por QR de toda a plataforma. Só a equipe Clubetec vê.",
        to: "/admin/uazapi", icon: Server, color: "#0EA5E9", state: "optional", show: isOperator },
      { title: "Segurança", desc: "Verificação em duas etapas (MFA) e códigos de recuperação.", to: "/seguranca", icon: ShieldCheck, color: "#EF4444",
        state: "optional", show: true },
    ] },
  ];
  const all = groups.flatMap((g) => g.cards).filter((c) => c.show && c.state !== "optional");
  const done = all.filter((c) => c.state === "ok").length;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="configuracoes" />
      <NumberHealthBanner />
      <main className="flex-1 w-full max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2"><Settings2 className="w-6 h-6" /> Configurações</h1>
            <p className="text-sm text-muted-foreground">Tudo que é instalação da {org.name} está aqui. Comece pelos pendentes.</p>
          </div>
          {all.length > 0 && (
            <div className="min-w-[12rem]">
              <p className="text-xs text-muted-foreground mb-1">{done} de {all.length} essenciais prontos</p>
              <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${(done / all.length) * 100}%` }} /></div>
            </div>
          )}
        </div>

        {groups.map((g) => {
          const cards = g.cards.filter((c) => c.show);
          if (!cards.length) return null;
          return (
            <section key={g.title} className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{g.title}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {cards.map((c) => (
                  <Link key={c.title} to={c.to}
                    className="group rounded-xl border bg-card p-4 flex gap-3 hover:shadow-md hover:-translate-y-0.5 transition">
                    <span className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${c.color}22`, color: c.color }}>
                      <c.icon className="w-5 h-5" />
                    </span>
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium">{c.title}</span>
                        <span className={`text-[11px] rounded-full px-2 py-0.5 whitespace-nowrap ${PILL[c.state][1]}`}>{PILL[c.state][0]}</span>
                      </span>
                      <span className="block text-xs text-muted-foreground">{c.desc}</span>
                      {c.detail && <span className="block text-xs">{c.detail}</span>}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}
