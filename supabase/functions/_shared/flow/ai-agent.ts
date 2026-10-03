/**
 * Bloco "Agente de IA" com ferramentas (spec fluxo §7). O que a IA pode fazer
 * vem de listas fechadas no bloco; as ferramentas são geradas com enum só com
 * esses itens e o executor REVALIDA cada chamada contra o bloco e o banco
 * (mesma organização, ativo). Chamada inválida é descartada e registrada.
 */
import { forOrg } from "../tenant.ts";
import { getAgentProfile } from "../get-ai-config.ts";
import { chatAI, type ChatMsg, resolveAI, type ToolDef } from "../ai-chat.ts";
import { toChatText } from "../ai-policy.ts";
import { validate } from "./engine.ts";
import { aiContactContext, contactFieldDefs, setContactField } from "../contact-fields.ts";
import { companyKnowledge } from "../company.ts";
import { aiRecordsContext } from "../records.ts";
import { withMediaText } from "../media-read.ts";
import { knowledgeContext } from "../knowledge.ts";

const DEFAULT_PROMPT = "Você é um assistente de atendimento simpático e objetivo.";
const FIELDS: Record<string, { label: string; kind: string }> = {
  name: { label: "nome", kind: "text" },
  email: { label: "email", kind: "email" },
  document: { label: "cpf_cnpj", kind: "cpf_cnpj" },
};

const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 50) : []) as string[];

/** Nome → id, só dos itens permitidos no bloco que existem na organização. */
// deno-lint-ignore no-explicit-any
async function allowed(org: any, table: string, list: string[], extra?: (q: any) => any) {
  if (!list.length) return new Map<string, string>();
  let q = org.select(table, "id, name").in("id", list);
  if (extra) q = extra(q);
  const { data } = await q;
  return new Map<string, string>((data ?? []).map((r: { id: string; name: string }) => [String(r.name).slice(0, 80), r.id]));
}

export async function runAiAgent(p: {
  // deno-lint-ignore no-explicit-any
  admin: any; orgId: string; node: { id: string; data: Record<string, any> }; ticket: any; conv: any;
  send: (text: string) => Promise<unknown>;
  sendFile: (fileId: string) => Promise<unknown>;
  route: (args: Record<string, unknown>) => Promise<unknown>;
}): Promise<{ ended: boolean }> {
  const { admin, orgId, node, ticket, conv, send, sendFile, route } = p;
  const d = node.data ?? {};
  const org = forOrg(admin, orgId);
  // Provedor do bloco, senão o padrão da empresa (Configurações → Chaves de IA), senão Groq.
  const [ai, agent] = await Promise.all([
    resolveAI(admin, orgId, { provider: typeof d.provider === "string" ? d.provider : null, model: typeof d.model === "string" ? d.model : null }),
    getAgentProfile(admin, orgId),
  ]);
  if (!ai) { await route({ action: "queue" }); return { ended: true }; }
  const { provider } = ai;

  const [depts, reasons, stages, files] = await Promise.all([
    allowed(org, "departments", ids(d.allow_departments)),
    allowed(org, "close_reasons", ids(d.allow_close_reasons), (q) => q.eq("active", true)),
    allowed(org, "pipeline_stages", ids(d.allow_stages)),
    allowed(org, "library_files", ids(d.allow_files)),
  ]);
  // Campos que a IA pode preencher: padrão ou personalizados (nunca os sensíveis).
  const [defs, { data: contactRow }, knowledge, recordsCtx] = await Promise.all([
    contactFieldDefs(org),
    conv.contact_id ? org.select("contacts", "custom").eq("id", conv.contact_id).maybeSingle() : Promise.resolve({ data: null }),
    companyKnowledge(org),
    aiRecordsContext(org, conv.contact_id ?? null, ids(d.allow_record_types)),
  ]);
  const customDef = (f: string) => defs.find((x) => `custom:${x.key}` === f && !x.sensitive);
  const fields = ids(d.allow_fields).filter((f) => FIELDS[f] || customDef(f));
  const labelOf = (f: string) => FIELDS[f]?.label ?? customDef(f)!.label;

  const tools: ToolDef[] = [];
  if (depts.size) tools.push({
    name: "transferir_atendimento", description: "Transfere o cliente para um departamento humano.",
    parameters: { type: "object", properties: { departamento: { type: "string", enum: [...depts.keys()] } }, required: ["departamento"] },
  });
  if (reasons.size) tools.push({
    name: "finalizar_atendimento", description: "Encerra o atendimento quando o assunto foi resolvido.",
    parameters: { type: "object", properties: { motivo: { type: "string", enum: [...reasons.keys()] } }, required: ["motivo"] },
  });
  if (stages.size) tools.push({
    name: "mover_etapa", description: "Move o cliente para uma etapa do funil de vendas.",
    parameters: { type: "object", properties: { etapa: { type: "string", enum: [...stages.keys()] } }, required: ["etapa"] },
  });
  if (files.size) tools.push({
    name: "enviar_arquivo", description: "Envia ao cliente um arquivo da empresa (catálogo, tabela de preços, manual...).",
    parameters: { type: "object", properties: { arquivo: { type: "string", enum: [...files.keys()] } }, required: ["arquivo"] },
  });
  if (fields.length) tools.push({
    name: "salvar_dado_cliente", description: "Guarda um dado que o cliente informou na ficha dele.",
    parameters: {
      type: "object",
      properties: { campo: { type: "string", enum: fields.map(labelOf) }, valor: { type: "string" } },
      required: ["campo", "valor"],
    },
  });

  const { data: history } = await org.select("messages", "direction, content, media_text, type")
    .eq("ticket_id", ticket.id).order("created_at", { ascending: false }).limit(30);
  const first = String(conv.contact_name ?? "").trim().split(/\s+/)[0];
  // Base de conhecimento: só documentos liberados para atendimento, do setor do atendimento + empresa toda.
  const lastIn = String((history ?? []).find((m: { direction: string }) => m.direction === "inbound")?.content ?? "");
  const docs = await knowledgeContext(admin, orgId, lastIn, "cliente", ticket?.department_id ? [ticket.department_id] : null);
  const system = [
    String(d.prompt || agent.systemPrompt || DEFAULT_PROMPT),
    ticket.protocol ? `Protocolo deste atendimento: ${ticket.protocol}. Informe ao cliente se ele pedir.` : "",
    first ? `Primeiro nome do cliente: ${first}.` : "",
    aiContactContext(defs, contactRow?.custom as Record<string, unknown> | null),
    knowledge,
    docs,
    recordsCtx,
    tools.length ? "Use as ferramentas só quando o cliente pedir ou quando for claramente necessário. Nunca invente dados." : "",
  ].filter(Boolean).join("\n\n");
  const messages: ChatMsg[] = [
    { role: "system", content: system },
    ...(history ?? []).reverse().map((m: any) => ({
      role: (m.direction === "inbound" ? "user" : "assistant") as "user" | "assistant", content: withMediaText(String(m.content ?? ""), m.media_text, m.type),
    })),
  ];

  const r = await chatAI(ai, messages, tools);
  if (!r.ok) {
    console.error("[flow/ia] falhou", { provider, status: r.status, error: r.error });
    await route({ action: "queue" }); // IA fora → humano
    return { ended: true };
  }

  const audit = (action: string, meta: Record<string, unknown>) =>
    admin.from("audit_log").insert({
      organization_id: orgId, actor_type: "ai_agent", agent_key: node.id, action, target: String(ticket.id), meta,
    });
  let terminal: Record<string, unknown> | null = null;
  const results: ChatMsg[] = [];
  for (const c of r.toolCalls ?? []) {
    let outcome = "negado";
    const arg = (k: string) => String(c.args?.[k] ?? "");
    if (c.name === "transferir_atendimento" && depts.has(arg("departamento")) && !terminal) {
      terminal = { action: "transfer", dept: depts.get(arg("departamento")) };
      outcome = "ok";
    } else if (c.name === "finalizar_atendimento" && reasons.has(arg("motivo")) && !terminal) {
      terminal = { action: "close", reason: reasons.get(arg("motivo")) };
      outcome = "ok";
    } else if (c.name === "enviar_arquivo" && files.has(arg("arquivo"))) {
      outcome = (await sendFile(files.get(arg("arquivo"))!)) === false ? "erro" : "ok";
    } else if (c.name === "mover_etapa" && stages.has(arg("etapa"))) {
      const { error } = await org.update("conversations", { stage_id: stages.get(arg("etapa")) }).eq("id", conv.id);
      outcome = error ? "erro" : "ok";
    } else if (c.name === "salvar_dado_cliente" && conv.contact_id) {
      const field = fields.find((f) => labelOf(f) === arg("campo"));
      // Padrão: validado aqui; personalizado: validado pelo banco (tipo do campo).
      const value = field ? (FIELDS[field] ? validate(FIELDS[field].kind, arg("valor").slice(0, 120)) : arg("valor").slice(0, 500)) : null;
      if (field && value !== null) outcome = (await setContactField(org, conv.contact_id, field, value)) ? "ok" : "valor inválido";
      else outcome = "valor inválido";
    }
    // Registro sem o conteúdo informado pelo cliente (minimização).
    await audit(`ai.${c.name.slice(0, 40)}`, { outcome, ...(c.name === "salvar_dado_cliente" ? { campo: arg("campo") } : {}) });
    results.push({ role: "tool", tool_call_id: c.id, content: outcome });
  }

  if (r.reply) await send(toChatText(r.reply));
  else if (results.length && !terminal) {
    // Só ferramentas, sem texto: pede a resposta ao cliente já sabendo o resultado.
    const again = await chatAI(ai, [...messages, r.raw, ...results]);
    if (again.ok && again.reply) await send(toChatText(again.reply));
  }
  if (terminal) { await route(terminal); return { ended: true }; }
  return { ended: false };
}
