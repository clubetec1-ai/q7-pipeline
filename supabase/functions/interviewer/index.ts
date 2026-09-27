import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { HttpError, requirePermission, requireUser, resolveOrg } from "../_shared/auth.ts";
import { forOrg } from "../_shared/tenant.ts";
import { getAgentConfig } from "../_shared/get-ai-config.ts";
import { chat, type ChatMsg, providerKey, type ToolDef } from "../_shared/ai-chat.ts";
import { SECTIONS } from "../_shared/company.ts";

/**
 * Agente entrevistador (org.settings): conversa com o dono como um consultor e
 * vai salvando o retrato da empresa (seções + processos repetidos). "suggest"
 * transforma o retrato em sugestões de automação (prontas × com integração).
 * Nada daqui vai para clientes; a IA de atendimento só lê as seções públicas.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Automações que o CRM já faz (o implementador instala depois). */
const READY = {
  triagem: "Recepção e triagem por departamento (menu no WhatsApp)",
  fora_horario: "Mensagem fora do horário de atendimento",
  faq_ia: "IA responde dúvidas frequentes e passa para humano quando precisa",
  qualificacao: "Qualificação de lead (nome, e-mail, interesse → etapa do funil)",
  catalogo: "Envio de catálogo/tabela de preços da biblioteca",
  pesquisa: "Pesquisa de satisfação após o atendimento",
  followup: "Lembrete/follow-up para quem parou de responder",
  dados_ficha: "Coleta de dados do cliente para a ficha",
  registros: "Controle interno com registros personalizados (pedidos, contas, contratos)",
  email: "Atendimento de e-mail na mesma tela",
};

const clip = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    if (!["message", "suggest"].includes(action)) throw new HttpError(400, "Ação inválida");
    const ctx = await requireUser(req);
    const orgId = await resolveOrg(ctx, body?.organization_id);
    await requirePermission(ctx, orgId, "org.settings");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const org = forOrg(admin, orgId);

    const { data: allowed } = await admin.rpc("service_ai_take", { org: orgId });
    if (allowed === false) throw new HttpError(429, "Muitas chamadas de IA agora. Tente em um minuto.");

    const { data: orgRow } = await admin.from("organizations").select("name, settings").eq("id", orgId).maybeSingle();
    const settings = (orgRow?.settings ?? {}) as Record<string, any>;
    const provider = typeof settings.interviewer_provider === "string" ? settings.interviewer_provider : "groq";
    const [apiKey, agent] = await Promise.all([providerKey(admin, orgId, provider), getAgentConfig(orgId)]);
    if (!apiKey) throw new HttpError(409, "Configure a chave da IA (Fluxos → Chaves de IA) para usar o entrevistador.");
    const model = String(settings.interviewer_model || (provider === "groq" ? agent?.model ?? "" : ""));

    // Retrato atual + o que já está no CRM (para não perguntar de novo).
    let { data: profile } = await org.select("company_profiles").maybeSingle();
    if (!profile) {
      ({ data: profile } = await org.insert("company_profiles", { sections: {}, processes: [] }).select().single());
    }
    const [deps, reasons, flows, types, lib] = await Promise.all([
      org.select("departments", "name"), org.select("close_reasons", "name").eq("active", true),
      org.select("flows", "name"), org.select("record_types", "name").neq("key", "contato"), org.select("library_files", "name").limit(30),
    ]);
    const names = (r: { data: { name: string }[] | null }) => (r.data ?? []).map((x) => x.name).join(", ") || "nenhum";
    const crm = [
      `Empresa: ${orgRow?.name ?? ""}`,
      `Departamentos: ${names(deps)}`,
      `Motivos de finalização: ${names(reasons)}`,
      `Fluxos: ${names(flows)}`,
      `Tipos de registro: ${names(types)}`,
      `Arquivos na biblioteca: ${names(lib)}`,
      `Horário de atendimento cadastrado: ${settings.business_hours ? JSON.stringify(settings.business_hours) : "não cadastrado"}`,
    ].join("\n");
    const retrato = JSON.stringify({ secoes: profile.sections ?? {}, processos: profile.processes ?? [] }).slice(0, 20_000);

    if (action === "suggest") {
      const prompt = [
        "Você é consultor de automação do ClubeCRM (atendimento por WhatsApp e e-mail com IA, fluxos, registros, biblioteca).",
        "A partir do retrato da empresa, sugira até 12 automações priorizadas por impacto e esforço.",
        `Automações PRONTAS no CRM (tipo "pronta", use a chave em "modelo"): ${JSON.stringify(READY)}.`,
        'Automações que dependem de outro sistema (ERP, agenda, banco...) têm tipo "integracao", com "sistema" e "passos" (3 a 6 passos simples para o dono seguir; chaves e tokens vão em Fluxos → Segredos, nunca no chat).',
        'Responda SOMENTE com JSON: {"sugestoes":[{"titulo":"","area":"","tipo":"pronta|integracao","impacto":"alto|medio|baixo","esforco":"baixo|medio|alto","descricao":"","modelo":"","sistema":"","passos":[""]}]}',
      ].join("\n");
      const r = await chat(apiKey, provider, model, [
        { role: "system", content: prompt },
        { role: "user", content: `O que já existe no CRM:\n${crm}\n\nRetrato da empresa:\n${retrato}` },
      ]);
      if (!r.ok || !r.reply) throw new HttpError(502, "A IA não respondeu. Tente de novo.");
      const match = r.reply.match(/\{[\s\S]*\}/);
      let list: unknown[] = [];
      try { list = JSON.parse(match?.[0] ?? "{}")?.sugestoes ?? []; } catch { /* resposta fora do formato */ }
      const suggestions = (Array.isArray(list) ? list : []).slice(0, 12).map((s: any) => ({
        titulo: clip(s?.titulo, 120), area: clip(s?.area, 60), descricao: clip(s?.descricao, 600),
        tipo: oneOf(s?.tipo, ["pronta", "integracao"] as const, "integracao"),
        impacto: oneOf(s?.impacto, ["alto", "medio", "baixo"] as const, "medio"),
        esforco: oneOf(s?.esforco, ["baixo", "medio", "alto"] as const, "medio"),
        modelo: Object.keys(READY).includes(s?.modelo) ? s.modelo : null,
        sistema: clip(s?.sistema, 80) || null,
        passos: Array.isArray(s?.passos) ? s.passos.slice(0, 8).map((p: unknown) => clip(p, 300)).filter(Boolean) : [],
      })).filter((s) => s.titulo);
      if (!suggestions.length) throw new HttpError(502, "Não consegui montar as sugestões. Complete mais a entrevista e tente de novo.");
      await org.update("company_profiles", { suggestions, suggestions_at: new Date().toISOString() }).eq("organization_id", orgId);
      return json({ ok: true, suggestions });
    }

    // Conversa.
    const text = clip(body?.text, 4000);
    if (text) await org.insert("interview_messages", { role: "user", content: text, created_by: ctx.user.id });
    const { data: hist } = await org.select("interview_messages", "role, content").order("id", { ascending: false }).limit(30);
    const system = [
      `Você é um consultor de processos conduzindo uma entrevista com o dono da empresa "${orgRow?.name ?? ""}" para entender como ela funciona e depois sugerir automações no ClubeCRM.`,
      "Regras: fale em português do Brasil, simples e amigável; faça no máximo 2 perguntas por vez; confirme o que entendeu;",
      "não pergunte o que já está no retrato ou no CRM; siga as seções ainda vazias nesta ordem:",
      `${Object.entries(SECTIONS).map(([k, s]) => `${k} (${s.label})`).join(", ")}, e processos repetidos do dia a dia (o que é feito, quem faz, frequência, tempo, onde trava).`,
      "Sempre que o dono informar algo, SALVE com as ferramentas (em salvar_secao envie o texto COMPLETO consolidado da seção, em tópicos, somando ao que já havia).",
      "Nunca invente. Não peça senhas, tokens nem dados pessoais de clientes. Quando o retrato estiver razoavelmente completo, diga que ele pode clicar em “Gerar sugestões”.",
      `\nO que já existe no CRM:\n${crm}\n\nRetrato atual:\n${retrato}`,
    ].join(" ");
    const tools: ToolDef[] = [
      { name: "salvar_secao", description: "Salva o texto consolidado de uma seção do retrato da empresa.",
        parameters: { type: "object", properties: { secao: { type: "string", enum: Object.keys(SECTIONS) }, texto: { type: "string" } }, required: ["secao", "texto"] } },
      { name: "adicionar_processo", description: "Registra um processo repetido do dia a dia da empresa.",
        parameters: { type: "object", properties: {
          nome: { type: "string" }, area: { type: "string" }, quem_faz: { type: "string" }, frequencia: { type: "string" },
          tempo: { type: "string" }, dificuldade: { type: "string" } }, required: ["nome"] } },
    ];
    const messages: ChatMsg[] = [
      { role: "system", content: system },
      ...(hist ?? []).reverse().map((m: { role: "assistant" | "user"; content: string }) => ({ role: m.role, content: m.content })),
    ];
    if (!hist?.length) messages.push({ role: "user", content: "Olá! Vamos começar." });

    const r = await chat(apiKey, provider, model, messages, tools);
    if (!r.ok) throw new HttpError(502, "A IA não respondeu. Tente de novo.");
    const sections = { ...(profile.sections ?? {}) } as Record<string, string>;
    const processes = [...(profile.processes ?? [])] as Record<string, string>[];
    const results: ChatMsg[] = [];
    let saved = 0;
    for (const c of r.toolCalls ?? []) {
      let outcome = "ignorado";
      if (c.name === "salvar_secao" && SECTIONS[String(c.args?.secao)]) {
        sections[String(c.args.secao)] = clip(c.args?.texto, 8000);
        outcome = "salvo"; saved++;
      } else if (c.name === "adicionar_processo" && clip(c.args?.nome, 120) && processes.length < 100) {
        processes.push(Object.fromEntries(["nome", "area", "quem_faz", "frequencia", "tempo", "dificuldade"]
          .map((k) => [k, clip(c.args?.[k], 300)])));
        outcome = "salvo"; saved++;
      }
      results.push({ role: "tool", tool_call_id: c.id, content: outcome });
    }
    if (saved) {
      await org.update("company_profiles", { sections, processes, updated_by: ctx.user.id }).eq("organization_id", orgId);
    }
    let reply = r.reply;
    if (!reply && results.length) {
      const again = await chat(apiKey, provider, model, [...messages, r.raw, ...results]);
      reply = again.ok ? again.reply : "";
    }
    reply = clip(reply || "Anotado! Pode me contar mais?", 8000);
    await org.insert("interview_messages", { role: "assistant", content: reply });
    return json({ ok: true, reply, saved });
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    console.error("[interviewer]", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Erro inesperado" }, 500);
  }
});
