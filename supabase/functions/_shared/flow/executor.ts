/**
 * Executor do fluxo (spec fluxo §6.1): escolhe o fluxo publicado, monta o
 * contexto, chama o motor puro e aplica as ações — tudo pela organização do
 * atendimento (forOrg). O motor nunca toca banco, rede nem relógio.
 */
import { forOrg } from "../tenant.ts";
import { getUazapiConfig } from "../get-uazapi-config.ts";
import { getSecret, withInstanceToken } from "../secrets.ts";
import * as providers from "../providers/index.ts";
import { advance, FlowAction, FlowCtx, FlowGraph, mapResponse } from "./engine.ts";
import { callHttp, type HttpOutcome, type HttpVars, secretNames } from "./http.ts";
import { runAiAgent } from "./ai-agent.ts";
import { sendLibraryFile } from "../library.ts";
import { setContactField } from "../contact-fields.ts";
import { runRecord } from "../records.ts";
import { runConnectorAction } from "../connectors.ts";

/** A IA sabe o protocolo e informa se o cliente pedir. */
export function withProtocol(prompt: string, protocol?: string | null) {
  return protocol ? `${prompt}

Protocolo deste atendimento: ${protocol}. Informe ao cliente se ele pedir.` : prompt;
}

const ACTIVE = ["running", "waiting_input", "waiting_timer", "ai"];
const DEFAULT_OPT_OUT = ["sair", "parar"];
const DEFAULT_OPT_OUT_REPLY =
  "Pronto, você não vai mais receber mensagens automáticas. Se precisar, é só mandar mensagem.";

function nowIn(tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { weekday, minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
}

const bare = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N} ]/gu, "").trim().toLowerCase();

/** Número pronto para enviar: token do Vault e, na Uazapi antiga, o ajuste global. */
// deno-lint-ignore no-explicit-any
export async function instForSend(admin: any, inst: any) {
  const row = await withInstanceToken(admin, inst);
  if (providers.providerOf(row) === "uazapi" && !row.server_url) {
    const uaz = await getUazapiConfig();
    row.server_url = uaz?.serverUrl ?? null;
    row.instance_token = row.instance_token || uaz?.instanceToken || null;
  }
  return row;
}

// deno-lint-ignore no-explicit-any
async function sendAndStore(org: any, inst: any, conv: any, ticketId: string, body: string) {
  if (!body.trim()) return;
  const sent = await providers.sendText(inst, conv.contact_phone, body);
  await org.insert("messages", {
    conversation_id: conv.id, ticket_id: ticketId, direction: "outbound", sender: "ai", content: body,
    status: sent.ok ? "sent" : "failed", provider_message_id: sent.messageId ?? null,
    error: sent.ok ? null : (sent.error ?? "falha").slice(0, 300),
  });
}

/**
 * Opt-out (spec fluxo §9): mensagem igual a uma palavra da lista grava
 * `opted_out_at` e confirma. Devolve true se a mensagem era um pedido de saída.
 */
export async function handleOptOut(p: {
  // deno-lint-ignore no-explicit-any
  admin: any; orgId: string; inst: any; conv: any; ticket: any; text: string;
}): Promise<boolean> {
  const { admin, orgId, inst, conv, ticket, text } = p;
  if (!conv.contact_id || !text || text.length > 40) return false;
  const { data: orgRow } = await admin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  const settings = (orgRow?.settings ?? {}) as Record<string, any>;
  const words = (Array.isArray(settings.opt_out_words) && settings.opt_out_words.length
    ? settings.opt_out_words : DEFAULT_OPT_OUT).map((w: unknown) => bare(String(w))).filter(Boolean);
  if (!words.includes(bare(text))) return false;
  const org = forOrg(admin, orgId);
  const { data: changed } = await org.update("contacts", { opted_out_at: new Date().toISOString() })
    .eq("id", conv.contact_id).is("opted_out_at", null).select("id");
  if (!changed?.length) return true; // já tinha saído: não repete a confirmação
  await admin.from("audit_log").insert({
    organization_id: orgId, actor_type: "system", action: "contact.opt_out", target: String(conv.contact_id),
  });
  const reply = typeof settings.opt_out_reply === "string" ? settings.opt_out_reply : DEFAULT_OPT_OUT_REPLY;
  await sendAndStore(org, inst, conv, ticket.id, reply);
  return true;
}

/** Chamada do bloco HTTP: limite por organização e segredos só do bloco. */
// deno-lint-ignore no-explicit-any
export async function runHttp(admin: any, orgId: string, d: Record<string, any>, v: HttpVars): Promise<HttpOutcome> {
  const { data: allowed } = await admin.rpc("service_http_take", { org: orgId });
  if (allowed !== true) return { ok: false, ms: 0, error: "limite de 60 chamadas por minuto" };
  const secrets: Record<string, string> = {};
  for (const name of secretNames(d)) {
    const value = await getSecret(admin, `org:${orgId}:http:${name}`);
    if (!value) return { ok: false, ms: 0, error: `segredo não encontrado: ${name}` };
    secrets[name] = value;
  }
  return await callHttp(d, v, secrets);
}

export type FlowOutcome = false | "handled" | "passthrough";

/**
 * Processa um estímulo do fluxo: mensagem do cliente (`text`) ou relógio
 * (`timer`). Devolve false se não há fluxo para o atendimento (o chamador
 * segue com a IA da organização, como antes); "passthrough" quando o
 * pós-atendimento recusou a mensagem e ela deve seguir o caminho normal.
 */
export async function runFlow(p: {
  // deno-lint-ignore no-explicit-any
  admin: any; orgId: string; inst: any; conv: any; ticket: any; text: string | null;
  // deno-lint-ignore no-explicit-any
  timer?: boolean; run?: any; beforeApply?: () => Promise<unknown>;
}): Promise<FlowOutcome> {
  const { admin, orgId, inst, conv, ticket } = p;
  const org = forOrg(admin, orgId);
  const closed = ticket.status === "closed";

  const { data: orgRow } = await admin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  const settings = (orgRow?.settings ?? {}) as Record<string, any>;

  let run = p.run;
  if (!run) {
    ({ data: run } = await org.select("flow_runs").eq("ticket_id", ticket.id).in("state", ACTIVE).maybeSingle());
  }
  let graph: FlowGraph;
  let input: string | null = p.timer ? null : (p.text ?? "");

  if (run) {
    const { data: v } = await org.select("flow_versions", "graph").eq("id", run.flow_version_id).maybeSingle();
    graph = v?.graph as FlowGraph;
  } else {
    if (closed || p.timer) return false; // só atendimento em "bot" começa fluxo novo
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
  const [{ count: prevTickets }, { data: tags }, { data: groups }, { data: contact }] = await Promise.all([
    org.select("tickets", "id").eq("conversation_id", conv.id).neq("id", ticket.id).limit(1),
    conv.contact_id ? org.select("contact_tags", "tag_id").eq("contact_id", conv.contact_id) : { data: [] },
    conv.contact_id ? org.select("contact_group_members", "group_id").eq("contact_id", conv.contact_id) : { data: [] },
    conv.contact_id ? org.select("contacts", "opted_out_at").eq("id", conv.contact_id).maybeSingle() : { data: null },
  ]).then(([a, b, c, d]: any[]) => [{ count: (a.data ?? []).length }, b, c, d]);
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
    timerFired: !!p.timer,
    businessHours: settings.business_hours,
  };

  let result = advance(graph, run.current_node_id, input, ctx);
  const actions = result.actions as FlowAction[];
  const steps = [...result.steps];
  let outcome: FlowOutcome = "handled";
  let routed = false; // atendimento saiu do robô (fila, transferência, fim) → run termina
  if (result.passthrough) {
    if (closed) outcome = "passthrough";
    else actions.push({ type: "queue" }); // dentro do atendimento: segue para a fila
  }

  if (outcome === "handled") {
    await p.beforeApply?.();
    // Mensagem que o cliente não pediu (relógio) respeita o opt-out.
    const muted = !!p.timer && !!contact?.opted_out_at;
    const send = (body: string) => (muted ? Promise.resolve() : sendAndStore(org, inst, conv, ticket.id, body));
    const sendFile = (fileId: string, caption?: string) => (muted ? Promise.resolve(false) : sendLibraryFile({
      admin, orgId, inst, conv, ticketId: ticket.id, fileId, caption, sender: "ai",
    }));
    const route = async (args: Record<string, unknown>) => {
      routed = true;
      if (!closed) await admin.rpc("service_ticket_route", { ticket: ticket.id, ...args });
    };

    const apply = async (list: FlowAction[]) => {
      for (const a of list) {
        if (routed) break; // depois de sair do robô, nada mais do fluxo roda
        try {
          if (a.type === "send") await (a.fileId ? sendFile(a.fileId, a.text) : send(a.text));
          else if (a.type === "set_field" && conv.contact_id) {
            await setContactField(org, conv.contact_id, a.field, a.value);
          } else if (a.type === "tag" && conv.contact_id) {
            if (a.remove) await org.delete("contact_tags").eq("contact_id", conv.contact_id).eq("tag_id", a.tagId);
            else await org.insert("contact_tags", { contact_id: conv.contact_id, tag_id: a.tagId });
          } else if (a.type === "rating") {
            await org.update("tickets", { rating: a.value }).eq("id", ticket.id);
          } else if (a.type === "rating_comment") {
            await org.update("tickets", { rating_comment: a.text }).eq("id", ticket.id);
          } else if (a.type === "ai") {
            if (closed) continue;
            const node = graph.nodes.find((n) => n.id === a.nodeId);
            if (node) await runAiAgent({ admin, orgId, node, ticket, conv, send, sendFile, route });
          } else if (a.type === "transfer") {
            await route({ action: "transfer", dept: a.departmentId, to_user: a.userId });
          } else if (a.type === "close") {
            await route({ action: "close", reason: a.reasonId });
          } else if (a.type === "queue") {
            await route({ action: "queue" });
          }
        } catch (e) {
          console.error("[flow] acao falhou", { type: a.type, message: e instanceof Error ? e.message : String(e) });
        }
      }
    };

    await apply(actions);
    // Bloco HTTP: o executor chama e o motor segue por success/error.
    for (let hops = 0; (result.state === "http" || result.state === "record" || result.state === "connector") && !routed; hops++) {
      const node = graph.nodes.find((n) => n.id === result.currentNodeId);
      if (!node || hops >= 10) {
        result = { ...result, state: "error", currentNodeId: null, error: "muitas etapas automáticas seguidas" };
        await route({ action: "queue" });
        break;
      }
      if (result.state === "connector") {
        // Conector pronto (ex.: Bling): sempre com o telefone do próprio cliente da conversa.
        const d = node.data ?? {};
        const out = await runConnectorAction(admin, orgId, String(d.connector ?? ""), String(d.connector_action ?? ""),
          { phone: conv.contact_phone ?? "", vars: result.vars });
        if (!out.ok) console.log("[flow/conector]", { node: node.id, error: out.error });
        result = advance(graph, node.id, null, {
          ...ctx, timerFired: false, attempts: result.attempts, aiTurns: result.aiTurns,
          vars: { ...result.vars, ...(out.vars ?? {}) }, connectorResult: out.ok ? "success" : "error",
        });
        steps.push(...result.steps);
        await apply(result.actions as FlowAction[]);
        continue;
      }
      if (result.state === "record") {
        // Bloco Registro: só da organização e do próprio contato da conversa.
        const rec = await runRecord(org, conv.contact_id ?? null, node.data ?? {}, { ...ctx, vars: result.vars });
        if (!rec.ok) console.log("[flow/registro]", { node: node.id, error: rec.error });
        result = advance(graph, node.id, null, {
          ...ctx, timerFired: false, attempts: result.attempts, aiTurns: result.aiTurns,
          vars: { ...result.vars, ...(rec.vars ?? {}) }, recordResult: rec.ok ? "success" : "error",
        });
        steps.push(...result.steps);
        await apply(result.actions as FlowAction[]);
        continue;
      }
      const out = await runHttp(admin, orgId, node.data ?? {}, {
        vars: result.vars, name: conv.contact_name ?? "", phone: conv.contact_phone ?? "", protocol: ticket.protocol ?? "",
      });
      console.log("[flow/http]", { node: node.id, ok: out.ok, status: out.status, ms: out.ms, error: out.error });
      result = advance(graph, node.id, null, {
        ...ctx, timerFired: false, attempts: result.attempts, aiTurns: result.aiTurns,
        vars: out.ok ? mapResponse(out.body, node.data?.map, result.vars) : result.vars,
        httpResult: out.ok ? "success" : "error",
      });
      steps.push(...result.steps);
      await apply(result.actions as FlowAction[]);
    }
  }
  if (routed && result.state !== "error") result = { ...result, state: "done", currentNodeId: null };

  if (steps.length) {
    await org.insert("flow_run_steps", steps.map((s) => ({
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
    wait_until: !ended && result.waitMinutes ? new Date(Date.now() + result.waitMinutes * 60_000).toISOString() : null,
    error: result.error ?? null,
    updated_at: new Date().toISOString(),
    finished_at: ended ? new Date().toISOString() : null,
  }).eq("id", run.id);
  if (result.error) console.error("[flow] erro", { run: run.id, error: result.error });
  return outcome;
}

/**
 * Pós-atendimento (spec fluxo §6.3): se a conversa tem um run esperando
 * resposta num atendimento já finalizado, a mensagem vai para ele. Devolve
 * true se foi consumida; false = seguir o caminho normal (abre atendimento).
 */
export async function runPostClose(p: {
  // deno-lint-ignore no-explicit-any
  admin: any; orgId: string; conv: any; text: string;
  // deno-lint-ignore no-explicit-any
  loadInst: () => Promise<any>; storeInbound: (ticketId: string) => Promise<unknown>;
}): Promise<boolean> {
  const org = forOrg(p.admin, p.orgId);
  const { data: run } = await org.select("flow_runs")
    .eq("conversation_id", p.conv.id).eq("state", "waiting_input").maybeSingle();
  if (!run) return false;
  const { data: ticket } = await org.select("tickets").eq("id", run.ticket_id).maybeSingle();
  if (!ticket || ticket.status !== "closed") return false;
  const inst = await p.loadInst();
  const r = await runFlow({
    admin: p.admin, orgId: p.orgId, inst, conv: p.conv, ticket, text: p.text, run,
    beforeApply: () => p.storeInbound(ticket.id),
  });
  return r === "handled";
}
