/**
 * Bloco "Registro" do fluxo e contexto de registros para a IA. Sempre pela
 * organização do atendimento (forOrg) e só registros do PRÓPRIO contato da
 * conversa. A validação dos valores é do banco (private.clean_values).
 */
import { type FlowCtx, fill } from "./flow/engine.ts";

interface FieldDef { key: string; label: string; type: string; ai_readable?: boolean; sensitive?: boolean }
export interface RecordOutcome { ok: boolean; vars?: Record<string, string>; error?: string }

const show = (f: FieldDef, v: unknown) =>
  f.type === "money" ? Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : f.type === "date" ? String(v).split("-").reverse().join("/")
    : f.type === "boolean" ? (v === true ? "sim" : "não") : String(v);

// deno-lint-ignore no-explicit-any
export async function runRecord(org: any, contactId: string | null, d: Record<string, any>, ctx: FlowCtx): Promise<RecordOutcome> {
  const { data: t } = await org.select("record_types", "id, key, fields, link_contact").eq("id", String(d.type_id ?? "")).maybeSingle();
  if (!t || t.key === "contato") return { ok: false, error: "tipo de registro não encontrado" };
  const fields = (t.fields ?? []) as FieldDef[];
  const mode = ["create", "update", "read"].includes(d.mode) ? d.mode : "create";
  if (mode !== "create" && (!contactId || !t.link_contact)) return { ok: false, error: "registro não ligado a este contato" };

  const values: Record<string, string> = {};
  for (const f of fields) {
    const tpl = (d.values ?? {})[f.key];
    if (typeof tpl === "string" && tpl.trim()) values[f.key] = fill(tpl, ctx).slice(0, 2000);
  }

  if (mode === "create") {
    const { error } = await org.insert("records", { type_id: t.id, contact_id: t.link_contact ? contactId : null, data: values });
    return error ? { ok: false, error: error.message?.slice(0, 200) } : { ok: true };
  }
  const { data: rec } = await org.select("records", "id, data").eq("type_id", t.id).eq("contact_id", contactId)
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!rec) return { ok: false, error: "nenhum registro deste cliente" };
  if (mode === "update") {
    const { error } = await org.update("records", { data: { ...(rec.data ?? {}), ...values } }).eq("id", rec.id);
    return error ? { ok: false, error: error.message?.slice(0, 200) } : { ok: true };
  }
  const vars: Record<string, string> = {};
  for (const f of fields) {
    if (f.sensitive) continue; // sensível nunca vira variável de mensagem
    const v = rec.data?.[f.key];
    if (v !== undefined && v !== null && v !== "") vars[`reg_${f.key}`.slice(0, 40)] = show(f, v).slice(0, 500);
  }
  return { ok: true, vars };
}

/** Registros do cliente que a IA pode ver (tipos liberados no bloco; só "IA pode ler", nunca sensíveis). */
// deno-lint-ignore no-explicit-any
export async function aiRecordsContext(org: any, contactId: string | null, typeIds: string[]): Promise<string> {
  if (!contactId || !typeIds.length) return "";
  const [{ data: types }, { data: recs }] = await Promise.all([
    org.select("record_types", "id, name, fields").in("id", typeIds.slice(0, 10)).neq("key", "contato"),
    org.select("records", "type_id, data, updated_at").eq("contact_id", contactId).in("type_id", typeIds.slice(0, 10))
      .order("updated_at", { ascending: false }).limit(10),
  ]);
  const byId = new Map((types ?? []).map((t: { id: string; name: string; fields: FieldDef[] }) => [t.id, t]));
  const lines = (recs ?? []).map((r: { type_id: string; data: Record<string, unknown> }) => {
    const t = byId.get(r.type_id) as { name: string; fields: FieldDef[] } | undefined;
    if (!t) return "";
    const parts = t.fields.filter((f) => f.ai_readable && !f.sensitive && r.data?.[f.key] !== undefined && r.data?.[f.key] !== "")
      .map((f) => `${f.label}: ${show(f, r.data[f.key]).slice(0, 200)}`);
    return parts.length ? `- ${t.name}: ${parts.join("; ")}` : "";
  }).filter(Boolean);
  return lines.length ? `Registros do cliente (mais recentes):\n${lines.join("\n")}` : "";
}
