import { Link } from "react-router-dom";
import {
  Bot, Check, ClipboardList, Clock, Layers, MessageSquare, MessagesSquare, Palette, PartyPopper, Settings2, Tags, Target, Trello, User, Users, Workflow,
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

interface Step { title: string; why: string; to: string; icon: LucideIcon; done: boolean; detail?: string }

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

  const all: (Step & { m?: Parameters<typeof hasModule>[0] })[] = [
    { title: "Diagnóstico da empresa", why: "A IA entende o seu negócio e monta o plano.", to: "/diagnostico", icon: Target, m: "diagnostico",
      done: s.diagApproved >= 1, detail: s.diagApproved ? `${s.diagApproved} etapa(s) aprovada(s)` : undefined },
    { title: "Marca", why: "Cores, logos e tom de voz — os agentes passam a escrever do seu jeito.", to: "/diagnostico?pagina=marca", icon: Palette, m: "diagnostico", done: s.brand },
    { title: "Conectar o WhatsApp", why: "O número onde os clientes falam com você.", to: "/numeros", icon: MessageSquare, done: s.whatsappOnline > 0 },
    { title: "Horário de atendimento", why: "Quando a empresa atende; fora dele, o cliente recebe o aviso de fechado.", to: "/configuracoes/atendimento", icon: Clock, done: s.hours },
    ...(solo ? [] : [{ title: "Setores e equipe", why: "Quem atende o quê: cada setor com sua fila e sua cor.", to: "/setores", icon: Layers,
      done: s.departments > 0 && s.members > 1, detail: `${s.departments} setor(es) · ${s.members} pessoa(s)` }]),
    { title: "Ligar o agente de IA", why: "A IA responde na hora e passa para uma pessoa quando precisa.", to: "/agente", icon: Bot, m: "ia", done: s.aiOn > 0 },
    { title: "Etiquetas por setor", why: "Sinalizam o cliente com cores (VIP, Urgente, Suporte…).", to: "/etiquetas", icon: Tags, done: s.tags > 0 || s.groups > 0 },
    { title: "Primeiro fluxo publicado", why: "Menu de entrada, horário e triagem automáticos.", to: "/fluxos", icon: Workflow, m: "ia", done: s.flowsLive > 0 },
    { title: "Plano de implementação", why: "Escolha o que implementar agora e o que fica para depois, com lembrete.", to: "/setores", icon: ClipboardList, m: "diagnostico",
      done: s.planned > 0, detail: s.processes ? `${s.planned} de ${s.processes} processo(s) decidido(s)` : undefined },
  ];
  const steps: Step[] = all.filter((x) => !x.m || hasModule(x.m));
  const done = steps.filter((x) => x.done).length;
  const next = steps.find((x) => !x.done);
  const shortcuts: { label: string; to: string; icon: LucideIcon; show: boolean }[] = [
    { label: "Conversas", to: "/", icon: MessageSquare, show: true },
    { label: "Kanban", to: "/kanban", icon: Trello, show: true },
    { label: "Chat", to: "/chat", icon: MessagesSquare, show: true },
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

        {manage && !loading && s.teamMode === null && (
          <section className="rounded-xl border-2 border-primary bg-card p-5 space-y-3">
            <div>
              <h2 className="font-semibold text-lg">Como vai ser o atendimento?</h2>
              <p className="text-sm text-muted-foreground">Assim mostramos só os passos que fazem sentido para você. Dá para trocar depois.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => void setTeamMode("solo")} className="text-left rounded-lg border p-4 hover:border-primary hover:bg-primary/5">
                <User className="w-5 h-5 mb-2 text-primary" />
                <span className="block font-medium">Só eu, pelo WhatsApp</span>
                <span className="block text-xs text-muted-foreground">A IA atende e passa para você quando precisar. Sem setores nem equipe.</span>
              </button>
              <button type="button" onClick={() => void setTeamMode("equipe")} className="text-left rounded-lg border p-4 hover:border-primary hover:bg-primary/5">
                <Users className="w-5 h-5 mb-2 text-primary" />
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
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-sm font-semibold ${st.done ? "bg-emerald-500 text-white" : isNext ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
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
            </section>
          ) : (
            <section className="rounded-xl border bg-card p-5 flex items-center gap-3">
              <PartyPopper className="w-6 h-6 text-primary" />
              <div className="text-sm"><b>Tudo pronto!</b> A empresa está configurada. Acompanhe o dia a dia em Conversas e os resultados em Relatórios.</div>
            </section>
          )
        )}

        <Dashboard orgId={org.id} />

        <section className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          {shortcuts.filter((x) => x.show).map((x) => (
            <Link key={x.to} to={x.to} className="rounded-xl border bg-card p-4 flex flex-col items-center gap-2 hover:shadow-md hover:-translate-y-0.5 transition">
              <x.icon className="w-6 h-6 text-primary" />
              <span className="text-sm font-medium">{x.label}</span>
            </Link>
          ))}
        </section>
      </main>
    </div>
  );
}
