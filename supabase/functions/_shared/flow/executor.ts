/**
 * Executor do fluxo (spec fluxo §6.1): escolhe o fluxo publicado, monta o
 * contexto, chama o motor puro e aplica as ações — tudo pela organização do
 * atendimento (forOrg). O motor nunca toca banco, rede nem relógio.
 */
import { forOrg } from "../tenant.ts";
import { callGroq, getAgentConfig } from "../get-ai-config.ts";
import * as providers from "../providers/index.ts";
import { advance, FlowAction, FlowCtx, FlowGraph } from "./engine.ts";

/** A IA sabe o protocolo e informa se o cliente pedir. */
export function withProtocol(prompt: string, protocol?: string | null) {
  return protocol ? `${prompt}

Protocolo deste atendimento: ${protocol}. Informe ao cliente se ele pedir.` : prompt;
}

const ACTIVE = ["running", "waiting_input", "waiting_timer", "ai"];

function nowIn(tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { weekday, minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
}

/**
 * Processa a mensagem do cliente num atendimento em "bot". Devolve false se
 * não há fluxo publicado para o número/organização (o chamador segue com a IA
 * da organização, como antes).
 */
export async function runFlow(p: {
  // deno-lint-ignore no-explicit-any
  admin: any; orgId: string; inst: any; conv: any; ticket: any; text: string;
}): Promise<boolean> {
  const { admin, orgId, inst, conv, ticket, text } = p;
  const org = forOrg(admin, orgId);

  const { data: orgRow } = await admin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  const settings = (orgRow?.settings ?? {}) as Record<string, any>;

  let { data: run } = await org.select("flow_runs")
    .eq("ticket_id", ticket.id).in("state", ACTIVE).maybeSingle();
  let graph: FlowGraph;
  let input: string | null = text;

  if (run) {
    const { data: v } = await org.select("flow_versions", "graph").eq("id", run.flow_version_id).maybeSingle();
    graph = v?.graph as FlowGraph;
  } else {
    const flowId = inst.flow_id ?? settings.default_flow_id ?? null;
    if (!flowId) return false;
    const { data: v } = await org.select("flow_versions", "id, graph")
      .eq("flow_id", flowId).eq("status", "published").maybeSingle();
    if (!v) return false;
    graph = v.graph as FlowGraph;
    const start = graph.nodes.find((n) => n.type === "start");
    if (!start) return false;
    const { data: created, error } = await org.insert("flow_runs", {
      ticket_id: ticket.id, conversation_id: conv.id, flow_version_id: v.id, current_node_id: start.id,
    }).select().single();
    if (error || !created) return false; // outra mensagem criou o run ao mesmo tempo
    run = created;
    input = null; // a primeira mensagem só dispara o início
  }
  if (!graph) return false;

  // Contexto: 1º contato, etiquetas, grupos, horário no fuso da organização.
  const [{ count: prevTickets }, { data: tags }, { data: groups }] = await Promise.all([
    org.select("tickets", "id").eq("conversation_id", conv.id).neq("id", ticket.id).limit(1),
    conv.contact_id ? org.select("contact_tags", "tag_id").eq("contact_id", conv.contact_id) : { data: [] },
    conv.contact_id ? org.select("contact_group_members", "group_id").eq("contact_id", conv.contact_id) : { data: [] },
  ]).then(([a, b, c]: any[]) => [{ count: (a.data ?? []).length }, b, c]);
  const clock = nowIn(settings.timezone || "America/Sao_Paulo");
  const ctx: FlowCtx = {
    firstContact: !prevTickets,
    weekday: clock.weekday,
    minutes: clock.minutes,
    tagIds: (tags ?? []).map((r: any) => r.tag_id),
    groupIds: (groups ?? []).map((r: any) => r.group_id),
    contactName: conv.contact_name ?? "",
    protocol: ticket.protocol ?? "",
    vars: run.vars ?? {},
    attempts: run.attempts ?? 0,
    aiTurns: run.ai_turns ?? 0,
    businessHours: settings.business_hours,
  };

  const result = advance(graph, run.current_node_id, input, ctx);

  // Aplica as ações na ordem.
  const send = async (body: string) => {
    if (!body.trim()) return;
    const sent = await providers.sendText(inst, conv.contact_phone, body);
    await org.insert("messages", {
      conversation_id: conv.id, ticket_id: ticket.id, direction: "outbound", sender: "ai", content: body,
      status: sent.ok ? "sent" : "failed", provider_message_id: sent.messageId ?? null,
      error: sent.ok ? null : (sent.error ?? "falha").slice(0, 300),
    });
  };
  for (const a of result.actions as FlowAction[]) {
    try {
      if (a.type === "send") await send(a.text);
      else if (a.type === "set_field" && conv.contact_id) {
        await org.update("contacts", { [a.field]: a.value }).eq("id", conv.contact_id);
      } else if (a.type === "tag" && conv.contact_id) {
        if (a.remove) await org.delete("contact_tags").eq("contact_id", conv.contact_id).eq("tag_id", a.tagId);
        else await org.insert("contact_tags", { contact_id: conv.contact_id, tag_id: a.tagId });
      } else if (a.type === "ai") {
        const node = graph.nodes.find((n) => n.id === a.nodeId);
        const agent = await getAgentConfig(orgId);
        if (!agent?.apiKey) { await admin.rpc("service_ticket_route", { ticket: ticket.id, action: "queue" }); continue; }
        const { data: history } = await org.select("messages", "direction, content")
          .eq("ticket_id", ticket.id).order("created_at", { ascending: false }).limit(30);
        const chat = [
          { role: "system" as const, content: withProtocol(String(node?.data?.prompt || agent.systemPrompt), ticket.protocol) },
          ...(history ?? []).reverse().map((m: any) => ({
            role: (m.direction === "inbound" ? "user" : "assistant") as "user" | "assistant", content: m.content,
          })),
        ];
        const groq = await callGroq(agent.apiKey, agent.model, chat);
        if (groq.ok && groq.reply) await send(groq.reply);
        else await admin.rpc("service_ticket_route", { ticket: ticket.id, action: "queue" }); // IA fora → humano
      } else if (a.type === "transfer") {
        await admin.rpc("service_ticket_route", {
          ticket: ticket.id, action: "transfer", dept: a.departmentId, to_user: a.userId,
        });
      } else if (a.type === "close") {
        await admin.rpc("service_ticket_route", { ticket: ticket.id, action: "close", reason: a.reasonId });
      } else if (a.type === "queue") {
        await admin.rpc("service_ticket_route", { ticket: ticket.id, action: "queue" });
      }
    } catch (e) {
      console.error("[flow] acao falhou", { type: a.type, message: e instanceof Error ? e.message : String(e) });
    }
  }

  if (result.steps.length) {
    await org.insert("flow_run_steps", result.steps.map((s) => ({
      run_id: run.id, flow_version_id: run.flow_version_id, node_id: s.nodeId, outcome: s.outcome,
    })));
  }
  const ended = result.state === "done" || result.state === "error";
  await org.update("flow_runs", {
    current_node_id: result.currentNodeId,
    state: result.state,
    vars: ended ? {} : result.vars, // minimização: variáveis somem ao fim
    attempts: result.attempts,
    ai_turns: result.aiTurns,
    error: result.error ?? null,
    updated_at: new Date().toISOString(),
    finished_at: ended ? new Date().toISOString() : null,
  }).eq("id", run.id);
  if (result.error) console.error("[flow] erro", { run: run.id, error: result.error });
  return true;
}
