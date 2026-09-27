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

interface Reply { id: string; shortcut: string; content: string; library_file_id: string | null; library_files: { name: string } | null }
interface LibFile { id: string; name: string }

/**
 * Respostas rápidas: digitar "/" na caixa de texto lista os atalhos; escolher
 * troca o texto pelo conteúdo com {nome}, {protocolo}, {atendente}, {empresa}
 * preenchidos. Quem tem library.manage cria e apaga.
 */
export function QuickReplies({
  input, setInput, vars, onFile,
}: { input: string; setInput: (v: string) => void; vars: Record<string, string>; onFile?: (f: LibFile) => void }) {
  const { org, can } = useOrg();
  const { user } = useAuth();
  const { toast } = useToast();
  const [replies, setReplies] = useState<Reply[]>([]);
  const [manage, setManage] = useState(false);
  const [shortcut, setShortcut] = useState("");
  const [content, setContent] = useState("");
  const [fileId, setFileId] = useState("");
  const [files, setFiles] = useState<LibFile[]>([]);

  const load = useCallback(async () => {
    if (!org) return;
    const [{ data }, lf] = await Promise.all([
      supabase.from("quick_replies").select("id, shortcut, content, library_file_id, library_files(name)")
        .eq("organization_id", org.id).order("shortcut"),
      supabase.from("library_files").select("id, name").eq("organization_id", org.id).order("name"),
    ]);
    setReplies((data as unknown as Reply[]) ?? []);
    setFiles(lf.data ?? []);
  }, [org]);
  useEffect(() => { load(); }, [load]);

  const fill = (text: string) => Object.entries(vars).reduce((t, [k, v]) => t.split(`{${k}}`).join(v), text);
  const query = input.startsWith("/") ? input.slice(1).toLowerCase() : null;
  const matches = query === null ? [] : replies.filter((r) => r.shortcut.includes(query)).slice(0, 6);

  const add = async () => {
    // Aceita "/Olá Cliente" e grava "ola-cliente".
    const sc = shortcut.trim().toLowerCase().replace(/^\/+/, "")
      .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "-");
    if (!/^[a-z0-9_-]{1,30}$/.test(sc)) {
      return toast({ variant: "destructive", title: "Atalho só com letras, números, - ou _ (até 30)" });
    }
    if (!content.trim()) return toast({ variant: "destructive", title: "Escreva o texto da resposta" });
    const { error } = await supabase.from("quick_replies")
      .insert({ organization_id: org!.id, shortcut: sc, content: content.trim(), created_by: user?.id, library_file_id: fileId || null });
    if (error) return toast({ variant: "destructive", title: error.code === "23505" ? "Atalho já existe" : "Sem permissão" });
    setShortcut(""); setContent(""); setFileId("");
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
            <button key={r.id} type="button" onClick={() => {
              setInput(fill(r.content));
              if (r.library_file_id && r.library_files) onFile?.({ id: r.library_file_id, name: r.library_files.name });
            }}
              className="w-full text-left px-3 py-2 hover:bg-muted border-b last:border-0">
              <span className="font-mono text-xs text-primary">/{r.shortcut}</span>
              <span className="text-muted-foreground ml-2 truncate">{r.library_files ? "📎 " : ""}{fill(r.content).slice(0, 80)}</span>
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
            <select className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={fileId} onChange={(e) => setFileId(e.target.value)}>
              <option value="">Sem arquivo</option>
              {files.map((f) => <option key={f.id} value={f.id}>📎 {f.name}</option>)}
            </select>
          </div>
          <DialogFooter><Button onClick={add}>Adicionar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
