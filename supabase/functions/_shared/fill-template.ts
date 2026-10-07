/**
 * Contrato ou orçamento preenchido com os dados do cliente (Etapa B, item 4). Campos no texto do documento:
 * {{nome}}, {{cpf_cnpj}}, {{email}}, {{telefone}}, {{data}}, {{protocolo}}, {{empresa}} e os campos personalizados da
 * ficha ({{nome_do_campo}}). O que não tiver valor vira "[preencher: campo]" para a pessoa completar — nunca inventa.
 */
const norm = (k: string) => k.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export function fillTemplate(text: string, vars: Record<string, string | null | undefined>): { text: string; faltando: string[] } {
  const map = new Map(Object.entries(vars).map(([k, v]) => [norm(k), String(v ?? "").trim()]));
  const faltando = new Set<string>();
  const out = String(text ?? "").replace(/\{\{\s*([^{}]{1,40}?)\s*\}\}/g, (_m, raw: string) => {
    const v = map.get(norm(raw));
    if (v) return v;
    faltando.add(raw.trim());
    return `[preencher: ${raw.trim()}]`;
  });
  return { text: out, faltando: [...faltando] };
}

export const hasFields = (text: string) => /\{\{\s*[^{}]{1,40}?\s*\}\}/.test(String(text ?? ""));
