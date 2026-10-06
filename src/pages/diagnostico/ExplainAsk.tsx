import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { callFunction } from "@/lib/callFunction";
import { Button } from "@/components/ui/button";

/**
 * Lista do que responder na etapa + "Não entendi": a IA reescreve cada item com palavras
 * do dia a dia e um exemplo de resposta (padrão: ninguém fica travado por não entender a pergunta).
 */
export function ExplainAsk({ orgId, step, setor, items }: { orgId: string; step: string; setor?: string | null; items: string[] }) {
  const [simple, setSimple] = useState<{ pergunta: string; exemplo: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const explain = async () => {
    setBusy(true); setErr(null);
    const r = await callFunction<{ itens: { pergunta: string; exemplo: string }[] }>("interviewer", {
      action: "explain_ask", organization_id: orgId, step, setor: setor ?? undefined, items,
    });
    setBusy(false);
    if (!r.ok) return setErr(r.message);
    setSimple(r.data.itens);
  };
  if (!items.length) return null;
  return (
    <div className="space-y-1.5">
      <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-0.5">{items.map((q) => <li key={q}>{q}</li>)}</ul>
      {!simple && (
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busy} onClick={() => void explain()}>
          <HelpCircle className="w-3.5 h-3.5 mr-1" /> {busy ? "Explicando…" : "Não entendi — explicar com palavras simples"}
        </Button>
      )}
      {err && <p className="text-xs text-red-600">{err}</p>}
      {simple && (
        <div className="rounded-md bg-primary/5 border border-primary/30 p-3 text-sm space-y-2">
          <p className="text-xs font-medium">Em palavras simples:</p>
          {simple.map((s, i) => (
            <div key={i}>
              <p>{i + 1}. {s.pergunta}</p>
              {s.exemplo && <p className="text-xs text-muted-foreground">Ex.: {s.exemplo}</p>}
            </div>
          ))}
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setSimple(null)}>Fechar explicação</Button>
        </div>
      )}
    </div>
  );
}
