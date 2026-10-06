/**
 * Aplica a porta de publicação (fatia 7) no servidor: decide pelo modo, guarda a sugestão que não foi
 * enviada, registra o tropeço no disjuntor quando a trava segura a resposta e passa o atendimento para a
 * fila de uma pessoa. Devolve o texto a enviar ao cliente (ou null para não enviar nada).
 */
import { gate, HANDOFF_TEXT, type Mode } from "./publish-gate.ts";
import { guessStage, takeFalta } from "./network.ts";

// deno-lint-ignore no-explicit-any
export async function applyPublishGate(admin: any, orgId: string, mode: Mode,
  conv: { id: string }, ticket: { id: string; department_id?: string | null } | null, raw: string): Promise<string | null> {
  // Rede de agentes (fatia 8): o que faltou nas informações da empresa vira pergunta para o time (sobe pela hierarquia).
  const { reply: semFalta, falta } = takeFalta(raw);
  if (falta) {
    try {
      await admin.rpc("service_agent_task_create", {
        org: orgId, p_from_key: "exec:geral", p_kind: "pedir_informacao", p_pergunta: falta,
        p_contexto: "Um cliente perguntou e a informação não estava nos dados da empresa.", p_etapa: guessStage(falta),
      });
    } catch (e) {
      console.error("[publish] pergunta para o time não registrada", e instanceof Error ? e.message : e);
    }
  }
  const g = gate(mode, semFalta);
  if (g.send) return g.reply;
  try {
    await admin.rpc("service_ai_suggestion_save", {
      org: orgId, p_conv: conv.id, p_ticket: ticket?.id ?? null, p_content: g.suggestion || "(sem texto)", p_mode: mode, p_motivo: g.motivo, p_guard: g.guard,
    });
    if (g.motivo === "bloqueio") await admin.rpc("service_breaker_event", { org: orgId, p_kind: "guard_block", p_detail: g.guard.join(","), p_conv: conv.id });
    if (ticket) await admin.rpc("service_ticket_route", { ticket: ticket.id, action: "queue", dept: ticket.department_id ?? null });
  } catch (e) {
    console.error("[publish] não registrou a sugestão", e instanceof Error ? e.message : e);
  }
  // Sombra: a pessoa responde (o cliente não recebe nada da IA). Nos outros casos, um aviso curto e seguro.
  return mode === "sombra" ? null : HANDOFF_TEXT;
}
