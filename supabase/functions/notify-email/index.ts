import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getSecret, safeEqual } from "../_shared/secrets.ts";
import { esc, sendSystemEmail } from "../_shared/email.ts";

/**
 * Alerta por e-mail a partir de uma notificação (pg_net + x-cron-secret).
 * Só tipos conhecidos; manda para o e-mail da própria pessoa notificada;
 * marca emailed_at para não repetir. Os do cérebro só chegam aqui quando a
 * empresa ligou "Receber o cérebro por e-mail" (filtro no gatilho do banco).
 */

function ok(body: unknown = { ok: true }, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const STATUS: Record<string, string> = { disconnected: "desconectado" };
const KINDS = ["number_health", "email_health", "security_alert", "brain_weekly", "brain_goal", "brain_reminder", "support_ticket", "support_received", "support_status",
  "breaker_stepdown", "cost_alert", "platform_incident"];
const URG_PT: Record<string, string> = { baixa: "baixa", media: "média", alta: "alta", urgente: "urgente" };
const STATUS_PT: Record<string, string> = { open: "aberto", in_progress: "em andamento", done: "resolvido", canceled: "cancelado" };

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const expected = await getSecret(admin, "platform:cron_secret");
  if (!expected || !safeEqual(req.headers.get("x-cron-secret") ?? "", expected)) return ok({ ok: false, error: "unauthorized" }, 401);

  const { notification_id } = await req.json().catch(() => ({}));
  if (!/^[0-9a-f-]{36}$/i.test(String(notification_id ?? ""))) return ok({ ok: false }, 400);
  const { data: n } = await admin.from("notifications")
    .select("id, organization_id, user_id, kind, ref, emailed_at").eq("id", notification_id).maybeSingle();
  if (!n || n.emailed_at || !KINDS.includes(n.kind)) return ok({ ok: true, skipped: "nada a enviar" });

  const [{ data: p }, { data: o }, { data: appUrl }] = await Promise.all([
    admin.from("profiles").select("email").eq("user_id", n.user_id).maybeSingle(),
    admin.from("organizations").select("name").eq("id", n.organization_id).maybeSingle(),
    admin.from("app_settings").select("value").eq("key", "app_url").maybeSingle(),
  ]);
  const base = appUrl?.value ? String(appUrl.value).replace(/\/$/, "") : "";
  const r = (n.ref ?? {}) as Record<string, string>;
  let subject: string, text: string, html: string;

  if (n.kind === "support_ticket") {
    // Chamado de suporte novo: vai para os operadores da Clubetec (todos os chamados).
    const { data: t } = await admin.from("service_requests").select("topic, message, urgency, source, page, created_at")
      .eq("id", String(r.id ?? "")).maybeSingle();
    const link = base ? `${base}/plataforma` : "";
    const urg = String(t?.urgency ?? r.urgency ?? "").toUpperCase();
    subject = `[Deixa com a IA] ${urg} — chamado ${r.protocol ?? ""} de ${r.org ?? "cliente"}: ${t?.topic ?? r.topic ?? ""}`;
    const corpo = `Protocolo: ${r.protocol ?? ""}\nEmpresa: ${r.org ?? ""}\nUrgência: ${urg}\nAberto ${t?.source === "assistente" ? "pelo assistente (a pessoa disse que não resolveu)" : "pela pessoa"}${t?.page ? ` na tela ${t.page}` : ""}.\n\n${t?.message ?? ""}`;
    text = `Olá!\n\nNovo chamado de suporte.\n\n${corpo}\n\n${link ? `Responder em Plataforma → Pedidos de ajuda: ${link}` : "Responda em Plataforma → Pedidos de ajuda."}\n\nDeixa com a IA`;
    html = `<p>Olá!</p><p><b>Novo chamado de suporte — ${esc(urg)}</b></p><p>${esc(corpo).replace(/\n/g, "<br>")}</p>` +
      `<p>${link ? `<a href="${esc(link)}">Responder em Plataforma → Pedidos de ajuda</a>` : "Responda em Plataforma → Pedidos de ajuda."}</p><p>Deixa com a IA</p>`;
  } else if (n.kind === "support_received" || n.kind === "support_status") {
    // Resposta automática ao cliente: protocolo, urgência e prazo (SLA, quando definido); e cada mudança de situação.
    const link = base ? `${base}/configuracoes/suporte` : "";
    const sla = Number(r.sla_hours);
    let corpo: string;
    if (n.kind === "support_received") {
      subject = `[Deixa com a IA] Recebemos seu chamado ${r.protocol ?? ""}`;
      corpo = `Recebemos o seu chamado e ele já está com a equipe Clubetec.\n\nProtocolo: ${r.protocol ?? ""}\nAssunto: ${r.topic ?? ""}\nUrgência: ${URG_PT[r.urgency] ?? r.urgency ?? ""}\n` +
        (sla > 0 ? `Prazo para a primeira resposta: até ${sla} hora(s).` : "Vamos responder o mais rápido possível.") +
        "\n\nGuarde o número do protocolo. A resposta chega por aqui e no sino do sistema.";
    } else {
      subject = `[Deixa com a IA] Chamado ${r.protocol ?? ""}: ${STATUS_PT[r.status] ?? r.status ?? ""}`;
      corpo = `Seu chamado ${r.protocol ?? ""} (${r.topic ?? ""}) está ${STATUS_PT[r.status] ?? r.status ?? ""}.` +
        (r.reply ? `\n\nResposta da equipe Clubetec: ${r.reply}` : "");
    }
    text = `Olá!\n\n${corpo}\n\n${link ? `Acompanhe em Configurações → Suporte: ${link}` : "Acompanhe em Configurações → Suporte."}\n\nDeixa com a IA`;
    html = `<p>Olá!</p><p>${esc(corpo).replace(/\n/g, "<br>")}</p>` +
      `<p>${link ? `<a href="${esc(link)}">Acompanhar em Configurações → Suporte</a>` : "Acompanhe em Configurações → Suporte."}</p><p>Deixa com a IA</p>`;
  } else if (n.kind === "breaker_stepdown" || n.kind === "cost_alert") {
    // Disjuntor e vigia de custo (fatia 7): avisos de segurança e de gasto da IA.
    const link = base ? `${base}/agente` : "";
    const corpo = n.kind === "breaker_stepdown"
      ? `A IA voltou um degrau sozinha (${r.de ?? ""} → ${r.para ?? ""}) depois de ${r.tropecos ?? 3} tropeços em 24 horas ` +
        "(resposta segurada pela trava de segurança ou atendimento mal avaliado). Ela continua atendendo com mais cuidado; confira o motivo antes de subir de novo."
      : `O uso de IA ontem foi ${r.ontem ?? "?"} chamadas, bem acima da média de ${r.media ?? "?"} por dia.\n\nMotivo provável: ${r.motivo ?? ""}`;
    subject = n.kind === "breaker_stepdown" ? "[Deixa com a IA] A IA voltou um degrau (disjuntor)" : "[Deixa com a IA] Uso de IA fora do normal";
    text = `Olá!\n\n${corpo}\n\n${link ? `Veja em Assistente de IA: ${link}` : "Veja em Assistente de IA."}\n\nDeixa com a IA`;
    html = `<p>Olá!</p><p>${esc(corpo).replace(/\n/g, "<br>")}</p>` +
      `<p>${link ? `<a href="${esc(link)}">Ver em Assistente de IA</a>` : "Veja em Assistente de IA."}</p><p>Deixa com a IA</p>`;
  } else if (n.kind === "platform_incident") {
    // Cérebro da plataforma (fatia 11): incidente alta/crítica para a equipe Clubetec. Só metadados.
    const link = base ? `${base}/plataforma?aba=saude` : "";
    const corpo = `Incidente ${r.gravidade === "critica" ? "CRÍTICO" : "de gravidade alta"}${r.piorou ? " (piorou)" : ""}: ${r.titulo ?? ""}.` +
      `${r.empresas ? `\nEmpresas afetadas: ${r.empresas}.` : ""}\n\nA equipe de IA dona pode diagnosticar e propor a correção; nada é publicado sem a sua aprovação.`;
    subject = `[Deixa com a IA] ${r.gravidade === "critica" ? "🚨 Incidente crítico" : "Incidente"} na plataforma`;
    text = `Olá!\n\n${corpo}\n\n${link ? `Veja em Plataforma → Saúde: ${link}` : "Veja em Plataforma → Saúde."}\n\nDeixa com a IA`;
    html = `<p>Olá!</p><p>${esc(corpo).replace(/\n/g, "<br>")}</p>` +
      `<p>${link ? `<a href="${esc(link)}">Ver em Plataforma → Saúde</a>` : "Veja em Plataforma → Saúde."}</p><p>Deixa com a IA</p>`;
  } else if (n.kind.startsWith("brain_")) {
    const link = base ? `${base}/cerebro` : "";
    const empresa = o?.name ?? "";
    let titulo: string, corpo: string;
    if (n.kind === "brain_weekly") {
      // Resumo da análise (texto da IA, já anonimizado), só da própria empresa.
      const { data: run } = await admin.from("brain_runs").select("summary")
        .eq("id", String(r.run_id ?? "")).eq("organization_id", n.organization_id).maybeSingle();
      const s = (run?.summary ?? {}) as { resumo?: string; prioridades?: { titulo: string }[]; propostas?: number };
      titulo = "Cérebro: o resumo da semana está pronto";
      corpo = [s.resumo ?? "", ...(s.prioridades ?? []).map((x, i) => `${i + 1}. ${x.titulo}`),
        s.propostas ? `${s.propostas} sugestão(ões) esperando aprovação.` : ""].filter(Boolean).join("\n");
    } else if (n.kind === "brain_goal") {
      titulo = `Cérebro: meta fora do rumo — ${r.title ?? ""}`;
      corpo = `A meta "${r.title ?? ""}" está fora do rumo com os números desta semana.`;
    } else {
      titulo = `Cérebro: proposta parada — ${r.title ?? ""}`;
      corpo = `A proposta "${r.title ?? ""}" está parada há dias (${r.status === "aprovada" ? "aprovada, falta colocar no ar" : "esperando aprovação"}) e já foi cobrada do responsável.`;
    }
    subject = `[Deixa com a IA] ${titulo}`;
    text = `Olá!\n\n${empresa}\n\n${corpo}\n\n${link ? `Abrir o cérebro: ${link}` : "Veja em Resultados → Cérebro."}\n\nSugestões da IA — a decisão é sempre sua.\nDeixa com a IA`;
    html = `<p>Olá!</p><p><b>${esc(empresa)}</b></p><p>${esc(corpo).replace(/\n/g, "<br>")}</p>` +
      `<p>${link ? `<a href="${esc(link)}">Abrir o cérebro</a>` : "Veja em Resultados → Cérebro."}</p>` +
      `<p style="color:#64748b">Sugestões da IA — a decisão é sempre sua.</p><p>Deixa com a IA</p>`;
  } else {
    const security = n.kind === "security_alert";
    const what = security ? "Alerta de segurança:" : n.kind === "email_health" ? "A caixa de e-mail" : "O número";
    const page = security ? "Painel do supervisor" : n.kind === "email_health" ? "Números → E-mails" : "Números";
    const problem = security ? "tentou exportar os contatos sem permissão (bloqueado)"
      : r.error || STATUS[r.status] || "precisa de atenção";
    const link = base ? `${base}/${security ? "supervisor" : "numeros"}` : "";
    subject = `[Deixa com a IA] ${what} ${r.name ?? ""}: ${problem}`;
    text = `Olá!\n\n${what} "${r.name ?? ""}" da empresa ${o?.name ?? ""}: ${problem}\n` +
      `Veja os detalhes em ${page}${link ? `: ${link}` : " no sistema"}.\n\nDeixa com a IA`;
    html = `<p>Olá!</p><p>${what} <b>${esc(r.name)}</b> da empresa ${esc(o?.name)}: <b>${esc(problem)}</b>.</p>` +
      `<p>${link ? `<a href="${esc(link)}">Ver em ${esc(page)}</a>` : `Veja os detalhes em ${esc(page)} no sistema.`}</p><p>Deixa com a IA</p>`;
  }

  const res = await sendSystemEmail(admin, { to: String(p?.email ?? ""), subject, text, html });
  if (res.ok) await admin.from("notifications").update({ emailed_at: new Date().toISOString() }).eq("id", n.id);
  else console.log("[notify-email]", { id: n.id, skipped: res.skipped, error: res.error });
  return ok({ ok: res.ok, skipped: res.skipped });
});
