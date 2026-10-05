import { useCallback, useEffect, useState } from "react";
import { Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Invite { id: string; setor: string; status: string; raw: string | null; submitted_at: string | null }

const ASK = [
  "Descreva cada processo do setor como se estivesse ensinando uma pessoa nova: passo a passo",
  "Quem faz, com que ferramenta, quanto tempo leva e onde trava",
  "Se quiser, conte também como deveria funcionar",
  "Não escreva senhas nem dados de clientes",
];

/**
 * Responsável do setor convidado pelo dono: escreve os processos do setor dele.
 * Vê só os próprios convites; o texto vai para o dono revisar no Diagnóstico.
 */
export default function DiagnosticoSetor() {
  const { org } = useOrg();
  const { toast } = useToast();
  const [rows, setRows] = useState<Invite[]>([]);
  const [text, setText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!org) return;
    const { data: u } = await supabase.auth.getUser();
    const { data } = await supabase.from("diag_delegations").select("id, setor, status, raw, submitted_at")
      .eq("organization_id", org.id).eq("user_id", u.user?.id ?? "").order("created_at");
    const list = (data ?? []) as Invite[];
    setRows(list);
    setText(Object.fromEntries(list.map((r) => [r.id, r.raw ?? ""])));
  }, [org]);
  useEffect(() => { void load(); }, [load]);

  if (!org) return null;

  const send = async (r: Invite) => {
    setBusy(r.id);
    const { error } = await supabase.rpc("diag_submit_sector", { delegation: r.id, p_raw: text[r.id] ?? "" });
    setBusy(null);
    if (error) return toast({ variant: "destructive", title: "Não enviou", description: error.message });
    toast({ title: "Enviado", description: "Quem convidou vai revisar. Você pode corrigir e enviar de novo enquanto não for aprovado." });
    void load();
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="inicio" />
      <main className="flex-1 w-full max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
        <div>
          <h1 className="font-brand text-2xl leading-tight">Processos do seu setor</h1>
          <p className="text-sm text-muted-foreground">Você foi convidado(a) a contar como o trabalho do seu setor funciona. Isso ajuda a {org.name} a organizar e automatizar o que dá.</p>
        </div>
        {!rows.length && <p className="text-sm text-muted-foreground">Nenhum convite aberto para você.</p>}
        {rows.map((r) => (
          <section key={r.id} className="rounded-xl border bg-card p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">Setor: {r.setor}</p>
              {r.status === "submitted" && <span className="text-xs rounded-full px-2 py-0.5 bg-success-soft text-success-text">Enviado em {new Date(r.submitted_at!).toLocaleDateString("pt-BR")}</span>}
            </div>
            <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-0.5">{ASK.map((q) => <li key={q}>{q}</li>)}</ul>
            <Textarea rows={12} maxLength={12000} value={text[r.id] ?? ""} onChange={(e) => setText({ ...text, [r.id]: e.target.value })}
              placeholder={"Ex.: Orçamento\n1. O cliente pede pelo WhatsApp.\n2. Confiro o estoque na planilha.\n3. ..."} />
            <div className="flex justify-end">
              <Button disabled={busy === r.id || (text[r.id] ?? "").trim().length < 10} onClick={() => void send(r)}>
                <Send className="w-4 h-4 mr-1" /> {busy === r.id ? "Enviando..." : r.status === "submitted" ? "Enviar de novo" : "Enviar"}
              </Button>
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
