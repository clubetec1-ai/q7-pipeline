import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { HttpError, requirePermission, requireUser, resolveOrg } from "../_shared/auth.ts";
import { forOrg } from "../_shared/tenant.ts";
import { chat, type ChatMsg, providerKey, resolveAI } from "../_shared/ai-chat.ts";
import { SECTIONS, STAGES } from "../_shared/company.ts";
import { fetchSiteText, lookupCnpj, monthlyCost, USD_BRL } from "../_shared/consulting.ts";
import { knowledgeContext } from "../_shared/knowledge.ts";
import { transcribeAudio } from "../_shared/transcribe.ts";

/**
 * Agente entrevistador 2.0 (org.settings): consultoria em etapas com o dono
 * (empresa → cultura → situação → objetivos → setores → processos por setor) e,
 * no fim, o planejamento estratégico com plano de ação e custo estimado da IA.
 * "research" lê só fontes abertas (site e CNPJ). "suggest" continua para o
 * implementador. Nada daqui vai para clientes; a IA de atendimento só lê as
 * seções públicas.
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
const parseJson = (reply: string): Record<string, unknown> => {
  try { return JSON.parse(reply.match(/\{[\s\S]*\}/)?.[0] ?? "{}"); } catch { return {}; }
};
const PROC_KEYS = ["nome", "setor", "quem_faz", "frequencia", "tempo", "dificuldade", "passo_a_passo", "como_deveria"] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    if (!["message", "suggest", "research", "plan", "format", "transcribe", "brand_write", "sector_priority"].includes(action)) throw new HttpError(400, "Ação inválida");
    const ctx = await requireUser(req);
    const orgId = await resolveOrg(ctx, body?.organization_id);
    await requirePermission(ctx, orgId, "org.settings");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const org = forOrg(admin, orgId);

    const { data: allowed } = await admin.rpc("service_ai_take", { org: orgId });
    if (allowed === false) throw new HttpError(429, "Muitas chamadas de IA agora. Tente em um minuto.");

    // Falar em vez de escrever: áudio gravado no navegador → texto (Whisper da Groq). Nada é guardado.
    if (action === "transcribe") {
      const b64 = String(body?.audio ?? "");
      if (!b64 || b64.length > 14_000_000) throw new HttpError(413, "Áudio vazio ou longo demais (até uns 10 minutos).");
      const key = await providerKey(admin, orgId, "groq");
      if (!key) throw new HttpError(409, "Para usar o microfone, cadastre a chave da Groq em Fluxos → Chaves de IA.");
      let bytes: Uint8Array;
      try { bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch { throw new HttpError(400, "Áudio inválido"); }
      const ext = /mp4|m4a/.test(String(body?.mime ?? "")) ? "m4a" : /ogg/.test(String(body?.mime ?? "")) ? "ogg" : "webm";
      const text = await transcribeAudio(key, bytes, `fala.${ext}`);
      if (!text) throw new HttpError(502, "Não consegui entender o áudio. Tente falar de novo, mais perto do microfone.");
      return json({ ok: true, text });
    }

    const { data: orgRow } = await admin.from("organizations").select("name, settings").eq("id", orgId).maybeSingle();
    const settings = (orgRow?.settings ?? {}) as Record<string, any>;
    // Provedor padrão da empresa (Fluxos → Chaves de IA); consultoria pede raciocínio,
    // então na Groq usa o modelo maior quando nenhum foi escolhido (o "auto" começa pelo 8b).
    const ai = await resolveAI(admin, orgId, { provider: settings.interviewer_provider ?? null, model: settings.interviewer_model ?? null });
    if (!ai) throw new HttpError(409, "Configure a chave do provedor de IA (Fluxos → Chaves de IA) para usar o entrevistador.");
    const { provider, apiKey } = ai;
    const model = provider === "groq" && (!ai.model || ai.model === "auto") ? "llama-3.3-70b-versatile" : ai.model;
    const ask = async (system: string, user: string, long = false) => {
      const r = await chat(apiKey, provider, model, [{ role: "system", content: system }, { role: "user", content: user }], undefined,
        { json: true, ...(long ? { timeoutMs: 90_000, maxTokens: 8000 } : {}) });
      if (!r.ok || !r.reply) throw new HttpError(502, r.status === 429 ? "A IA está no limite de uso agora. Tente de novo em 1 minuto." : "A IA não respondeu. Tente de novo.");
      const out = parseJson(r.reply);
      if (!Object.keys(out).length) console.warn("[interviewer] resposta fora do JSON", { chars: r.reply.length });
      return out;
    };

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
    const sections = { ...(profile.sections ?? {}) } as Record<string, string>;
    const processes = [...(profile.processes ?? [])] as Record<string, string>[];
    const retrato = (max: number, stepChars = 400) => JSON.stringify({
      secoes: sections,
      processos: processes.map((p) => ({ ...p, passo_a_passo: clip(p.passo_a_passo, stepChars) })),
    }).slice(0, max);

    // ------------------------------------------------------------- brand_write
    // Marketing: texto de campanha no tom de voz da marca (usa só o retrato público + a voz).
    if (action === "brand_write") {
      const goal = clip(body?.goal, 1500);
      if (goal.length < 5) throw new HttpError(400, "Conte sobre o que é a mensagem.");
      const voz = clip(sections.marca_voz, 2500);
      const out = await ask(
        "Você escreve mensagens de marketing para WhatsApp de uma empresa brasileira, seguindo o tom de voz da marca. " +
        "Mensagem curta (até 600 caracteres), clara, com uma chamada para ação; use {nome} onde entra o primeiro nome do cliente. " +
        "Não invente preços, prazos ou promoções que não estejam no pedido ou nas informações da empresa. " +
        (voz ? "" : "A marca ainda não tem tom de voz definido: use um tom cordial e profissional. ") +
        'Responda SOMENTE com JSON: {"texto":"","variacao":""} (variacao = uma segunda opção com outra abordagem).',
        `Empresa: ${orgRow?.name ?? ""}\nSobre a empresa: ${clip(sections.empresa, 1500)}\nProdutos/serviços: ${clip(sections.produtos, 1500)}\n` +
        `Tom de voz da marca:\n${voz || "(não definido)"}\n\nObjetivo da mensagem: ${goal}`,
      );
      const texto = clip(out.texto, 1000);
      if (!texto) throw new HttpError(502, "Não consegui escrever agora. Tente de novo.");
      return json({ ok: true, texto, variacao: clip(out.variacao, 1000), sem_voz: !voz });
    }

    // --------------------------------------------------------- sector_priority
    // Por onde começar: ordena os setores pelo resultado esperado (objetivos, dores e processos mapeados).
    if (action === "sector_priority") {
      const setores = [...new Set([...(profile.steps?.setores?.setores ?? []), ...processes.map((p) => p.setor || p.area).filter(Boolean)])] as string[];
      if (!setores.length) throw new HttpError(400, "Mapeie os setores primeiro.");
      const procs = processes.map((p) => ({ nome: p.nome, setor: p.setor || p.area, trava: clip(p.dificuldade, 200), tempo: clip(p.tempo, 60), frequencia: clip(p.frequencia, 60), implementar: p.implementar ?? "" }));
      const out = await ask(
        "Você é um consultor de implementação de CRM e automação. Ordene os setores da empresa do que traz MAIS resultado para o que traz menos, " +
        "considerando os objetivos e as dores do dono, o volume e onde os processos travam, e o esforço para implementar. " +
        "Para cada setor: motivo curto (1 frase, ligado ao que o dono disse), ganho esperado (concreto, ex.: responder leads em minutos) e até 3 processos para começar (nomes exatos da lista). " +
        'Responda SOMENTE com JSON: {"resumo":"1 frase","ordem":[{"setor":"","motivo":"","ganho":"","primeiros":[""]}]}',
        `Empresa: ${orgRow?.name ?? ""}\nSituação: ${clip(sections.situacao, 1500)}\nMetas e dores: ${clip(sections.metas, 1200)}\nObjetivos: ${clip(sections.objetivos, 1200)}\n` +
        `Setores: ${setores.join(", ")}\nProcessos mapeados: ${JSON.stringify(procs).slice(0, 6000)}`,
      );
      const valid = new Set(setores);
      const ordem = (Array.isArray(out.ordem) ? out.ordem : []).map((o: any) => ({
        setor: clip(o?.setor, 80), motivo: clip(o?.motivo, 300), ganho: clip(o?.ganho, 200),
        primeiros: (Array.isArray(o?.primeiros) ? o.primeiros : []).slice(0, 3).map((x: unknown) => clip(x, 120)).filter(Boolean),
      })).filter((o: { setor: string }) => valid.has(o.setor)).slice(0, 20);
      if (!ordem.length) throw new HttpError(502, "Não consegui sugerir agora. Tente de novo.");
      const prioridade = { at: new Date().toISOString(), resumo: clip(out.resumo, 300), ordem };
      await org.update("company_profiles", { steps: { ...(profile.steps ?? {}), prioridade } });
      return json({ ok: true, prioridade });
    }

    // ---------------------------------------------------------------- research
    if (action === "research") {
      const site = clip(body?.site, 300);
      const cnpj = clip(body?.cnpj, 30);
      if (!site && !cnpj) throw new HttpError(400, "Informe o site e/ou o CNPJ.");
      const [s, c] = await Promise.all([site ? fetchSiteText(site) : null, cnpj ? lookupCnpj(cnpj) : null]);
      const found = [s?.text ? `SITE (${s.url}):\n${s.text}` : "", c?.text ? `CNPJ:\n${c.text}` : ""].filter(Boolean).join("\n\n");
      const problems = [s?.error ? `site: ${s.error}` : "", c?.error ? `CNPJ: ${c.error}` : ""].filter(Boolean);
      if (!found) throw new HttpError(422, `Não consegui ler os dados públicos (${problems.join("; ")}).`);
      const out = await ask(
        "Você resume dados PÚBLICOS de uma empresa para um consultor. Use só o que está no texto; não invente. " +
        'Responda SOMENTE com JSON: {"empresa":"texto consolidado em tópicos: o que faz, para quem, onde, desde quando, diferenciais","produtos":"produtos/serviços citados (ou vazio)","atendimento":"canais, horários e contatos comerciais citados (ou vazio)","resumo":"2 a 3 frases para o dono confirmar"}. ' +
        "Nunca inclua nomes de pessoas, CPF ou dados de sócios.",
        `Já anotado sobre a empresa:\n${sections.empresa ?? "(nada)"}\n\nDados públicos encontrados:\n${found}`,
      );
      for (const k of ["empresa", "produtos", "atendimento"]) {
        const v = clip(out[k], 8000);
        if (v && !clip(sections[k], 10)) sections[k] = v; // não sobrescreve o que o dono já escreveu
        else if (v && k === "empresa") sections[k] = clip(`${sections[k]}\n\n(Dados públicos) ${v}`, 8000);
      }
      const public_research = { site: s?.url ?? site ?? null, cnpj: cnpj || null, resumo: clip(out.resumo, 800), problemas: problems, at: new Date().toISOString() };
      await org.update("company_profiles", { sections, public_research, updated_by: ctx.user.id }).eq("organization_id", orgId);
      const note = `Encontrei estes dados públicos da empresa: ${public_research.resumo || "veja o retrato ao lado"}\n\nEstá certo? Me corrija ou complete o que faltar.`;
      await org.insert("interview_messages", { role: "assistant", content: note });
      return json({ ok: true, research: public_research });
    }

    // ------------------------------------------------------------------ suggest
    if (action === "suggest") {
      const prompt = [
        "Você é consultor de automação do ClubeCRM (atendimento por WhatsApp e e-mail com IA, fluxos, registros, biblioteca).",
        "A partir do retrato da empresa, sugira até 12 automações priorizadas por impacto e esforço.",
        `Automações PRONTAS no CRM (tipo "pronta", use a chave em "modelo"): ${JSON.stringify(READY)}.`,
        'Automações que dependem de outro sistema (ERP, agenda, banco...) têm tipo "integracao", com "sistema" e "passos" (3 a 6 passos simples para o dono seguir; chaves e tokens vão em Fluxos → Segredos, nunca no chat).',
        'O próprio ClubeCRM nunca é "sistema" de integração: tudo que o CRM já faz (horário de atendimento, fluxos, IA, registros, biblioteca, pesquisa, follow-up, e-mail) é tipo "pronta". Não repita sugestões.',
        'Responda SOMENTE com JSON: {"sugestoes":[{"titulo":"","area":"","tipo":"pronta|integracao","impacto":"alto|medio|baixo","esforco":"baixo|medio|alto","descricao":"","modelo":"","sistema":"","passos":[""]}]}',
      ].join("\n");
      const out = await ask(prompt, `O que já existe no CRM:\n${crm}\n\nRetrato da empresa:\n${retrato(20_000)}`);
      const list = Array.isArray(out.sugestoes) ? out.sugestoes : [];
      const suggestions = list.slice(0, 12).map((s: any) => ({
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

    // --------------------------------------------------------------------- plan
    if (action === "plan") {
      const filled = Object.values(sections).filter((v) => clip(v, 10)).length;
      if (filled < 3 && processes.length < 2) throw new HttpError(422, "Complete mais etapas da consultoria antes de gerar o planejamento.");
      const prompt = [
        "Você é consultor de gestão e automação. Com o retrato da empresa (cultura, situação, objetivos, setores e processos descritos passo a passo),",
        "faça o PLANEJAMENTO ESTRATÉGICO e o PLANO DE AÇÃO. Separe o que é MELHORIA DE PROCESSO (organização, regra, treinamento) do que é AUTOMAÇÃO.",
        "Prioridade de custo: toda automação possível SEM IA (fluxo, regra, resposta rápida, registro, lembrete, conector) vem PRIMEIRO; use IA só onde precisa entender texto livre ou conversar.",
        `Automações prontas no ClubeCRM (use a chave em "modelo" quando servir): ${JSON.stringify(READY)}.`,
        'Tipo "integracao" só quando depende de OUTRO sistema (ERP, banco, agenda externa). Tudo que o ClubeCRM já faz (registros personalizados para chamados, pedidos e contas; fluxos; e-mail; biblioteca; follow-up) é "sem_ia" ou "ia", nunca integração.',
        "Missão, visão e valores: use o que o dono definiu; se faltar, proponha e comece o texto com \"Proposta:\". Nunca invente números; se estimar volume, diga que é estimativa.",
        'Responda SOMENTE com JSON: {"diagnostico":"onde a empresa está (3 a 6 frases)","missao":"","visao":"","valores":[""],',
        '"objetivos":[{"objetivo":"","indicador":"","prazo":""}],',
        '"melhorias":[{"titulo":"","setor":"","problema":"","como":"passo a passo curto","impacto":"alto|medio|baixo"}],',
        '"automacoes":[{"titulo":"","setor":"","tipo":"sem_ia|ia|integracao","modelo":"","sistema":"","descricao":"","impacto":"alto|medio|baixo","esforco":"baixo|medio|alto","volume_mes":0,"complexidade":"simples|complexa"}],',
        '"plano_acao":[{"acao":"","responsavel":"cargo ou setor","prazo":"ex.: semana 1, mês 2"}]}',
        '"volume_mes" = quantas respostas de IA por mês a automação daria (só para tipo "ia"; use os volumes do retrato). "complexidade": simples = triagem, FAQ, classificação; complexa = análise, negociação, textos longos.',
      ].join(" ");
      const docs = await knowledgeContext(admin, orgId, [sections.setores, sections.objetivos, sections.situacao].filter(Boolean).join(" "), "interno", null, 4000);
      const out = await ask(prompt, `O que já existe no CRM:\n${crm}\n\nRetrato da empresa:\n${retrato(24_000, 800)}${docs ? `\n\n${docs}` : ""}`, true);
      const autos = (Array.isArray(out.automacoes) ? out.automacoes : []).slice(0, 20).map((a: any) => {
        const tipo = oneOf(a?.tipo, ["sem_ia", "ia", "integracao"] as const, "sem_ia");
        const complexidade = oneOf(a?.complexidade, ["simples", "complexa"] as const, "simples");
        return {
          titulo: clip(a?.titulo, 120), setor: clip(a?.setor, 60), tipo, descricao: clip(a?.descricao, 600),
          modelo: Object.keys(READY).includes(a?.modelo) ? a.modelo : null, sistema: clip(a?.sistema, 80) || null,
          impacto: oneOf(a?.impacto, ["alto", "medio", "baixo"] as const, "medio"),
          esforco: oneOf(a?.esforco, ["baixo", "medio", "alto"] as const, "medio"),
          complexidade, custo: tipo === "ia" ? monthlyCost(Number(a?.volume_mes), complexidade) : null,
        };
      }).filter((a) => a.titulo);
      const rank = { sem_ia: 0, ia: 1, integracao: 2 } as const;
      const imp = { alto: 0, medio: 1, baixo: 2 } as const;
      autos.sort((x, y) => rank[x.tipo] - rank[y.tipo] || imp[x.impacto] - imp[y.impacto]);
      const sum = (k: "groq" | "claude") => Math.round(autos.reduce((t, a) => t + (a.custo?.[k] ?? 0), 0) * 100) / 100;
      const list = (v: unknown, n: number) => (Array.isArray(v) ? v : []).slice(0, n);
      const plan = {
        diagnostico: clip(out.diagnostico, 2000), missao: clip(out.missao, 600), visao: clip(out.visao, 600),
        valores: list(out.valores, 10).map((v) => clip(v, 200)).filter(Boolean),
        objetivos: list(out.objetivos, 10).map((o: any) => ({ objetivo: clip(o?.objetivo, 300), indicador: clip(o?.indicador, 200), prazo: clip(o?.prazo, 80) })).filter((o) => o.objetivo),
        melhorias: list(out.melhorias, 15).map((m: any) => ({ titulo: clip(m?.titulo, 120), setor: clip(m?.setor, 60), problema: clip(m?.problema, 400), como: clip(m?.como, 800), impacto: oneOf(m?.impacto, ["alto", "medio", "baixo"] as const, "medio") })).filter((m) => m.titulo),
        automacoes: autos,
        plano_acao: list(out.plano_acao, 25).map((p: any) => ({ acao: clip(p?.acao, 300), responsavel: clip(p?.responsavel, 80), prazo: clip(p?.prazo, 60) })).filter((p) => p.acao),
        custo: { groq_mes: sum("groq"), claude_mes: sum("claude"), dolar: USD_BRL,
          premissas: "Estimativa por resposta de IA: simples ≈ 1.500 tokens de entrada e 200 de saída; complexa ≈ 4.000 e 600. Automações sem IA não têm custo de IA." },
        modelo: `${provider}:${model}`,
      };
      if (!plan.diagnostico && !autos.length) throw new HttpError(502, "Não consegui montar o planejamento. Tente de novo.");
      // Compatível com o implementador: automações viram sugestões instaláveis.
      const suggestions = autos.slice(0, 12).map((a) => ({
        titulo: a.titulo, area: a.setor, descricao: a.descricao, tipo: a.tipo === "integracao" ? "integracao" : "pronta",
        impacto: a.impacto, esforco: a.esforco, modelo: a.modelo, sistema: a.sistema, passos: [],
      }));
      await org.update("company_profiles", {
        plan, plan_at: new Date().toISOString(), suggestions, suggestions_at: new Date().toISOString(), stage: "plano",
      }).eq("organization_id", orgId);
      await admin.from("audit_log").insert({ organization_id: orgId, actor_id: ctx.user.id, action: "interviewer.plan", meta: { automacoes: autos.length } });
      // Ciclo de melhoria: melhorias e automações do plano entram como sugeridas (as antigas não aprovadas saem).
      const kindOf = { sem_ia: "automacao", ia: "agente", integracao: "integracao" } as const;
      await admin.rpc("service_add_improvements", {
        org: orgId, src: "plano", replace_suggested: true,
        items: [
          ...autos.map((a) => ({ title: a.titulo, description: a.descricao, setor: a.setor, kind: kindOf[a.tipo], modelo: a.modelo, sistema: a.sistema,
            how: a.custo ? `Custo estimado de IA: Groq R$ ${a.custo.groq}/mês · ${a.custo.claude_model} R$ ${a.custo.claude}/mês.` : null })),
          ...plan.melhorias.map((m) => ({ title: m.titulo, description: m.problema, how: m.como, setor: m.setor, kind: "processo" })),
        ],
      });
      return json({ ok: true, plan, suggestions });
    }

    // ------------------------------------------------------------------- format
    // Diagnóstico em páginas: organiza o que o dono escreveu numa etapa e devolve
    // para ele revisar. NÃO salva — quem salva é a aprovação dele na tela.
    if (action === "format") {
      const stepKey = String(body?.step ?? "");
      const raw = clip(body?.text, 12_000);
      // Anexos da etapa (documentos da base desta empresa): o texto entra na organização.
      const docIds = (Array.isArray(body?.docs) ? body.docs : []).map(String).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 10);
      let anexos = "";
      if (docIds.length) {
        const { data: ch } = await admin.from("knowledge_chunks").select("content, doc_id, ord").eq("organization_id", orgId)
          .in("doc_id", docIds).order("ord").limit(40);
        anexos = (ch ?? []).map((c: { content: string }) => c.content).join("\n\n").slice(0, 8000);
      }
      const extra = anexos ? `\n\nDocumentos anexados pelo dono nesta etapa (use como fonte; não copie dados pessoais):\n${anexos}` : "";
      if (raw.length < 10 && !docIds.length) throw new HttpError(400, "Escreva, fale ou anexe algo antes de organizar.");
      if (stepKey === "processos") {
        const setor = clip(body?.setor, 80);
        if (!setor) throw new HttpError(400, "Setor não informado");
        const out = await ask(
          `Você organiza a descrição de processos do setor "${setor}" de uma empresa, escrita pelo dono como se ensinasse uma pessoa nova. ` +
          "Separe cada processo e escreva o passo a passo numerado, claro e fiel ao que ele disse (não invente passos). " +
          "Se ele contou como DEVERIA funcionar, registre em como_deveria. Em faltando, até 3 perguntas curtas sobre o que ficou vago (quem faz, tempo, ferramenta, onde trava). " +
          'Responda SOMENTE com JSON: {"processos":[{"nome":"","quem_faz":"","frequencia":"","tempo":"","dificuldade":"onde trava","passo_a_passo":"1. ...\n2. ...","como_deveria":""}],"faltando":[""]}',
          `Empresa: ${orgRow?.name ?? ""}\nSetores: ${sections.setores ?? ""}\n\nO que o dono escreveu sobre o setor ${setor}:\n${raw}${extra}`,
        );
        const processos = (Array.isArray(out.processos) ? out.processos : []).slice(0, 20).map((p: any) => {
          const item = Object.fromEntries(PROC_KEYS.map((k) => [k, clip(p?.[k], k === "passo_a_passo" || k === "como_deveria" ? 3000 : 300)])) as Record<string, string>;
          item.setor = setor; item.area = setor;
          return item;
        }).filter((p) => p.nome);
        if (!processos.length) throw new HttpError(502, "Não consegui separar os processos. Tente descrever um de cada vez.");
        return json({ ok: true, processos, faltando: (Array.isArray(out.faltando) ? out.faltando : []).slice(0, 3).map((f) => clip(f, 200)).filter(Boolean) });
      }
      const stage = STAGES.find((s) => s.key === stepKey && s.key !== "processos");
      if (!stage) throw new HttpError(400, "Etapa inválida");
      const keys = stage.sections;
      const out = await ask(
        `Você organiza o que o dono de uma empresa escreveu na etapa "${stage.label}" de um diagnóstico. Objetivo da etapa: ${stage.guide} ` +
        "Reescreva em tópicos curtos e claros, fiel ao que ele disse (não invente nada; mantenha números e nomes de setores). " +
        `Distribua nas seções: ${keys.map((k) => `${k} (${SECTIONS[k].label})`).join(", ")}; deixe vazia a seção sem informação. ` +
        "Em faltando, até 3 perguntas curtas sobre o que ficou vago ou faltou para esta etapa. " +
        (stepKey === "setores" ? 'Em "setores_lista", liste só os nomes dos setores citados. ' : "") +
        `Responda SOMENTE com JSON: {"secoes":{${keys.map((k) => `"${k}":""`).join(",")}},${stepKey === "setores" ? '"setores_lista":[""],' : ""}"faltando":[""]}`,
        `Empresa: ${orgRow?.name ?? ""}\n${stepKey === "empresa" && profile.public_research?.resumo ? `Dados públicos encontrados: ${profile.public_research.resumo}\n` : ""}\nO que o dono escreveu:\n${raw}${extra}`,
      );
      const secoes: Record<string, string> = {};
      for (const k of keys) secoes[k] = clip((out.secoes as Record<string, unknown> | undefined)?.[k], 8000);
      if (!Object.values(secoes).some(Boolean)) throw new HttpError(502, "Não consegui organizar. Tente escrever de novo com mais detalhes.");
      return json({
        ok: true, secoes,
        setores: stepKey === "setores" ? (Array.isArray(out.setores_lista) ? out.setores_lista : []).slice(0, 20).map((s) => clip(s, 80)).filter(Boolean) : undefined,
        faltando: (Array.isArray(out.faltando) ? out.faltando : []).slice(0, 3).map((f) => clip(f, 200)).filter(Boolean),
      });
    }

    // ------------------------------------------------------------------ message
    // UMA chamada por mensagem, resposta em JSON com o que salvar e o que dizer.
    const stageIdx = Math.max(0, STAGES.findIndex((s) => s.key === profile.stage));
    const inPlan = profile.stage === "plano";
    const stage = STAGES[inPlan ? STAGES.length - 1 : stageIdx];
    const next = STAGES[stageIdx + 1];
    const text = clip(body?.text, 4000);
    if (text) await org.insert("interview_messages", { role: "user", content: text, created_by: ctx.user.id });
    const { data: hist } = await org.select("interview_messages", "role, content").order("id", { ascending: false }).limit(20);
    const bySector = processes.reduce((m: Record<string, string[]>, p) => {
      const k = p.setor || p.area || "Sem setor";
      (m[k] ??= []).push(p.nome);
      return m;
    }, {});
    const system = [
      `Você é um consultor de gestão conduzindo uma consultoria com o dono da empresa "${orgRow?.name ?? ""}" para depois montar o planejamento estratégico e as automações no ClubeCRM.`,
      "Regras: português do Brasil, simples e amigável; no máximo 2 perguntas por vez; confirme o que entendeu; não pergunte o que já está no retrato ou no CRM.",
      "Nunca invente. Não peça senhas, tokens nem dados pessoais de clientes.",
      inPlan
        ? "A consultoria já passou por todas as etapas: ajude a ajustar qualquer seção ou processo e lembre que ele pode clicar em “Gerar planejamento” de novo."
        : `ETAPA ATUAL (${stageIdx + 1} de ${STAGES.length}): ${stage.label}. ${stage.guide}`,
      stage.key === "processos" ? `Setores mapeados: ${sections.setores || "(nenhum ainda — peça o mapa antes)"}. Processos já descritos por setor: ${JSON.stringify(bySector)}.` : "",
      !inPlan ? `Quando esta etapa estiver completa e o dono confirmar, marque "etapa_concluida": true e diga que a próxima etapa é: ${next ? next.label : "o planejamento (botão “Gerar planejamento”)"}.` : "",
      'Responda SOMENTE com um JSON válido: {"secoes":{"<secao>":"texto COMPLETO consolidado da seção, em tópicos, somando ao que já havia"},"processos":[{"nome":"","setor":"","quem_faz":"","frequencia":"","tempo":"","dificuldade":"","passo_a_passo":"1. ... 2. ..."}],"etapa_concluida":false,"resposta":"sua mensagem ao dono"}.',
      `Em "secoes" inclua só as que mudaram (chaves possíveis: ${Object.keys(SECTIONS).join(", ")}; desta etapa: ${stage.sections.join(", ") || "processos"}). Em "processos" inclua os processos citados agora (novos ou com passo a passo mais completo). Se nada mudou, use {} e [].`,
      `\nO que já existe no CRM:\n${crm}\n\nRetrato atual:\n${retrato(12_000)}`,
    ].filter(Boolean).join(" ");
    const messages: ChatMsg[] = [
      { role: "system", content: system },
      ...(hist ?? []).reverse().map((m: { role: "assistant" | "user"; content: string }) => ({ role: m.role, content: m.content })),
    ];
    if (!hist?.length) messages.push({ role: "user", content: "Olá! Vamos começar." });

    const r = await chat(apiKey, provider, model, messages, undefined, { json: true });
    if (!r.ok || !r.reply) throw new HttpError(502, r.status === 429 ? "A IA está no limite de uso agora. Tente de novo em 1 minuto." : "A IA não respondeu. Tente de novo.");
    const out = parseJson(r.reply) as { secoes?: Record<string, unknown>; processos?: unknown[]; resposta?: unknown; etapa_concluida?: unknown };

    let saved = 0;
    for (const [k, v] of Object.entries(out.secoes ?? {})) {
      if (SECTIONS[k] && clip(v, 8000)) { sections[k] = clip(v, 8000); saved++; }
    }
    const keyOf = (p: Record<string, string>) => `${(p.setor || p.area || "").toLowerCase()}|${String(p.nome ?? "").toLowerCase()}`;
    for (const raw of Array.isArray(out.processos) ? out.processos.slice(0, 20) : []) {
      const item = Object.fromEntries(PROC_KEYS.map((k) => [k, clip((raw as Record<string, unknown>)?.[k], k === "passo_a_passo" ? 3000 : 300)])) as Record<string, string>;
      if (!item.nome) continue;
      item.area = item.setor;
      const at = processes.findIndex((p) => keyOf(p) === keyOf(item) || (!item.setor && String(p.nome).toLowerCase() === item.nome.toLowerCase()));
      if (at >= 0) {
        const merged = { ...processes[at] };
        for (const k of PROC_KEYS) if (item[k] && item[k].length >= clip(merged[k], 3000).length) merged[k] = item[k];
        processes[at] = merged; saved++;
      } else if (processes.length < 100) { processes.push(item); saved++; }
    }
    const advance = !inPlan && out.etapa_concluida === true && !!next;
    const patch: Record<string, unknown> = { sections, processes, updated_by: ctx.user.id };
    if (advance) patch.stage = next.key;
    if (saved || advance) await org.update("company_profiles", patch).eq("organization_id", orgId);

    const reply = clip(typeof out.resposta === "string" && out.resposta.trim() ? out.resposta : (Object.keys(out).length ? "" : r.reply), 8000)
      || "Anotado! Quer me contar mais algum detalhe, ou seguimos para o próximo assunto?";
    await org.insert("interview_messages", { role: "assistant", content: reply });
    return json({ ok: true, reply, saved, stage: advance ? next.key : profile.stage });
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    console.error("[interviewer]", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Erro inesperado" }, 500);
  }
});
