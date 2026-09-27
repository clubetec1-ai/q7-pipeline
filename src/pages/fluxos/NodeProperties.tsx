import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { BLOCK, type BlockData } from "./blocks";

/** Espera máxima (min): mantém a mensagem dentro da janela de 24 h do WhatsApp. */
const MAX_WAIT_MIN = 1380;

export interface Option { id: string; name: string }
export interface Lookups { departments: Option[]; tags: Option[]; groups: Option[] }

const selectCls = "w-full h-9 rounded-md border bg-background px-2 text-sm";
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function Pick({ value, onChange, options, empty }: {
  value: string; onChange: (v: string) => void; options: Option[]; empty?: string;
}) {
  return (
    <select className={selectCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {empty !== undefined && <option value="">{empty}</option>}
      {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label>{children}</div>;
}

/** Painel de propriedades do bloco selecionado. */
export function NodeProperties({ type, data, onChange, onDelete, lookups }: {
  type: string; data: BlockData; onChange: (d: BlockData) => void; onDelete: () => void; lookups: Lookups;
}) {
  const set = (patch: BlockData) => onChange({ ...data, ...patch });
  const s = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : "");
  const text = (k: string, label: string, rows = 3) => (
    <Field label={label}>
      <Textarea rows={rows} maxLength={2000} value={s(k)} onChange={(e) => set({ [k]: e.target.value })} />
    </Field>
  );
  const options = (data.options as { id: string; label: string }[] | undefined) ?? [];
  const minutes = (k: string, label: string, min: number) => (
    <Field label={label}>
      <Input type="number" min={min} max={MAX_WAIT_MIN} value={Number(data[k] ?? min)}
        onChange={(e) => set({ [k]: Math.min(MAX_WAIT_MIN, Math.max(min, Math.round(Number(e.target.value) || 0))) })} />
    </Field>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="font-semibold">{BLOCK[type]?.label}</p>
        {type !== "start" && (
          <Button variant="ghost" size="icon" title="Apagar bloco" onClick={onDelete}><Trash2 className="w-4 h-4" /></Button>
        )}
      </div>

      {type === "start" && (
        <p className="text-sm text-muted-foreground">
          Todo fluxo começa aqui. Ligue “Cliente que volta” só se quiser um caminho diferente para quem já foi atendido.
        </p>
      )}
      {type === "message" && text("text", "Texto")}
      {type === "menu" && (
        <>
          {text("text", "Pergunta")}
          <Field label="Opções (o cliente responde com o número ou o texto)">
            <div className="space-y-2">
              {options.map((o, i) => (
                <div key={o.id} className="flex gap-2">
                  <Input value={o.label} maxLength={60} onChange={(e) =>
                    set({ options: options.map((x) => (x.id === o.id ? { ...x, label: e.target.value } : x)) })} />
                  <Button variant="ghost" size="icon" title={`Remover opção ${i + 1}`}
                    onClick={() => set({ options: options.filter((x) => x.id !== o.id) })}><Trash2 className="w-4 h-4" /></Button>
                </div>
              ))}
              {options.length < 10 && (
                <Button variant="outline" size="sm" onClick={() =>
                  set({ options: [...options, { id: crypto.randomUUID().slice(0, 8), label: `Opção ${options.length + 1}` }] })}>
                  <Plus className="w-4 h-4 mr-1" /> Opção
                </Button>
              )}
            </div>
          </Field>
          {minutes("timeout_minutes", "Sem resposta depois de (min, 0 = esperar sempre)", 0)}
        </>
      )}
      {type === "question" && (
        <>
          {text("text", "Pergunta")}
          <Field label="Tipo de resposta">
            <Pick value={s("kind") || "text"} onChange={(v) => set({ kind: v })} options={[
              { id: "text", name: "Texto" }, { id: "number", name: "Número" }, { id: "email", name: "E-mail" },
              { id: "cpf_cnpj", name: "CPF ou CNPJ" }, { id: "date", name: "Data (dd/mm/aaaa)" },
            ]} />
          </Field>
          <Field label="Guardar na ficha do contato">
            <Pick value={s("save_to")} onChange={(v) => set({ save_to: v })} empty="Não guardar" options={[
              { id: "name", name: "Nome" }, { id: "email", name: "E-mail" }, { id: "document", name: "CPF/CNPJ" },
            ]} />
          </Field>
          <Field label="Nome da variável (use {var.nome} nos textos)">
            <Input value={s("var_name")} maxLength={40} placeholder="ex.: pedido"
              onChange={(e) => set({ var_name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} />
          </Field>
          {text("invalid_text", "Mensagem quando a resposta é inválida", 2)}
          {minutes("timeout_minutes", "Sem resposta depois de (min, 0 = esperar sempre)", 0)}
        </>
      )}
      {type === "condition" && (
        <>
          <Field label="Verificar">
            <Pick value={s("kind") || "first_contact"} onChange={(v) => set({ kind: v })} options={[
              { id: "first_contact", name: "Primeiro contato" }, { id: "tag", name: "Contato tem etiqueta" },
              { id: "contact_group", name: "Contato está no grupo" }, { id: "weekday", name: "Dia da semana" },
            ]} />
          </Field>
          {s("kind") === "tag" && <Field label="Etiqueta"><Pick value={s("tag_id")} onChange={(v) => set({ tag_id: v })} empty="Escolha" options={lookups.tags} /></Field>}
          {s("kind") === "contact_group" && <Field label="Grupo"><Pick value={s("group_id")} onChange={(v) => set({ group_id: v })} empty="Escolha" options={lookups.groups} /></Field>}
          {s("kind") === "weekday" && (
            <div className="flex flex-wrap gap-1">
              {WEEKDAYS.map((w, i) => {
                const days = (data.weekdays as number[] | undefined) ?? [];
                const on = days.includes(i);
                return (
                  <Button key={w} size="sm" variant={on ? "default" : "outline"}
                    onClick={() => set({ weekdays: on ? days.filter((x) => x !== i) : [...days, i] })}>{w}</Button>
                );
              })}
            </div>
          )}
        </>
      )}
      {type === "business_hours" && (
        <p className="text-sm text-muted-foreground">Usa o horário de atendimento definido na página Fluxos.</p>
      )}
      {type === "ai_agent" && (
        <>
          {text("prompt", "Instruções da IA (vazio = prompt do agente da empresa)", 6)}
          {text("intro", "Mensagem antes da primeira resposta (opcional)", 2)}
          <Field label="Palavras que pedem um humano (separe por vírgula)">
            <Input value={((data.handoff_words as string[] | undefined) ?? []).join(", ")}
              onChange={(e) => set({ handoff_words: e.target.value.split(",").map((w) => w.trim()).filter(Boolean).slice(0, 20) })} />
          </Field>
          <Field label="Máximo de respostas da IA">
            <Input type="number" min={1} max={50} value={Number(data.max_turns ?? 10)}
              onChange={(e) => set({ max_turns: Math.min(50, Math.max(1, Number(e.target.value) || 1)) })} />
          </Field>
          <Field label="Departamento quando pedir humano (sem ligação na saída)">
            <Pick value={s("handoff_department_id")} onChange={(v) => set({ handoff_department_id: v || null })} empty="Fila geral" options={lookups.departments} />
          </Field>
        </>
      )}
      {type === "wait" && (
        <>
          {minutes("minutes", "Aguardar (minutos, até 23 h)", 1)}
          <p className="text-xs text-muted-foreground">
            “Passou o tempo” segue sem o cliente ter escrito: quem pediu para não receber mensagens automáticas (SAIR) não recebe o que vier depois.
            Se o cliente escrever antes, segue por “Cliente respondeu”.
          </p>
        </>
      )}
      {type === "survey" && (
        <>
          <Field label="Escala">
            <Pick value={s("kind") || "csat"} onChange={(v) => set({ kind: v })} options={[
              { id: "csat", name: "Satisfação (1 a 5)" }, { id: "nps", name: "Recomendação – NPS (0 a 10)" },
            ]} />
          </Field>
          {text("text", "Pergunta", 2)}
          {text("comment", "Pedir comentário depois da nota (vazio = não pedir)", 2)}
          <p className="text-xs text-muted-foreground">
            A nota fica no atendimento. Resposta que não é nota encerra a pesquisa e abre um atendimento normal.
          </p>
        </>
      )}
      {type === "tag" && (
        <>
          <Field label="Etiqueta"><Pick value={s("tag_id")} onChange={(v) => set({ tag_id: v })} empty="Escolha" options={lookups.tags} /></Field>
          <div className="flex items-center gap-2">
            <Switch checked={!!data.remove} onCheckedChange={(v) => set({ remove: v })} id="rm" />
            <Label htmlFor="rm" className="text-sm">Remover em vez de adicionar</Label>
          </div>
        </>
      )}
      {type === "transfer" && (
        <>
          <Field label="Departamento">
            <Pick value={s("department_id")} onChange={(v) => set({ department_id: v || null })} empty="Fila geral" options={lookups.departments} />
          </Field>
          {text("text", "Mensagem ao transferir (opcional)", 2)}
        </>
      )}
      {type === "close" && text("text", "Mensagem de despedida (opcional)", 2)}

      {["message", "menu", "question", "transfer", "close", "survey"].includes(type) && (
        <p className="text-xs text-muted-foreground">Use {"{nome}"} para o primeiro nome do cliente.</p>
      )}
    </div>
  );
}
