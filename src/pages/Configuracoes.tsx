import { Link, Navigate } from "react-router-dom";
import {
  Bot, BookOpen, LifeBuoy, Braces, Building2, Clock, Facebook, CreditCard, Filter, Network, KeyRound, Library, Mail, MessageSquare, Palette, PencilRuler, PhoneCall, Plug, Server, Settings2, Shuffle, Tags, Target, UsersRound, Wallet, Workflow, type LucideIcon,
} from "lucide-react";
import { useOrg } from "@/contexts/OrgContext";
import { AppHeader } from "@/components/AppHeader";
import { NumberHealthBanner } from "@/components/NumberHealthBanner";
import { useSetupStatus } from "@/lib/useSetupStatus";

type State = "ok" | "pending" | "optional";
interface Card { title: string; desc: string; to: string; icon: LucideIcon; color: string; state: State; detail?: string; show: boolean }

const PILL: Record<State, [string, string]> = {
  ok: ["✓ Configurado", "bg-success-soft text-success-text"],
  pending: ["Pendente", "bg-warning-soft text-warning-text"],
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
    { title: "1. Onde seus clientes falam com você", cards: [
      { title: "WhatsApp", desc: "Conectar o número pelo QR Code (ou o oficial da Meta) e ver se está funcionando.", to: "/numeros", icon: MessageSquare, color: "#10B981",
        state: s.whatsappOnline ? "ok" : "pending", detail: s.whatsapp ? `${s.whatsappOnline} de ${s.whatsapp} conectado(s)` : "Nenhum número", show: manage },
      { title: "E-mail", desc: "Caixas de e-mail atendidas na mesma tela das conversas.", to: "/numeros", icon: Mail, color: "#6C8EF5",
        state: !s.email ? "optional" : s.emailNoDept ? "pending" : "ok",
        detail: s.email ? `${s.email} caixa(s)${s.emailNoDept ? ` · ${s.emailNoDept} sem setor (cai na Fila geral)` : ""}` : undefined, show: manage && hasModule("canais") },
      { title: "Facebook e Instagram", desc: "Mensagens do Messenger e do Instagram Direct na mesma tela das conversas.", to: "/numeros", icon: Facebook, color: "#1877F2",
        state: "optional", show: manage && hasModule("canais") },
      { title: "Telefone", desc: "Ramal de cada atendente pelo navegador ou MicroSIP.", to: "/equipe?tab=ramais", icon: PhoneCall, color: "#3FB8BE",
        state: s.ramais ? "ok" : "optional", detail: s.ramais ? `${s.ramais} ramal(is)` : undefined, show: team && hasModule("telefonia") },
    ] },
    { title: "2. Sua empresa (o que a IA precisa saber)", cards: [
      { title: "Conte sobre a empresa", desc: "Diagnóstico guiado (por texto ou voz): serviços, regras, clientes e o jeito de falar.", to: "/diagnostico", icon: Target, color: "#22C1A4",
        state: s.diagApproved ? "ok" : "pending", detail: s.diagApproved ? `${s.diagApproved} etapa(s) aprovada(s)` : "Ainda não começou", show: manage && hasModule("diagnostico") },
      { title: "Processos desenhados", desc: "O Arquiteto (IA) transforma os processos do Diagnóstico em passo a passo: o que vira automático, IA ou fica com uma pessoa.",
        to: "/processos", icon: PencilRuler, color: "#0EA5E9", state: "optional", show: manage && hasModule("diagnostico") },
      { title: "Horário de atendimento", desc: "Dias e horas de atendimento. Fora deles, o cliente é avisado que está fechado.",
        to: "/configuracoes/atendimento", icon: Clock, color: "#0EA5E9", state: s.hours ? "ok" : "pending", detail: s.hours ? "Horário definido" : "Sem horário", show: manage },
      { title: "Documentos para a IA", desc: "Tabelas, regras e perguntas frequentes que a IA e a equipe consultam para responder.", to: "/conhecimento", icon: BookOpen, color: "#10B981",
        state: s.knowledge ? "ok" : "optional", detail: s.knowledge ? `${s.knowledge} documento(s)` : undefined, show: (manage || lib) && hasModule("ia") },
      { title: "Arquivos e respostas prontas", desc: "Arquivos e textos prontos para enviar no atendimento.", to: "/biblioteca", icon: Library, color: "#8B5CF6",
        state: s.library ? "ok" : "optional", detail: s.library ? `${s.library} arquivo(s)` : undefined, show: lib },
      { title: "Logo e cores", desc: "Logo da sua empresa no topo das telas e as cores principal e secundária.", to: "/configuracoes/aparencia",
        icon: Palette, color: "#22C1A4", state: "optional", show: manage },
    ] },
    { title: "3. Assistente de IA", cards: [
      { title: "Ligar e testar o assistente", desc: "Ligar a IA, como ela se comporta, teste e retomar conversas paradas.", to: "/agente", icon: Bot, color: "#6C8EF5",
        state: s.aiOn ? "ok" : "pending", detail: s.aiOn ? "Assistente ligado" : "Assistente desligado", show: manage && hasModule("ia") },
      { title: "Menus e respostas automáticas", desc: "Menus, triagem, horário e automações sem código (fluxos).", to: "/fluxos", icon: Workflow, color: "#3FB8BE",
        state: s.flowsLive ? "ok" : "optional", detail: s.flowsLive ? `${s.flowsLive} publicado(s)` : undefined, show: manage && hasModule("ia") },
      { title: "Avançado: chave de IA própria", desc: "Só se quiser usar sua própria conta de IA. Sem isso, a IA da Clubetec já está incluída.",
        to: "/configuracoes/ia", icon: KeyRound, color: "#64748B", state: s.aiKeys || s.platformAI ? "ok" : "pending",
        detail: s.aiKeys ? `${s.aiKeys} provedor(es) com chave` : s.platformAI ? "Usando a IA da Clubetec (incluída)" : "Nenhuma IA disponível", show: manage && hasModule("ia") },
    ] },
    { title: "4. Equipe", cards: [
      { title: "Áreas e responsáveis", desc: "Quem aprova as sugestões do cérebro em cada área (Vendas, Financeiro, Atendimento…).", to: "/configuracoes/areas",
        icon: Network, color: "#7C3AED", state: "optional", show: manage && hasModule("gestao") },
      { title: "Pessoas e convites", desc: "Convidar atendentes e definir o que cada um pode fazer.", to: "/equipe", icon: UsersRound, color: "#F59E0B",
        state: "optional", detail: `${s.members} pessoa(s)`, show: can("members.manage") },
      { title: "Setores e fila", desc: "Setores, fila e quem recebe cada atendimento. Saudação e protocolo na aba Mensagens.", to: "/equipe?tab=departamentos", icon: Shuffle, color: "#F59E0B",
        state: s.departments ? "ok" : "pending", detail: s.departments ? `${s.departments} setor(es)` : "Nenhum setor", show: team },
      { title: "Etiquetas e grupos de clientes", desc: "Etiquetas por setor, grupos de clientes, cores e ícones.", to: "/etiquetas", icon: Tags, color: "#EC4899",
        state: s.tags || s.groups ? "ok" : "optional", detail: `${s.tags} etiqueta(s) · ${s.groups} grupo(s)`, show: lib || can("contacts.groups_manage") },
    ] },
    { title: "5. Vendas e cobrança", cards: [
      { title: "Plano e assinatura", desc: "Seu plano, teste grátis, uso de IA do mês e pagamento da assinatura.", to: "/configuracoes/plano",
        icon: CreditCard, color: "#2563EB", state: "optional", show: can("org.billing") },
      { title: "Funil de vendas", desc: "Instalar o funil pronto, ver contatos por etapa e criar links de captação.", to: "/funil", icon: Filter, color: "#8B5CF6",
        state: "optional", show: manage },
      { title: "Cobranças (Asaas)", desc: "Conectar o Asaas e as regras de cobrança, aviso de pagamento e lembretes.", to: "/configuracoes/cobrancas",
        icon: Wallet, color: "#10B981", state: s.payments ? "ok" : "optional", detail: s.payments ? "Asaas conectado" : undefined, show: manage && hasModule("cobrancas") },
      { title: "Ligar com outros sistemas", desc: "Conectar outros sistemas para a IA e os fluxos consultarem.", to: "/integracoes", icon: Plug, color: "#64748B",
        state: s.integrations ? "ok" : "optional", detail: s.integrations ? `${s.integrations} integração(ões)` : undefined, show: manage },
      { title: "API e webhooks", desc: "Chaves para n8n, Make, Zapier ou o seu sistema, e avisos automáticos quando algo acontece.", to: "/configuracoes/api",
        icon: Braces, color: "#0F766E", state: "optional", show: manage },
      { title: "Rede de franquias", desc: "Entrar na rede da sua franquia com o código, ou — na matriz — ver as unidades e enviar o padrão.", to: "/configuracoes/rede",
        icon: Building2, color: "#9333EA", state: "optional", show: manage },
    ] },
    { title: "Ajuda e suporte", cards: [
      { title: "Suporte", desc: "Chamados da empresa com a equipe Clubetec: abrir, acompanhar e ver a resposta. Dúvidas do dia a dia: use a Ajuda (?) no topo.",
        to: "/configuracoes/suporte", icon: LifeBuoy, color: "#0EA5E9", state: "optional", show: manage },
    ] },
    { title: "Equipe Clubetec", cards: [
      { title: "Uazapi — servidor global", desc: "Servidor e token de administrador do WhatsApp por QR de toda a plataforma. Só a equipe Clubetec vê.",
        to: "/admin/uazapi", icon: Server, color: "#0EA5E9", state: "optional", show: isOperator },
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
            <h1 className="font-brand text-2xl leading-tight">Configurações</h1>
            <p className="text-sm text-muted-foreground">Tudo que é instalação da {org.name} está aqui. Comece pelos pendentes.</p>
          </div>
          {all.length > 0 && (
            <div className="min-w-[12rem]">
              <p className="text-xs text-muted-foreground mb-1">{done} de {all.length} essenciais prontos</p>
              <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-success transition-all" style={{ width: `${(done / all.length) * 100}%` }} /></div>
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
                        <span className={`text-xs rounded-full px-2 py-0.5 whitespace-nowrap ${PILL[c.state][1]}`}>{PILL[c.state][0]}</span>
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
