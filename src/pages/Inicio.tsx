import { Link } from "react-router-dom";
import {
  Bot, BookOpen, Check, ClipboardList, Clock, Layers, Mail, MessageSquare, MessagesSquare, Palette, PartyPopper, Settings2, Tags, Target, Trello, User, Users, Workflow,
  type LucideIcon,
} from "lucide-react";
import { useOrg } from "@/contexts/OrgContext";
import { AppHeader } from "@/components/AppHeader";
import { NumberHealthBanner } from "@/components/NumberHealthBanner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useSetupStatus } from "@/lib/useSetupStatus";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { OrgHealth } from "@/components/OrgHealth";

interface Step { title: string; why: string; to: string; icon: LucideIcon; done: boolean; detail?: string; later?: boolean }

/**
 * Início: para quem configura a empresa, os "Primeiros passos" em ordem, com
 * progresso e um botão para cada passo (o sistema guia; ninguém precisa ligar
 * para o suporte). Para todos, atalhos do dia a dia.
 */
export default function Inicio() {
  const { org, can, hasModule } = useOrg();
  const { status: s, loading, reload } = useSetupStatus(org?.id);
  const { toast } = useToast();
  if (!org) return null;
  const manage = can("org.settings");
  const solo = s.teamMode === "solo";
  // Sozinho ou com equipe: muda os Primeiros passos (dá para trocar quando quiser).
  const setTeamMode = async (mode: "solo" | "equipe") => {
    const { data } = await supabase.from("organizations").select("settings").eq("id", org.id).maybeSingle();
    const next = { ...((data?.settings ?? {}) as Record<string, unknown>), team_mode: mode };
    const { error } = await supabase.from("organizations").update({ settings: next as never }).eq("id", org.id);
    if (error) return toast({ variant: "destructive", title: "Sem permissão" });
    void reload();
  };

  // Ordem do dono: canal → empresa → IA → equipe. O resto fica em "Para depois" (não conta no progresso).
  const all: (Step & { m?: Parameters<typeof hasModule>[0] })[] = [
    { title: "Conectar o WhatsApp", why: "O número onde os clientes falam com você. Leva 2 minutos com o QR Code.", to: "/numeros", icon: MessageSquare, done: s.whatsappOnline > 0 },
    { title: "Contar sobre a empresa", why: "Serviços, regras e o jeito de falar: a IA passa a entender o seu negócio.", to: "/diagnostico", icon: Target, m: "diagnostico",
      done: s.diagApproved >= 1, detail: s.diagApproved ? `${s.diagApproved} etapa(s) aprovada(s)` : undefined },
    { title: "Horário de atendimento", why: "Quando a empresa atende; fora dele, o cliente recebe o aviso de fechado.", to: "/configuracoes/atendimento", icon: Clock, done: s.hours },
    { title: "Ligar o assistente de IA", why: "Teste com uma pergunta e ligue: a IA responde na hora e passa para uma pessoa quando precisa.", to: "/agente", icon: Bot, m: "ia", done: s.aiOn > 0 },
    ...(solo ? [] : [{ title: "Convidar a equipe e criar os setores", why: "Quem atende o quê: cada setor com sua fila e sua cor.", to: "/equipe", icon: Layers,
      done: s.departments > 0 && s.members > 1, detail: `${s.departments} setor(es) · ${s.members} pessoa(s)` }]),
    { title: "Conectar o e-mail", why: "Opcional: atender os e-mails na mesma tela das conversas.", to: "/numeros", icon: Mail, m: "canais", done: s.email > 0, later: true },
    { title: "Logo e cores", why: "O logo e as cores da sua empresa nas telas da equipe.", to: "/configuracoes/aparencia", icon: Palette, done: s.brand, later: true },
    { title: "Documentos para a IA", why: "Tabelas, regras e perguntas frequentes para a IA responder com segurança.", to: "/conhecimento", icon: BookOpen, m: "ia", done: s.knowledge > 0, later: true },
    { title: "Etiquetas", why: "Sinalizam o cliente com cores (VIP, Urgente, Suporte…).", to: "/etiquetas", icon: Tags, done: s.tags > 0 || s.groups > 0, later: true },
    { title: "Menu automático (fluxo)", why: "Menu de entrada, horário e triagem automáticos.", to: "/fluxos", icon: Workflow, m: "ia", done: s.flowsLive > 0, later: true },
    { title: "Plano de implementação", why: "Escolha o que implementar agora e o que fica para depois, com lembrete.", to: "/setores", icon: ClipboardList, m: "diagnostico",
      done: s.planned > 0, detail: s.processes ? `${s.planned} de ${s.processes} processo(s) decidido(s)` : undefined, later: true },
  ];
  const available: Step[] = all.filter((x) => !x.m || hasModule(x.m));
  const steps = available.filter((x) => !x.later);
  const later = available.filter((x) => x.later);
  const done = steps.filter((x) => x.done).length;
  const next = steps.find((x) => !x.done);
  const shortcuts: { label: string; to: string; icon: LucideIcon; show: boolean }[] = [
    { label: "Conversas", to: "/", icon: MessageSquare, show: true },
    { label: "Funil", to: "/kanban", icon: Trello, show: true },
    { label: "Equipe (chat)", to: "/chat", icon: MessagesSquare, show: true },
    { label: "Configurações", to: "/configuracoes", icon: Settings2, show: manage },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="inicio" />
      <NumberHealthBanner />
      <main className="flex-1 w-full max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Olá! 👋</h1>
          <p className="text-sm text-muted-foreground">{org.name}</p>
        </div>

        {manage && <OrgHealth orgId={org.id} />}

        {manage && !loading && s.teamMode === null && (
          <section className="rounded-xl border-2 border-primary bg-card p-5 space-y-3">
            <div>
              <h2 className="font-semibold text-lg">Como vai ser o atendimento?</h2>
              <p className="text-sm text-muted-foreground">Assim mostramos só os passos que fazem sentido para você. Dá para trocar depois.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => void setTeamMode("solo")} className="text-left rounded-lg border p-4 hover:border-primary hover:bg-primary/5">
                <User className="w-5 h-5 mb-2 text-primary-text" />
                <span className="block font-medium">Só eu, pelo WhatsApp</span>
                <span className="block text-xs text-muted-foreground">A IA atende e passa para você quando precisar. Sem setores nem equipe.</span>
              </button>
              <button type="button" onClick={() => void setTeamMode("equipe")} className="text-left rounded-lg border p-4 hover:border-primary hover:bg-primary/5">
                <Users className="w-5 h-5 mb-2 text-primary-text" />
                <span className="block font-medium">Eu e uma equipe</span>
                <span className="block text-xs text-muted-foreground">Setores com fila e cor, distribuição dos atendimentos e convite das pessoas.</span>
              </button>
            </div>
          </section>
        )}

        {manage && !loading && s.teamMode !== null && (
          done < steps.length ? (
            <section className="rounded-xl border bg-card p-5 space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-lg">Primeiros passos</h2>
                  <p className="text-sm text-muted-foreground">Siga na ordem: cada passo abre a tela certa e explica o que fazer.</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Atendimento: {solo ? "só você" : "com equipe"} ·{" "}
                    <button type="button" className="underline" onClick={() => void setTeamMode(solo ? "equipe" : "solo")}>trocar para {solo ? "com equipe" : "só você"}</button>
                  </p>
                </div>
                <div className="min-w-[12rem]">
                  <p className="text-xs text-muted-foreground mb-1">{done} de {steps.length} concluídos</p>
                  <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${(done / steps.length) * 100}%` }} /></div>
                </div>
              </div>
              <ol className="space-y-2">
                {steps.map((st, i) => {
                  const isNext = st === next;
                  return (
                    <li key={st.title} className={`flex items-center gap-3 rounded-lg border p-3 ${isNext ? "border-primary bg-primary/5" : ""}`}>
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-semibold ${st.done ? "bg-success text-white dark:text-background" : isNext ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                        {st.done ? <Check className="w-4 h-4" /> : i + 1}
                      </span>
                      <st.icon className="w-4 h-4 text-muted-foreground shrink-0 hidden sm:block" />
                      <span className="flex-1 min-w-0">
                        <span className={`block text-sm font-medium ${st.done ? "text-muted-foreground" : ""}`}>{st.title}</span>
                        <span className="block text-xs text-muted-foreground">{st.why}{st.detail ? ` · ${st.detail}` : ""}</span>
                      </span>
                      <Button asChild size="sm" variant={isNext ? "default" : "ghost"}><Link to={st.to}>{st.done ? "Revisar" : isNext ? "Começar" : "Abrir"}</Link></Button>
                    </li>
                  );
                })}
              </ol>
              {later.length > 0 && (
                <details className="rounded-lg border p-3">
                  <summary className="text-sm font-medium cursor-pointer">Para depois ({later.filter((x) => x.done).length} de {later.length})</summary>
                  <ul className="mt-2 space-y-1">
                    {later.map((st) => (
                      <li key={st.title} className="flex items-center gap-3 text-sm py-1">
                        {st.done ? <Check className="w-4 h-4 text-success shrink-0" /> : <st.icon className="w-4 h-4 text-muted-foreground shrink-0" />}
                        <span className="flex-1 min-w-0"><span className="font-medium">{st.title}</span> <span className="text-xs text-muted-foreground">· {st.why}</span></span>
                        <Button asChild size="sm" variant="ghost"><Link to={st.to}>{st.done ? "Revisar" : "Abrir"}</Link></Button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          ) : (
            <section className="rounded-xl border bg-card p-5 flex items-center gap-3">
              <PartyPopper className="w-6 h-6 text-primary-text" />
              <div className="text-sm"><b>Tudo pronto!</b> A empresa está configurada. Acompanhe o dia a dia em Conversas e os resultados em Relatórios.</div>
            </section>
          )
        )}

        <Dashboard orgId={org.id} />

        <section className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          {shortcuts.filter((x) => x.show).map((x) => (
            <Link key={x.to} to={x.to} className="rounded-xl border bg-card p-4 flex flex-col items-center gap-2 hover:shadow-md hover:-translate-y-0.5 transition">
              <x.icon className="w-6 h-6 text-primary-text" />
              <span className="text-sm font-medium">{x.label}</span>
            </Link>
          ))}
        </section>
      </main>
    </div>
  );
}
