import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { requireModule } from "../_shared/modules.ts";
import { HttpError, requirePermission, requireUser, resolveOrg } from "../_shared/auth.ts";
import { forOrg } from "../_shared/tenant.ts";
import { chat, resolveAI } from "../_shared/ai-chat.ts";
import { companyKnowledge } from "../_shared/company.ts";

/**
 * Agente implementador (org.settings): instala automações PRONTAS como
 * RASCUNHO — estrutura de modelos testados + textos escritos pela IA a partir
 * do retrato da empresa. Nunca publica: o dono revisa, testa no simulador e
 * publica. Cada instalação vai para o audit_log.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export const TEMPLATES: Record<string, { name: string; texts: string }> = {
  triagem: { name: "Recepção e triagem", texts: '{"saudacao":"mensagem de boas-vindas curta que termina perguntando com o que podemos ajudar"}' },
  fora_horario: { name: "Fora do horário", texts: '{"aberto":"frase curta dizendo que um atendente já vai responder","fechado":"mensagem avisando que estamos fora do horário, com o horário de atendimento, e que responderemos assim que abrir"}' },
  faq_ia: { name: "IA para dúvidas frequentes", texts: '{"prompt":"instruções completas para um agente de IA que atende clientes desta empresa: tom, o que pode responder (com base nas informações da empresa), o que não pode prometer, quando passar para um humano","apresentacao":"primeira frase do agente, dizendo que é o assistente virtual da empresa"}' },
  qualificacao: { name: "Qualificação de lead", texts: '{"saudacao":"boas-vindas curta","pergunta_interesse":"pergunta sobre o que o cliente procura","opcoes":["até 5 opções curtas de interesse, a partir dos produtos/serviços"],"encerramento":"frase dizendo que vai passar para o comercial"}' },
  catalogo: { name: "Envio de catálogo", texts: '{"mensagem":"mensagem curta enviando o catálogo/tabela e oferecendo ajuda"}' },
  pesquisa: { name: "Pesquisa de satisfação", texts: '{"pergunta":"pergunta de satisfação curta","comentario":"pergunta curta pedindo um comentário opcional","agradecimento":"agradecimento curto"}' },
  followup: { name: "Lembrete para quem parou de responder", texts: '{"pergunta":"pergunta curta para entender o que o cliente precisa","lembrete":"lembrete gentil para quem não respondeu, sem pressão"}' },
  dados_ficha: { name: "Coleta de dados do cliente", texts: '{"saudacao":"boas-vindas curta explicando que vai pedir alguns dados para agilizar o atendimento"}' },
  registros: { name: "Registros de pedidos", texts: "{}" },
  email: { name: "Atendimento de e-mail", texts: "{}" },
};

type Node = { id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> };
type Edge = { id: string; source: string; sourceHandle: string; target: string };

/** Monta o grafo em linha: cada bloco à direita do anterior. */
function builder() {
  const nodes: Node[] = [{ id: "start", type: "start", position: { x: 40, y: 160 }, data: {} }];
  const edges: Edge[] = [];
  let x = 40;
  const add = (type: string, data: Record<string, unknown>, y = 160) => {
    x += 300;
    const id = `${type}_${nodes.length}`;
    nodes.push({ id, type, position: { x, y }, data });
    return id;
  };
  const link = (source: string, sourceHandle: string, target: string) =>
    edges.push({ id: `e${edges.length + 1}`, source, sourceHandle, target });
  return { nodes, edges, add, link };
}

const s = (v: unknown, d: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 1500) : d);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.action !== "install") throw new HttpError(400, "Ação inválida");
    const ctx = await requireUser(req);
    const orgId = await resolveOrg(ctx, body?.organization_id);
    await requirePermission(ctx, orgId, "org.settings");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await requireModule(admin, orgId, "ia");
    const org = forOrg(admin, orgId);

    // Modelo: direto (página Fluxos) ou de uma sugestão do Diagnóstico.
    const { data: profile } = await org.select("company_profiles", "suggestions").maybeSingle();
    const index = Number.isInteger(body?.suggestion_index) ? Number(body.suggestion_index) : null;
    const suggestion = index !== null ? (profile?.suggestions ?? [])[index] : null;
    const key = String(suggestion?.modelo ?? body?.template ?? "");
    const tpl = TEMPLATES[key];
    if (!tpl) throw new HttpError(400, "Esta sugestão ainda não tem instalação automática.");

    if (key === "email") {
      return json({ ok: true, kind: "guide", message: "Conecte a caixa em Números → E-mails (escolha o provedor, informe e-mail e senha, clique em Testar conexão e salve)." });
    }

    const warnings: string[] = [];
    let created: { kind: "flow" | "record_type"; id: string; name: string };

    if (key === "registros") {
      const { data: exists } = await org.select("record_types", "id").eq("key", "pedido").maybeSingle();
      if (exists) {
        created = { kind: "record_type", id: exists.id, name: "Pedido" };
        warnings.push("O tipo “Pedido” já existia; nada foi duplicado.");
      } else {
        const { data: rt, error } = await org.insert("record_types", {
          key: "pedido", name: "Pedido", description: "Pedidos de clientes", access: "team", link_contact: true, created_by: ctx.user.id,
          fields: [
            { key: "numero", label: "Número", type: "text", required: true, ai_readable: true },
            { key: "valor", label: "Valor", type: "money" },
            { key: "situacao", label: "Situação", type: "select", options: ["novo", "em separação", "enviado", "entregue", "cancelado"], ai_readable: true },
            { key: "observacoes", label: "Observações", type: "long_text" },
          ],
        }).select("id").single();
        if (error || !rt) throw new HttpError(400, "Não foi possível criar o tipo de registro");
        created = { kind: "record_type", id: rt.id, name: "Pedido" };
      }
    } else {
      // Textos personalizados pela IA (padrão da empresa); sem IA, textos genéricos.
      const [{ data: orgRow }, knowledge, depts, files] = await Promise.all([
        admin.from("organizations").select("name, settings").eq("id", orgId).maybeSingle(),
        companyKnowledge(org),
        org.select("departments", "id, name").order("name"),
        org.select("library_files", "id, name").order("created_at", { ascending: false }).limit(1),
      ]);
      let t: Record<string, unknown> = {};
      const ai = await resolveAI(admin, orgId);
      const { data: allowed } = await admin.rpc("service_ai_take", { org: orgId });
      if (ai && allowed !== false) {
        const r = await chat(ai.apiKey, ai.provider, ai.model, [
          { role: "system", content: `Você escreve textos de atendimento por WhatsApp em português do Brasil, curtos, simpáticos e claros, para a empresa "${orgRow?.name ?? ""}". Use {nome} para o primeiro nome do cliente quando fizer sentido. Não invente preços nem promessas. Responda SOMENTE com JSON no formato: ${tpl.texts}` },
          { role: "user", content: knowledge || "Sem informações extras da empresa." },
        ]);
        try { t = JSON.parse(r.reply?.match(/\{[\s\S]*\}/)?.[0] ?? "{}"); } catch { /* usa os textos padrão */ }
      }
      if (!ai) warnings.push("Sem chave de IA configurada: usei textos padrão; ajuste no editor.");

      const g = builder();
      const deptList = (depts.data ?? []) as { id: string; name: string }[];
      const sales = deptList.find((d) => /comerc|venda/i.test(d.name));
      const settings = (orgRow?.settings ?? {}) as Record<string, unknown>;

      if (key === "triagem") {
        const opts = deptList.slice(0, 6).map((d, i) => ({ id: `d${i}`, label: d.name.slice(0, 60) }));
        if (!opts.length) warnings.push("Cadastre departamentos em Equipe para o menu ter opções.");
        const menu = g.add("menu", { text: s(t.saudacao, "Olá {nome}! Com o que podemos ajudar?"), options: opts, max_attempts: 2 });
        g.link("start", "first_contact", menu);
        deptList.slice(0, 6).forEach((d, i) => {
          const tr = g.add("transfer", { department_id: d.id, text: `Certo! Vou te passar para ${d.name}.` }, 60 + i * 140);
          g.link(menu, `opt:d${i}`, tr);
        });
      } else if (key === "fora_horario") {
        if (!settings.business_hours) warnings.push("Cadastre o horário em Configurações → Horário e LGPD antes de publicar (sem ele, o fluxo considera tudo fechado).");
        const bh = g.add("business_hours", {});
        g.link("start", "first_contact", bh);
        g.link("start", "returning", bh);
        const open = g.add("message", { text: s(t.aberto, "Recebemos sua mensagem! Um atendente já vai te responder.") }, 60);
        const closed = g.add("message", { text: s(t.fechado, "Estamos fora do horário de atendimento agora. Responderemos assim que abrirmos!") }, 260);
        g.link(bh, "open", open);
        g.link(bh, "closed", closed);
      } else if (key === "faq_ia") {
        const agent = g.add("ai_agent", {
          // {nome} só é trocado em mensagens; no prompt a IA já recebe o primeiro nome do cliente.
          prompt: s(t.prompt, "Você é o assistente virtual da empresa. Responda dúvidas com base nas informações da empresa. Se não souber ou o cliente pedir, passe para um atendente.")
            .replaceAll("{nome}", "o primeiro nome do cliente"),
          intro: s(t.apresentacao, "Olá! Sou o assistente virtual. Posso ajudar com suas dúvidas."),
          max_turns: 10, handoff_words: ["atendente", "humano", "pessoa"], allow_departments: deptList.map((d) => d.id),
        });
        g.link("start", "first_contact", agent);
        g.link("start", "returning", agent);
        const tr = g.add("transfer", { department_id: null, text: "Vou te passar para um atendente." });
        g.link(agent, "transferred", tr);
        g.link(agent, "fallback", tr);
      } else if (key === "qualificacao") {
        const hi = g.add("message", { text: s(t.saudacao, "Olá! Que bom falar com você.") });
        const q1 = g.add("question", { text: "Qual é o seu nome?", kind: "text", save_to: "name", max_attempts: 2 });
        const q2 = g.add("question", { text: "Qual é o seu e-mail?", kind: "email", save_to: "email", max_attempts: 2, invalid_text: "Esse e-mail parece incompleto. Pode conferir?" });
        const labels = (Array.isArray(t.opcoes) ? t.opcoes : ["Conhecer os produtos", "Pedir orçamento", "Outro assunto"])
          .slice(0, 5).map((o, i) => ({ id: `i${i}`, label: String(o).slice(0, 60) }));
        const menu = g.add("menu", { text: s(t.pergunta_interesse, "O que você procura?"), options: labels, max_attempts: 2 });
        const tr = g.add("transfer", { department_id: sales?.id ?? null, text: s(t.encerramento, "Obrigado! Vou te passar para o nosso comercial.") });
        g.link("start", "first_contact", hi); g.link(hi, "next", q1); g.link(q1, "ok", q2); g.link(q1, "invalid", q2);
        g.link(q2, "ok", menu); g.link(q2, "invalid", menu);
        labels.forEach((o) => g.link(menu, `opt:${o.id}`, tr));
        g.link(menu, "invalid", tr);
        if (!sales) warnings.push("Não achei um departamento Comercial/Vendas: o lead vai para a fila geral.");
      } else if (key === "catalogo") {
        const file = (files.data ?? [])[0] as { id: string; name: string } | undefined;
        if (!file) warnings.push("Suba o catálogo em Biblioteca e escolha o arquivo no bloco Mensagem.");
        const m = g.add("message", { text: s(t.mensagem, "Segue o nosso catálogo! Qualquer dúvida, é só chamar."), library_file_id: file?.id ?? null });
        g.link("start", "first_contact", m);
        g.link("start", "returning", m);
      } else if (key === "pesquisa") {
        const sv = g.add("survey", { kind: "csat", text: s(t.pergunta, "Como você avalia o nosso atendimento?"), comment: s(t.comentario, "Quer deixar um comentário?") });
        const thanks = g.add("message", { text: s(t.agradecimento, "Obrigado pela avaliação!") });
        g.link("start", "first_contact", sv); g.link("start", "returning", sv); g.link(sv, "answered", thanks);
        warnings.push("Depois de publicar, escolha este fluxo em Fluxos → “Depois que um atendente finaliza (pesquisa)”.");
      } else if (key === "followup") {
        const q = g.add("question", { text: s(t.pergunta, "Como podemos te ajudar hoje?"), kind: "text", max_attempts: 1, timeout_minutes: 120 });
        const remind = g.add("message", { text: s(t.lembrete, "Oi {nome}! Ainda posso te ajudar com alguma coisa?") }, 300);
        const tr = g.add("transfer", { department_id: null, text: "" }, 60);
        g.link("start", "first_contact", q); g.link("start", "returning", q);
        g.link(q, "ok", tr); g.link(q, "invalid", tr); g.link(q, "timeout", remind);
      } else if (key === "dados_ficha") {
        const hi = g.add("message", { text: s(t.saudacao, "Olá! Para agilizar, vou pedir alguns dados rapidinho.") });
        const q1 = g.add("question", { text: "Qual é o seu nome completo?", kind: "text", save_to: "name", max_attempts: 2 });
        const q2 = g.add("question", { text: "Qual é o seu e-mail?", kind: "email", save_to: "email", max_attempts: 2 });
        const tr = g.add("transfer", { department_id: null, text: "Obrigado! Já vou te atender." });
        g.link("start", "first_contact", hi); g.link(hi, "next", q1); g.link(q1, "ok", q2); g.link(q1, "invalid", q2);
        g.link(q2, "ok", tr); g.link(q2, "invalid", tr);
      }

      const name = `[Sugestão] ${tpl.name}`.slice(0, 80);
      const { data: flow, error } = await org.insert("flows", { name }).select("id").single();
      if (error || !flow) throw new HttpError(400, "Não foi possível criar o fluxo");
      const { error: vErr } = await org.insert("flow_versions", {
        flow_id: flow.id, status: "draft", graph: { nodes: g.nodes, edges: g.edges }, updated_by: ctx.user.id,
      });
      if (vErr) throw new HttpError(400, "Não foi possível criar o rascunho");
      created = { kind: "flow", id: flow.id, name };
    }

    await admin.from("audit_log").insert({
      organization_id: orgId, actor_id: ctx.user.id, actor_type: "ai_agent", agent_key: "implementer",
      action: "implementer.install", target: created.id, meta: { template: key, kind: created.kind },
    });
    if (index !== null && Array.isArray(profile?.suggestions)) {
      const list = [...profile.suggestions];
      list[index] = { ...list[index], instalado: { kind: created.kind, id: created.id } };
      await org.update("company_profiles", { suggestions: list }).eq("organization_id", orgId);
    }
    return json({ ok: true, ...created, warnings });
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    console.error("[implementer]", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Erro inesperado" }, 500);
  }
});
