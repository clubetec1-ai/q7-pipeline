/**
 * Porta única de publicação (desenho 07, fatia 7): toda resposta da IA ao cliente — WhatsApp, Facebook/
 * Instagram e e-mail — passa por aqui antes de sair.
 *  - sombra: nunca envia; vira sugestão para a pessoa da equipe;
 *  - assistido: envia só o que a própria IA marcou [SIMPLES]; o resto vai para uma pessoa;
 *  - automatico: envia.
 * Em qualquer modo, a trava fixa (prometer, pedir senha, expor dado pessoal) segura a resposta e conta
 * para o disjuntor. A marca [SIMPLES]/[PESSOA] nunca chega ao cliente.
 */
import { checkReply } from "./proof.ts";

export type Mode = "sombra" | "assistido" | "automatico";
export interface GateOut { send: boolean; reply: string; suggestion: string; motivo: "ok" | "sombra" | "precisa_pessoa" | "bloqueio"; guard: string[] }

export const MODE_RULE = "Ao final da resposta, numa linha separada, escreva [SIMPLES] se ela é uma informação direta que está nas " +
  "informações da empresa, ou [PESSOA] se o caso precisa de uma pessoa (reclamação, negociação, exceção, algo que você não sabe ou não " +
  "pode decidir). Se o cliente perguntou algo sobre a empresa que NÃO está nas informações, escreva também, numa linha " +
  "separada, [FALTA: a pergunta curta, sem nome, telefone ou dado do cliente]. Essas marcas são internas e não aparecem para o cliente.";
export const HANDOFF_TEXT = "Vou chamar alguém da nossa equipe para te ajudar, só um instante.";

const MARK = /\[(SIMPLES|PESSOA)\]/gi;

export function gate(mode: Mode, raw: string): GateOut {
  const marks = [...String(raw ?? "").matchAll(MARK)].map((m) => m[1].toUpperCase());
  const reply = String(raw ?? "").replace(MARK, "").replace(/[ \t]+\n/g, "\n").trim();
  const guard = checkReply(reply, ["nao_promete", "nao_pede_senha", "nao_revela_dados"]).filter((c) => !c.ok).map((c) => c.criterio);
  const base = { reply, suggestion: reply, guard };
  if (guard.length) return { ...base, send: false, motivo: "bloqueio" };
  if (mode === "sombra") return { ...base, send: false, motivo: "sombra" };
  if (mode === "assistido" && marks[marks.length - 1] !== "SIMPLES") return { ...base, send: false, motivo: "precisa_pessoa" };
  return { ...base, send: true, motivo: "ok" };
}
