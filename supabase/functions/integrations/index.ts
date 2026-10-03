import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { HttpError, requirePermission, requireUser, resolveOrg } from "../_shared/auth.ts";
import { forOrg } from "../_shared/tenant.ts";
import { chatAI, resolveAI } from "../_shared/ai-chat.ts";
import { runHttp } from "../_shared/flow/executor.ts";
import { checkUrl } from "../_shared/flow/http.ts";

/**
 * Guia de integração (org.settings). A IA escreve o passo a passo e SUGERE a
 * configuração do bloco "Consultar sistema"; o dono guarda a chave no cofre,
 * testa de verdade (mesma guarda de rede/segredos/limite do fluxo), escolhe os
 * campos e cria o fluxo em RASCUNHO. Nada é publicado aqui.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const slug = (v: unknown) => clip(v, 40).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "sistema";
const METHODS = ["GET", "POST", "PUT", "PATCH"];

/** Config do bloco HTTP validada (nunca confiar no que vem da IA ou do navegador). */
// deno-lint-ignore no-explicit-any
function cleanConfig(c: any) {
  const url = clip(c?.url, 500);
  return {
    method: METHODS.includes(c?.method) ? c.method : "GET",
    url: url.startsWith("https://") ? url : "",
    headers: (Array.isArray(c?.headers) ? c.headers : []).slice(0, 10)
      .map((h: any) => ({ key: clip(h?.key, 64), value: clip(h?.value, 2000) })).filter((h: any) => /^[A-Za-z0-9-]{1,64}$/.test(h.key)),
    body: clip(c?.body, 4000),
    map: (Array.isArray(c?.map) ? c.map : []).slice(0, 20)
      .map((m: any) => ({ path: clip(m?.path, 120), var: slug(m?.var) })).filter((m: any) => m.path),
  };
}

/** Caminhos das folhas de um JSON (para o dono escolher o que usar). */
function leafPaths(v: unknown, prefix = "", out: string[] = []): string[] {
  if (out.length >= 40) return out;
  if (Array.isArray(v)) { if (v.length) leafPaths(v[0], `${prefix}[0]`, out); return out; }
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 40)) leafPaths(x, prefix ? `${prefix}.${k}` : k, out);
    return out;
  }
  if (prefix) out.push(prefix);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    const ctx = await requireUser(req);
    const orgId = await resolveOrg(ctx, body?.organization_id);
    await requirePermission(ctx, orgId, "org.settings");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const org = forOrg(admin, orgId);
    const loadGuide = async () => {
      const { data } = await org.select("integration_guides").eq("id", String(body?.guide_id ?? "")).maybeSingle();
      if (!data) throw new HttpError(404, "Guia não encontrado");
      return data;
    };

    if (action === "draft") {
      let system = clip(body?.system, 80);
      let goal = clip(body?.goal, 500);
      if (Number.isInteger(body?.suggestion_index)) {
        const { data: p } = await org.select("company_profiles", "suggestions").maybeSingle();
        const s = (p?.suggestions ?? [])[body.suggestion_index];
        if (s) { system = clip(s.sistema || system || "Sistema", 80); goal = clip(`${s.titulo}. ${s.descricao ?? ""}`, 500); }
      }
      if (!system || !goal) throw new HttpError(400, "Diga qual sistema e o que você quer automatizar");
      const { data: allowed } = await admin.rpc("service_ai_take", { org: orgId });
      if (allowed === false) throw new HttpError(429, "Muitas chamadas de IA agora. Tente em um minuto.");
      const ai = await resolveAI(admin, orgId);
      if (!ai) throw new HttpError(409, "Configure a chave de IA em Configurações → Chaves de IA.");
      const secretName = slug(system);
      const r = await chatAI({ ...ai, model: ai.provider === "groq" && (!ai.model || ai.model === "auto") ? "llama-3.3-70b-versatile" : ai.model }, [
        { role: "system", content: [
          "Você é especialista em integrações de sistemas brasileiros (ERPs, agendas, lojas virtuais, bancos) com APIs REST.",
          "Monte um guia para um dono de pequena empresa, em português simples, para o CRM consultar esse sistema pelo bloco HTTP.",
          `Use {telefone} (telefone do cliente, só dígitos com DDI 55), {nome}, {protocolo} ou {var.nome} na URL/corpo quando fizer sentido. A chave vai como {{segredo.${secretName}}} (nunca escreva uma chave real).`,
          "Prefira buscar pelo telefone do cliente (confirmado pelo WhatsApp) em vez de um documento digitado.",
          "Se não tiver certeza do endereço exato da API, diga isso nas observações e aponte a documentação oficial. Só https.",
          'O bloco faz UMA chamada com chave fixa. Marque "complexa": true se a API exigir OAuth/login com token que expira, várias chamadas encadeadas (ex.: achar o cliente e depois o pedido) ou certificado.',
          'Responda SOMENTE com JSON: {"titulo":"","documentacao":"url oficial da documentação da API","passos_chave":["onde e como gerar a chave/token no sistema, passo a passo"],"metodo":"GET","url":"https://...","cabecalhos":[{"key":"","value":""}],"corpo":"","campos":[{"path":"a.b[0].c","var":"nome_curto","descricao":""}],"mensagem":"resposta ao cliente usando {var.nome_curto}","complexa":false,"observacoes":""}',
        ].join(" ") },
        { role: "user", content: `Sistema: ${system}\nObjetivo: ${goal}` },
      ]);
      if (!r.ok || !r.reply) throw new HttpError(502, r.status === 429 ? "A IA está no limite agora. Tente em 1 minuto." : "A IA não respondeu. Tente de novo.");
      let g: any = {};
      try { g = JSON.parse(r.reply.match(/\{[\s\S]*\}/)?.[0] ?? "{}"); } catch { /* segue com o que der */ }
      const config = cleanConfig({ method: g.metodo, url: g.url, headers: g.cabecalhos, body: g.corpo, map: g.campos });
      // Marcadores que o bloco não preenche = precisa de mais de uma chamada ou dado que não temos.
      const unknown = [config.url, config.body, ...config.headers.map((h: any) => h.value)].join(" ")
        .replace(/\{\{segredo\.[a-z0-9_]+\}\}/g, "").match(/\{(?!telefone\}|nome\}|protocolo\}|var\.)[^}]*\}/g);
      const oauth = /oauth|refresh[_ ]?token|client[_ ]?secret/i.test(`${g.observacoes ?? ""} ${(g.passos_chave ?? []).join(" ")}`);
      const guide = {
        titulo: clip(g.titulo, 120) || `${system}: ${goal.slice(0, 60)}`,
        documentacao: /^https:\/\//.test(String(g.documentacao ?? "")) ? clip(g.documentacao, 300) : null,
        passos_chave: (Array.isArray(g.passos_chave) ? g.passos_chave : []).slice(0, 8)
          .map((p: unknown) => clip(String(p ?? "").replace(/\*\*/g, "").replace(/^\d+[.)]\s*/, ""), 300)).filter(Boolean),
        campos: (Array.isArray(g.campos) ? g.campos : []).slice(0, 20).map((c: any) => ({ path: clip(c?.path, 120), var: slug(c?.var), descricao: clip(c?.descricao, 200) })),
        mensagem: clip(g.mensagem, 1000),
        complexa: g.complexa === true || !!unknown || oauth,
        observacoes: clip([unknown ? `O endereço usa ${[...new Set(unknown)].join(", ")}, que o bloco não preenche sozinho — provavelmente precisa de mais de uma chamada.` : "",
          oauth ? "Este sistema usa login OAuth (token que expira)." : "", String(g.observacoes ?? "").replace(/\*\*/g, "")].filter(Boolean).join(" "), 800),
        segredo: secretName,
      };
      const { data: row, error } = await org.insert("integration_guides", {
        system, goal, title: guide.titulo, guide, config, created_by: ctx.user.id,
      }).select("id").single();
      if (error || !row) throw new HttpError(400, "Não foi possível salvar o guia");
      return json({ ok: true, guide_id: row.id });
    }

    if (action === "update") {
      const g = await loadGuide();
      const config = cleanConfig(body?.config ?? g.config);
      const guide = { ...g.guide, ...(typeof body?.mensagem === "string" ? { mensagem: clip(body.mensagem, 1000) } : {}) };
      await org.update("integration_guides", { config, guide, updated_at: new Date().toISOString() }).eq("id", g.id);
      return json({ ok: true, config });
    }

    if (action === "test") {
      const g = await loadGuide();
      const cfg = cleanConfig(g.config);
      const bad = checkUrl(cfg.url.replace(/\{[^}]*\}/g, "x")).error;
      if (!cfg.url || bad) throw new HttpError(400, `Endereço da API inválido${bad ? `: ${bad}` : ""}. Ajuste no passo 2.`);
      const phone = clip(body?.phone, 20).replace(/\D/g, "") || "5511999999999";
      const out = await runHttp(admin, orgId, cfg, { vars: {}, name: "Cliente Teste", phone, protocol: "TESTE" });
      const paths = out.ok ? leafPaths(out.body) : [];
      if (out.ok) {
        const sample = JSON.stringify(out.body ?? null).slice(0, 8000);
        await org.update("integration_guides", { sample: JSON.parse(JSON.stringify(sample)), status: g.status === "installed" ? "installed" : "tested", updated_at: new Date().toISOString() }).eq("id", g.id);
      }
      return json({ ok: true, result: { ok: out.ok, status: out.status ?? null, ms: out.ms, error: out.error ?? null,
        body: out.ok ? JSON.stringify(out.body, null, 2).slice(0, 4000) : null, paths } });
    }

    if (action === "install") {
      const g = await loadGuide();
      if (g.status === "draft") throw new HttpError(409, "Teste a integração (passo 3) antes de criar o fluxo.");
      const cfg = cleanConfig(g.config);
      const message = clip(g.guide?.mensagem, 1000) || (cfg.map.length ? `Encontrei: ${cfg.map.map((m: any) => `{var.${m.var}}`).join(", ")}` : "Consulta feita!");
      const nodes = [
        { id: "start", type: "start", position: { x: 40, y: 160 }, data: {} },
        { id: "http", type: "http", position: { x: 340, y: 160 }, data: { ...cfg, sample: typeof g.sample === "string" ? g.sample : JSON.stringify(g.sample ?? "") } },
        { id: "ok", type: "message", position: { x: 640, y: 60 }, data: { text: message } },
        { id: "erro", type: "message", position: { x: 640, y: 280 }, data: { text: "Não consegui consultar agora. Vou te passar para um atendente." } },
        { id: "fila", type: "transfer", position: { x: 940, y: 280 }, data: { department_id: null, text: "" } },
      ];
      const edges = [
        { id: "e1", source: "start", sourceHandle: "first_contact", target: "http" },
        { id: "e2", source: "start", sourceHandle: "returning", target: "http" },
        { id: "e3", source: "http", sourceHandle: "success", target: "ok" },
        { id: "e4", source: "http", sourceHandle: "error", target: "erro" },
        { id: "e5", source: "erro", sourceHandle: "next", target: "fila" },
      ];
      const { data: flow, error } = await org.insert("flows", { name: `[Integração] ${g.system}`.slice(0, 80) }).select("id").single();
      if (error || !flow) throw new HttpError(400, "Não foi possível criar o fluxo");
      await org.insert("flow_versions", { flow_id: flow.id, status: "draft", graph: { nodes, edges }, updated_by: ctx.user.id });
      await org.update("integration_guides", { status: "installed", flow_id: flow.id, updated_at: new Date().toISOString() }).eq("id", g.id);
      await admin.from("audit_log").insert({ organization_id: orgId, actor_id: ctx.user.id, actor_type: "ai_agent", agent_key: "integrations",
        action: "integration.install", target: flow.id, meta: { system: g.system, url: cfg.url } });
      return json({ ok: true, flow_id: flow.id });
    }
    throw new HttpError(400, "Ação inválida");
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    console.error("[integrations]", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Erro inesperado" }, 500);
  }
});
