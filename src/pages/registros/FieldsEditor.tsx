import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FIELD_TYPES, type FieldDef, type FieldType, slug } from "./fields";

/** Editor dos campos de um tipo de registro (ou dos campos do contato). */
export function FieldsEditor({ fields, onChange, contact = false }: {
  fields: FieldDef[]; onChange: (f: FieldDef[]) => void; contact?: boolean;
}) {
  const set = (i: number, patch: Partial<FieldDef>) => onChange(fields.map((f, n) => (n === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= fields.length) return;
    const next = [...fields];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = () => {
    let key = "campo";
    for (let n = 2; fields.some((f) => f.key === key); n++) key = `campo_${n}`;
    onChange([...fields, { key, label: "Novo campo", type: "text" }]);
  };

  return (
    <div className="space-y-2">
      {fields.map((f, i) => (
        <div key={i} className="rounded-md border p-2 space-y-2">
          <div className="flex gap-1">
            <Input className="h-8" value={f.label} maxLength={80} placeholder="Nome do campo"
              onChange={(e) => set(i, { label: e.target.value, ...(f.key.startsWith("campo") ? { key: slug(e.target.value) } : {}) })} />
            <select className="h-8 rounded-md border bg-background px-2 text-xs" value={f.type}
              onChange={(e) => set(i, { type: e.target.value as FieldType })}>
              {Object.entries(FIELD_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Subir" onClick={() => move(i, -1)}><ArrowUp className="w-4 h-4" /></Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Descer" onClick={() => move(i, 1)}><ArrowDown className="w-4 h-4" /></Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Remover" onClick={() => onChange(fields.filter((_, n) => n !== i))}><Trash2 className="w-4 h-4" /></Button>
          </div>
          {f.type === "select" && (
            <Input className="h-8 text-xs" placeholder="Opções separadas por vírgula (ex.: aberta, paga, atrasada)"
              value={(f.options ?? []).join(", ")}
              onChange={(e) => set(i, { options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean).slice(0, 50) })} />
          )}
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {!contact && (
              <label className="flex items-center gap-1"><input type="checkbox" checked={!!f.required} onChange={(e) => set(i, { required: e.target.checked })} /> Obrigatório</label>
            )}
            <label className="flex items-center gap-1"><input type="checkbox" checked={!!f.ai_readable} disabled={!!f.sensitive}
              onChange={(e) => set(i, { ai_readable: e.target.checked })} /> IA pode ler</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={!!f.sensitive}
              onChange={(e) => set(i, { sensitive: e.target.checked, ...(e.target.checked ? { ai_readable: false } : {}) })} /> Sensível (nunca vai para a IA)</label>
            <span className="ml-auto font-mono">{f.key}</span>
          </div>
        </div>
      ))}
      {fields.length < 40 && <Button variant="outline" size="sm" onClick={add}><Plus className="w-4 h-4 mr-1" /> Campo</Button>}
    </div>
  );
}
