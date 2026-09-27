import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const DEFAULT_GREETING = "Olá! Aqui é {nome}, vou continuar o seu atendimento. 😊";

/** Texto enviado ao cliente quando alguém assume o atendimento. Vazio desliga. */
export function GreetingSetting({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const { toast } = useToast();
  const [text, setText] = useState(DEFAULT_GREETING);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("organizations").select("settings").eq("id", orgId).maybeSingle().then(({ data }) => {
      const v = (data?.settings as Record<string, unknown> | null)?.claim_greeting;
      setText(typeof v === "string" ? v : DEFAULT_GREETING);
    });
  }, [orgId]);

  const save = async () => {
    setSaving(true);
    const { data } = await supabase.from("organizations").select("settings").eq("id", orgId).maybeSingle();
    const settings = { ...((data?.settings as Record<string, unknown>) ?? {}), claim_greeting: text.trim() };
    const { error } = await supabase.from("organizations").update({ settings }).eq("id", orgId);
    setSaving(false);
    toast(error ? { variant: "destructive", title: "Não foi possível salvar" } : { title: text.trim() ? "Mensagem salva" : "Aviso desligado" });
  };

  return (
    <div className="rounded-lg border p-4 space-y-2">
      <Label htmlFor="saudacao">Mensagem ao assumir atendimento</Label>
      <p className="text-xs text-muted-foreground">
        Enviada ao cliente quando alguém assume, recebe pela distribuição automática ou por transferência.
        Use <code>{"{nome}"}</code> para o primeiro nome de quem vai atender. Deixe vazio para não enviar.
      </p>
      <Textarea id="saudacao" rows={2} value={text} disabled={!canEdit} maxLength={1000}
        onChange={(e) => setText(e.target.value)} />
      {canEdit && (
        <div className="flex gap-2">
          <Button size="sm" onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
          <Button size="sm" variant="ghost" onClick={() => setText(DEFAULT_GREETING)}>Usar o padrão</Button>
        </div>
      )}
    </div>
  );
}
