import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface Reply { id: string; shortcut: string; content: string }

/**
 * Respostas rápidas: digitar "/" na caixa de texto lista os atalhos; escolher
 * troca o texto pelo conteúdo com {nome}, {protocolo}, {atendente}, {empresa}
 * preenchidos. Quem tem library.manage cria e apaga.
 */
export function QuickReplies({
  input, setInput, vars,
}: { input: string; setInput: (v: string) => void; vars: Record<string, string> }) {
  const { org, can } = useOrg();
  const { user } = useAuth();
  const { toast } = useToast();
  const [replies, setReplies] = useState<Reply[]>([]);
  const [manage, setManage] = useState(false);
  const [shortcut, setShortcut] = useState("");
  const [content, setContent] = useState("");

  const load = useCallback(async () => {
    if (!org) return;
    const { data } = await supabase.from("quick_replies").select("id, shortcut, content")
      .eq("organization_id", org.id).order("shortcut");
    setReplies((data as Reply[]) ?? []);
  }, [org]);
  useEffect(() => { load(); }, [load]);

  const fill = (text: string) => Object.entries(vars).reduce((t, [k, v]) => t.split(`{${k}}`).join(v), text);
  const query = input.startsWith("/") ? input.slice(1).toLowerCase() : null;
  const matches = query === null ? [] : replies.filter((r) => r.shortcut.includes(query)).slice(0, 6);

  const add = async () => {
    const sc = shortcut.trim().toLowerCase().replace(/^\//, "");
    if (!/^[a-z0-9_-]{1,30}$/.test(sc) || !content.trim()) {
      return toast({ variant: "destructive", title: "Atalho só com letras minúsculas, números, - ou _" });
    }
    const { error } = await supabase.from("quick_replies")
      .insert({ organization_id: org!.id, shortcut: sc, content: content.trim(), created_by: user?.id });
    if (error) return toast({ variant: "destructive", title: error.code === "23505" ? "Atalho já existe" : "Sem permissão" });
    setShortcut(""); setContent("");
    load();
  };
  const remove = async (id: string) => {
    await supabase.from("quick_replies").delete().eq("id", id);
    load();
  };

  return (
    <>
      {query !== null && (
        <div className="mx-3 mb-1 rounded-md border bg-popover shadow-sm text-sm">
          {matches.length === 0 && (
            <div className="px-3 py-2 text-muted-foreground text-xs">
              Nenhuma resposta com “/{query}”.
              {can("library.manage") && <button type="button" className="underline ml-1" onClick={() => setManage(true)}>Criar respostas</button>}
            </div>
          )}
          {matches.map((r) => (
            <button key={r.id} type="button" onClick={() => setInput(fill(r.content))}
              className="w-full text-left px-3 py-2 hover:bg-muted border-b last:border-0">
              <span className="font-mono text-xs text-primary">/{r.shortcut}</span>
              <span className="text-muted-foreground ml-2 truncate">{fill(r.content).slice(0, 80)}</span>
            </button>
          ))}
          {can("library.manage") && matches.length > 0 && (
            <button type="button" className="w-full text-left px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-muted"
              onClick={() => setManage(true)}>Gerenciar respostas rápidas</button>
          )}
        </div>
      )}

      <Dialog open={manage} onOpenChange={setManage}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Respostas rápidas</DialogTitle>
            <DialogDescription>
              Variáveis: {"{nome}"} do cliente, {"{protocolo}"}, {"{atendente}"} e {"{empresa}"}.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-60 overflow-y-auto space-y-2">
            {replies.map((r) => (
              <div key={r.id} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                <span className="font-mono text-xs text-primary shrink-0">/{r.shortcut}</span>
                <span className="flex-1 whitespace-pre-wrap text-muted-foreground">{r.content}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Apagar" onClick={() => remove(r.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Input placeholder="atalho (ex.: preco)" value={shortcut} onChange={(e) => setShortcut(e.target.value)} />
            <Textarea rows={3} placeholder="Olá {nome}! Nossos preços..." value={content} onChange={(e) => setContent(e.target.value)} />
          </div>
          <DialogFooter><Button onClick={add}>Adicionar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
