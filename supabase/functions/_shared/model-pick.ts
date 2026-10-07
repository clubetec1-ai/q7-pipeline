/**
 * Detecção de modelos novos — SÓ PARA SUGERIR, nunca aplicar (primeira premissa: nada muda sozinho). Uso futuro no vigia
 * de modelos: encontra o candidato mais novo de cada nível entre os modelos da conta; o candidato passa pela bateria de
 * testes, vira sugestão para o cérebro, recebe a revisão de segurança e só é adotado com aprovação da equipe Clubetec.
 * Regra pura e testada.
 */
import type { AITask } from "./get-ai-config.ts";

const FAMILY = /^gpt-(\d+(?:\.\d+)?)(?:-(mini|nano))?$/;

/** Candidato (sugestão) do nível; o modelo em uso continua o aprovado. */
export function pickOpenAI(ids: string[], tier: AITask | undefined): string {
  const fam = ids.map((id) => ({ id, m: FAMILY.exec(id) })).filter((x) => x.m)
    .map((x) => ({ id: x.id, v: Number(x.m![1]), size: x.m![2] ?? "full" }));
  const best = (size: string, minV = 0) => fam.filter((x) => x.size === size && x.v >= minV).sort((a, b) => b.v - a.v)[0]?.id;
  if (tier === "maxima") return best("full", 4.1) ?? (ids.includes("gpt-4o") ? "gpt-4o" : best("mini") ?? "gpt-4o-mini");
  if (tier === "analise") return best("mini", 4.1) ?? best("full", 4.1) ?? "gpt-4o-mini";
  return ids.includes("gpt-4o-mini") ? "gpt-4o-mini" : best("mini") ?? "gpt-4o-mini";
}

/** Modelos que "raciocinam" antes de responder: outros parâmetros (e esforço menor para gastar menos tokens). */
export const isReasoning = (model: string) => /^(gpt-5|o\d)/.test(model);
export const effortFor = (tier: AITask | undefined) => (tier === "maxima" ? "medium" : "low");
