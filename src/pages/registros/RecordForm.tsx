import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { FieldDef, Values } from "./fields";

/** Formulário gerado pelos campos do tipo. A validação final é do banco. */
export function RecordForm({ fields, values, onChange }: { fields: FieldDef[]; values: Values; onChange: (v: Values) => void }) {
  const set = (k: string, v: unknown) => onChange({ ...values, [k]: v });
  const str = (k: string) => (values[k] === undefined || values[k] === null ? "" : String(values[k]));
  return (
    <div className="space-y-3">
      {fields.map((f) => (
        <div key={f.key} className="space-y-1">
          <Label className="text-xs">{f.label}{f.required ? " *" : ""}</Label>
          {f.type === "long_text" ? (
            <Textarea rows={3} maxLength={10000} value={str(f.key)} onChange={(e) => set(f.key, e.target.value)} />
          ) : f.type === "select" ? (
            <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={str(f.key)} onChange={(e) => set(f.key, e.target.value)}>
              <option value="">—</option>
              {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : f.type === "boolean" ? (
            <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={str(f.key)}
              onChange={(e) => set(f.key, e.target.value === "" ? "" : e.target.value === "true")}>
              <option value="">—</option><option value="true">Sim</option><option value="false">Não</option>
            </select>
          ) : (
            <Input
              type={f.type === "date" ? "date" : f.type === "email" ? "email" : f.type === "number" || f.type === "money" ? "text" : "text"}
              inputMode={f.type === "number" || f.type === "money" ? "decimal" : f.type === "phone" ? "tel" : undefined}
              placeholder={f.type === "money" ? "0,00" : undefined} maxLength={2000}
              value={str(f.key)} onChange={(e) => set(f.key, e.target.value)} />
          )}
        </div>
      ))}
    </div>
  );
}
