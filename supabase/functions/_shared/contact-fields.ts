/**
 * Campos do contato para fluxo e IA: os padrão (nome, e-mail, CPF/CNPJ) e os
 * personalizados (tipo de registro 'contato', valores em contacts.custom).
 * A validação dos personalizados é do banco (private.clean_values).
 */

export interface FieldDef {
  key: string; label: string; type: string; options?: string[];
  required?: boolean; ai_readable?: boolean; sensitive?: boolean;
}

export const BUILTIN = ["name", "email", "document"];

// deno-lint-ignore no-explicit-any
export async function contactFieldDefs(org: any): Promise<FieldDef[]> {
  const { data } = await org.select("record_types", "fields").eq("key", "contato").maybeSingle();
  return Array.isArray(data?.fields) ? (data.fields as FieldDef[]) : [];
}

/** Grava um campo ('name' | 'email' | 'document' | 'custom:<chave>'). Devolve false se recusado. */
// deno-lint-ignore no-explicit-any
export async function setContactField(org: any, contactId: string, field: string, value: string): Promise<boolean> {
  if (BUILTIN.includes(field)) {
    const { error } = await org.update("contacts", { [field]: value }).eq("id", contactId);
    return !error;
  }
  const key = field.startsWith("custom:") ? field.slice(7) : "";
  if (!/^[a-z0-9_]{1,40}$/.test(key)) return false;
  const { data } = await org.select("contacts", "custom").eq("id", contactId).maybeSingle();
  const { error } = await org.update("contacts", { custom: { ...(data?.custom ?? {}), [key]: value } }).eq("id", contactId);
  return !error;
}

/** Linhas de contexto para a IA: só campos "IA pode ler" e nunca os sensíveis. */
export function aiContactContext(defs: FieldDef[], custom: Record<string, unknown> | null | undefined): string {
  const lines = defs
    .filter((f) => f.ai_readable && !f.sensitive && custom?.[f.key] !== undefined && custom?.[f.key] !== "")
    .map((f) => `- ${f.label}: ${String(custom![f.key]).slice(0, 300)}`);
  return lines.length ? `Dados do cliente:\n${lines.join("\n")}` : "";
}
