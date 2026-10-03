import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { Button } from "@/components/ui/button";

/** Mesmas chaves do implementador (supabase/functions/implementer). */
export const READY_TEMPLATES: { key: string; name: string; description: string }[] = [
  { key: "triagem", name: "Recepção e triagem", description: "Menu que leva o cliente ao departamento certo." },
  { key: "fora_horario", name: "Fora do horário", description: "Avisa quando a empresa está fechada." },
  { key: "faq_ia", name: "IA para dúvidas frequentes", description: "IA responde com base no Diagnóstico e passa para humano." },
  { key: "qualificacao", name: "Qualificação de lead", description: "Pede nome, e-mail e interesse e passa para o comercial." },
  { key: "funil_vendas", name: "Funil de vendas", description: "Qualifica o lead (empresa, equipe, dificuldade, urgência), marca quente/morno/frio, move no Kanban e passa para vendas." },
  { key: "catalogo", name: "Envio de catálogo", description: "Manda o arquivo da biblioteca." },
  { key: "pesquisa", name: "Pesquisa de satisfação", description: "Nota de 1 a 5 e comentário após o atendimento." },
  { key: "followup", name: "Lembrete para quem sumiu", description: "Pergunta e lembra se o cliente não responder." },
  { key: "dados_ficha", name: "Coleta de dados", description: "Nome e e-mail do cliente na ficha." },
];

export interface InstallResult { kind: "flow" | "record_type" | "guide"; id?: string; name?: string; message?: string; warnings?: string[] }

/** Instala um modelo (ou uma sugestão do Diagnóstico) como RASCUNHO. */
export function useInstall(orgId: string) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const install = async (payload: { template?: string; suggestion_index?: number }, tag: string) => {
    setBusy(tag);
    const r = await callFunction<InstallResult>("implementer", { action: "install", organization_id: orgId, ...payload });
    setBusy(null);
    if (!r.ok) { toast({ variant: "destructive", title: r.message }); return null; }
    if (r.data.kind === "guide") { toast({ title: "Passo a passo", description: r.data.message }); return r.data; }
    toast({
      title: r.data.kind === "flow" ? "Rascunho criado — revise e publique" : "Tipo de registro criado",
      description: (r.data.warnings ?? []).join(" ") || "Nada foi publicado. Teste no simulador antes.",
    });
    if (r.data.kind === "flow" && r.data.id) navigate(`/fluxos/${r.data.id}`);
    if (r.data.kind === "record_type") navigate("/registros");
    return r.data;
  };
  return { install, busy };
}

export function ReadyTemplates({ orgId }: { orgId: string }) {
  const { install, busy } = useInstall(orgId);
  return (
    <section className="space-y-3">
      <h2 className="font-semibold">Modelos prontos</h2>
      <p className="text-xs text-muted-foreground">
        Instala como rascunho, com textos escritos pela IA a partir do Diagnóstico da empresa. Nada vai para o ar sem você publicar.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {READY_TEMPLATES.map((t) => (
          <div key={t.key} className="rounded-md border p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t.name}</p>
              <p className="text-xs text-muted-foreground">{t.description}</p>
            </div>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => install({ template: t.key }, t.key)}>
              {busy === t.key ? "Criando..." : "Instalar"}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
