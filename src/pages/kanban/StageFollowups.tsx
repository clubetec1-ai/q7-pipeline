import { MicTextarea } from "@/components/MicTextarea";
import { useOrg } from "@/contexts/OrgContext";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export interface StageFollowupCfg {
  id: string; name: string;
  followup_days?: number[] | null; followup_hint?: string | null; followup_template?: string | null;
}

const parseDays = (s: string) =>
  [...new Set(s.split(/[^0-9]+/).filter(Boolean).map(Number))].filter((n) => n >= 1 && n <= 60).sort((a, b) => a - b).slice(0, 5);

/**
 * Retorno automático da etapa: depois de N dias sem resposta do cliente, a IA manda uma
 * mensagem curta seguindo a orientação. No número oficial da Meta, depois de 24h sem o
 * cliente falar, só passa modelo aprovado: por isso o campo do modelo.
 */
export function StageFollowups({ stage, open, onClose, onSaved }: { stage: StageFollowupCfg; open: boolean; onClose: () => void; onSaved: () => void }) {
  const { org } = useOrg();
  const { toast } = useToast();
  const [days, setDays] = useState("");
  const [hint, setHint] = useState("");
  const [template, setTemplate] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setDays((stage.followup_days ?? []).join(", "));
    setHint(stage.followup_hint ?? "");
    setTemplate(stage.followup_template ?? "");
  }, [stage, open]);

  const list = parseDays(days);
  const save = async () => {
    const tpl = template.trim().toLowerCase();
    if (tpl && !/^[a-z0-9_]{1,100}$/.test(tpl)) return toast({ variant: "destructive", title: "Nome do modelo inválido", description: "Use o nome exato do modelo aprovado na Meta (letras minúsculas, números e _)." });
    setBusy(true);
    const { error } = await supabase.from("pipeline_stages")
      .update({ followup_days: list, followup_hint: hint.trim() || null, followup_template: tpl || null })
      .eq("id", stage.id);
    setBusy(false);
    if (error) return toast({ variant: "destructive", title: "Não salvou", description: error.message });
    toast({ title: list.length ? `Retornos em ${list.join(", ")} dia(s)` : "Retorno automático desligado" });
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Retorno automático — {stage.name}</DialogTitle>
          <DialogDescription>
            Se o cliente ficar sem responder nesta etapa, a IA manda uma mensagem curta nos dias escolhidos. Se ele responder,
            a contagem recomeça; se o card mudar de etapa, os retornos param. Quem pediu para não receber mensagens nunca recebe.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Dias sem resposta (até 5, de 1 a 60)</span>
            <Input value={days} onChange={(e) => setDays(e.target.value)} placeholder="Ex.: 2, 5, 10 (vazio desliga)" />
            <span className="text-xs text-muted-foreground">{list.length ? `Vai mandar após ${list.join(", ")} dia(s).` : "Desligado."}</span>
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">O que a IA deve fazer no retorno</span>
            <MicTextarea orgId={org?.id ?? ""} rows={3} maxLength={400} value={hint} onChange={(t) => setHint(t)}
              placeholder="Ex.: perguntar se ficou alguma dúvida na proposta e oferecer uma conversa rápida. Sem pressão." />
            <span className="text-xs text-muted-foreground">A IA nunca inventa preço, desconto, prazo ou condição.</span>
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Modelo aprovado da Meta (só número oficial)</span>
            <Input value={template} onChange={(e) => setTemplate(e.target.value)} placeholder="Ex.: retorno_proposta" />
            <span className="text-xs text-muted-foreground">
              No WhatsApp oficial, depois de 24h sem o cliente falar, só passa modelo aprovado. Sem modelo, o retorno fica marcado como não enviado. No WhatsApp por QR Code não precisa.
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={busy} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
