/** Campos de registros personalizados (espelham private.check_fields / clean_values). */
export interface FieldDef {
  key: string; label: string; type: FieldType; options?: string[];
  required?: boolean; ai_readable?: boolean; sensitive?: boolean;
}
export type FieldType = "text" | "long_text" | "number" | "money" | "date" | "select" | "boolean" | "email" | "phone";
export type Values = Record<string, unknown>;

export const FIELD_TYPES: Record<FieldType, string> = {
  text: "Texto", long_text: "Texto longo", number: "Número", money: "Valor (R$)", date: "Data",
  select: "Lista de opções", boolean: "Sim / não", email: "E-mail", phone: "Telefone",
};

export interface RecordType {
  id: string; key: string; name: string; description: string | null;
  access: "team" | "managers"; link_contact: boolean; fields: FieldDef[];
}

/** "Data de vencimento" → "data_de_vencimento". */
export function slug(label: string): string {
  return label.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "campo";
}

export function formatValue(f: FieldDef, v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  if (f.type === "money") return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  if (f.type === "date") return new Date(`${v}T12:00:00`).toLocaleDateString("pt-BR");
  if (f.type === "boolean") return v === true ? "Sim" : "Não";
  return String(v);
}
