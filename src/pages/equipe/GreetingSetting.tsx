import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const DEFAULT_GREETING = "Olá! Aqui é {nome}, vou continuar o seu atendimento. 😊";

/** Mensagens automáticas ao cliente (settings da organização). Vazio desliga. */
const FIELDS = [
  {
    key: "claim_greeting", label: "Mensagem ao assumir atendimento", fallback: DEFAULT_GREETING,
    suggestion: DEFAULT_GREETING,
    help: <>Quando alguém assume, recebe pela distribuição ou por transferência. <code>{"{nome}"}</code> = primeiro nome de quem atende.</>,
  },
  {
    key: "protocol_open_text", label: "Protocolo no início do atendimento", fallback: "",
    suggestion: "Seu protocolo de atendimento é {protocolo}.",
    help: <>Enviada quando o cliente abre um atendimento novo. <code>{"{protocolo}"}</code> = número do protocolo.</>,
  },
  {
    key: "protocol_transfer_text", label: "Aviso de transferência", fallback: "",
    suggestion: "Você foi transferido para {departamento}. Seu protocolo é {protocolo}.",
    help: <>Enviada quando o atendimento é transferido. <code>{"{departamento}"}</code> e <code>{"{protocolo}"}</code>.</>,
  },
] as const;

type Key = (typeof FIELDS)[number]["key"];

export function GreetingSetting({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const { toast } = useToast();
  const [values, setValues] = useState<Record<Key, string>>(
    Object.fromEntries(FIELDS.map((f) => [f.key, f.fallback])) as Record<Key, string>);
  const [saving, setSaving] = useState<Key | null>(null);

  useEffect(() => {
    supabase.from("organizations").select("settings").eq("id", orgId).maybeSingle().then(({ data }) => {
      const s = (data?.settings as Record<string, unknown> | null) ?? {};
      setValues(Object.fromEntries(FIELDS.map((f) =>
        [f.key, typeof s[f.key] === "string" ? String(s[f.key]) : f.fallback])) as Record<Key, string>);
    });
  }, [orgId]);

  const save = async (key: Key) => {
    setSaving(key);
    // Relê antes de gravar para não apagar ajustes feitos em outra tela.
    const { data } = await supabase.from("organizations").select("settings").eq("id", orgId).maybeSingle();
    const settings = { ...((data?.settings as Record<string, unknown>) ?? {}), [key]: values[key].trim() };
    const { error } = await supabase.from("organizations").update({ settings: settings as never }).eq("id", orgId);
    setSaving(null);
    toast(error ? { variant: "destructive", title: "Não foi possível salvar" } : { title: values[key].trim() ? "Mensagem salva" : "Aviso desligado" });
  };

  return (
    <div className="space-y-3">
      {FIELDS.map((f) => (
        <div key={f.key} className="rounded-lg border p-4 space-y-2">
          <Label htmlFor={f.key}>{f.label}</Label>
          <p className="text-xs text-muted-foreground">{f.help} Deixe vazio para não enviar.</p>
          <Textarea id={f.key} rows={2} value={values[f.key]} disabled={!canEdit} maxLength={1000}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
          {canEdit && (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => save(f.key)} disabled={saving === f.key}>
                {saving === f.key ? "Salvando..." : "Salvar"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setValues((v) => ({ ...v, [f.key]: f.suggestion }))}>
                Usar sugestão
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
