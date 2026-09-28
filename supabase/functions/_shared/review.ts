/**
 * Avaliação automática do atendimento: texto enviado à IA sem dado pessoal
 * óbvio (e-mail, telefone, documento viram "[dado]") e resposta validada.
 */

export function redact(s: string): string {
  return String(s ?? "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[dado]")
    .replace(/\d[\d\s.\-/()]{6,}\d/g, "[dado]");
}

export interface ReviewOut {
  satisfied: "sim" | "nao" | "indefinido";
  score: number;
  reason: string;
  agent_feedback: string;
  process_issues: { falha: string; sugestao: string }[];
}

const cut = (v: unknown, n: number) => redact(String(v ?? "")).trim().slice(0, n);

/** Aceita a resposta da IA só no formato combinado; senão null. */
export function parseReview(reply: string): ReviewOut | null {
  let o: any;
  try { o = JSON.parse(reply.match(/\{[\s\S]*\}/)?.[0] ?? ""); } catch { return null; }
  if (!o || typeof o !== "object") return null;
  const sat = String(o.satisfeito ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const score = Math.round(Number(o.nota));
  if (!Number.isFinite(score)) return null;
  return {
    satisfied: sat === "sim" ? "sim" : sat === "nao" ? "nao" : "indefinido",
    score: Math.min(10, Math.max(0, score)),
    reason: cut(o.motivo, 500),
    agent_feedback: cut(o.feedback_atendente, 800),
    process_issues: (Array.isArray(o.falhas_processo) ? o.falhas_processo : []).slice(0, 5)
      .map((x: any) => ({ falha: cut(x?.falha, 300), sugestao: cut(x?.sugestao, 400) }))
      .filter((x: { falha: string }) => x.falha),
  };
}

export const REVIEW_PROMPT = `Você avalia atendimentos de uma empresa (WhatsApp, e-mail ou voz) para ajudar a equipe a melhorar.
Leia o histórico e os tempos e responda SOMENTE com JSON, sem texto fora dele:
{"satisfeito":"sim|nao|indefinido","nota":0-10,"motivo":"uma frase","feedback_atendente":"o que fez bem e o que melhorar, em 2 a 4 frases, tom respeitoso","falhas_processo":[{"falha":"o que no processo atrapalhou","sugestao":"como a empresa pode corrigir"}]}
Regras: "satisfeito" = como o CLIENTE saiu (pela última parte da conversa). "nota" = qualidade do atendimento da pessoa
(cordialidade, clareza, rapidez, resolveu ou encaminhou). Falhas de processo são da empresa, não da pessoa
(ex.: falta de informação, política confusa, transferência errada, demora na fila); lista vazia se não houver.
Nunca escreva nomes, telefones, e-mails ou documentos. Português do Brasil.`;
