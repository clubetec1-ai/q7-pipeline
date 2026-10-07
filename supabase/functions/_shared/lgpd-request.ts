/**
 * Pedido do titular pelo WhatsApp (LGPD art. 18; roadmap Etapa B, item 6): reconhece quando o cliente pede para apagar
 * os dados dele. Regra fixa (sem IA), conservadora: precisa de um verbo de apagar + "meus dados" (ou "esquecimento").
 */
const PEDIDO = [
  /\b(apag|exclu|remov|delet|elimin)\w*\s+(todos\s+)?(os\s+)?(meus\s+dados|dados\s+meus|meu\s+cadastro|minhas\s+informa[çc][õo]es)/i,
  /\bdireito\s+(ao|de)\s+esquecimento\b/i,
  /\b(quero|gostaria|solicito|pe[çc]o)\b[^.?!]{0,30}\b(apagar|excluir|remover|deletar)\b[^.?!]{0,20}\bdados\b/i,
];
const NEGA = /\b(n[ãa]o|nunca)\s+(quero\s+)?(apag|exclu|remov|delet)/i;

export function isDataDeletionRequest(text: string): boolean {
  const t = String(text ?? "").slice(0, 500);
  if (t.length < 8 || NEGA.test(t)) return false;
  return PEDIDO.some((re) => re.test(t));
}

export const LGPD_REPLY =
  "Recebemos seu pedido para apagar os seus dados (LGPD). A empresa vai analisar e responder por aqui em até 15 dias. " +
  "Alguns dados podem precisar ficar guardados por obrigação legal; se for o caso, explicaremos o motivo.";
