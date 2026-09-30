import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BrandKit, useBrandKit } from "./BrandKit";

/**
 * Campanhas: consulta o kit da marca e pede à IA uma mensagem no tom de voz da
 * marca (duas opções); "Usar" joga o texto no campo da campanha para revisar.
 */
export function BrandWriter({ orgId, onUse }: { orgId: string; onUse: (text: string) => void }) {
  const { toast } = useToast();
  const { kit } = useBrandKit(orgId);
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [opts, setOpts] = useState<string[]>([]);

  const write = async () => {
    setBusy(true); setOpts([]);
    const r = await callFunction<{ texto: string; variacao: string; sem_voz: boolean }>("interviewer", { action: "brand_write", organization_id: orgId, goal });
    setBusy(false);
    if (!r.ok) return toast({ variant: "destructive", title: "Não escreveu", description: r.message });
    setOpts([r.data.texto, r.data.variacao].filter(Boolean));
    if (r.data.sem_voz) toast({ title: "A marca ainda não tem tom de voz", description: "Defina em Diagnóstico → Marca para os textos saírem com a cara da empresa." });
  };

  return (
    <div className="rounded-md border p-2 space-y-2">
      <button type="button" className="text-xs font-medium flex items-center gap-1" onClick={() => setOpen(!open)}>
        <Sparkles className="w-3.5 h-3.5" /> {open ? "Fechar" : "Escrever com a voz da marca e ver o kit da marca"}
      </button>
      {open && (
        <>
          <div className="flex gap-2">
            <Input className="h-8" placeholder="Sobre o que é a mensagem? Ex.: promoção de 10% em revisão até sexta" value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={1500} />
            <Button size="sm" className="h-8" disabled={busy || goal.trim().length < 5} onClick={write}>{busy ? "Escrevendo…" : "Escrever"}</Button>
          </div>
          {opts.map((t, i) => (
            <div key={i} className="rounded-md bg-muted/40 p-2 text-sm space-y-1">
              <p className="whitespace-pre-wrap">{t}</p>
              <Button size="sm" variant="outline" onClick={() => onUse(t)}>Usar {i === 0 ? "esta" : "esta outra"}</Button>
            </div>
          ))}
          {kit?.voz && <p className="text-xs text-muted-foreground whitespace-pre-wrap"><b>Tom de voz:</b> {kit.voz}</p>}
          <BrandKit orgId={orgId} kit={kit} />
        </>
      )}
    </div>
  );
}
