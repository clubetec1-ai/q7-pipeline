import { useEffect, useState } from "react";
import { BookPlus, FileSignature, FileText, Loader2 } from "lucide-react";
import { callFunction } from "@/lib/callFunction";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

interface Doc { id: string; title: string; file_name: string | null; kind: string }

/**
 * Documentos da base marcados "Pode ser enviado" (Etapa B, item 4): enviar como arquivo na conversa ou, para contrato e
 * orçamento, preencher com os dados do cliente ({{nome}}, {{cpf_cnpj}}…) e conferir antes de mandar.
 */
export function KnowledgeDocsPicker({ orgId, conversationId, disabled, onFile, onText }: {
  orgId: string; conversationId: string; disabled?: boolean; onFile: (f: File) => void; onText: (t: string) => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [filled, setFilled] = useState<{ title: string; text: string; faltando: string[] } | null>(null);
  useEffect(() => {
    if (!open) return;
    void callFunction<{ docs: Doc[] }>("knowledge", { action: "sendables", organization_id: orgId }).then((r) => setDocs(r.ok ? r.data.docs : []));
  }, [open, orgId]);

  const send = async (d: Doc) => {
    setBusy(d.id);
    const r = await callFunction<{ url: string | null; file_name: string; mime: string }>("knowledge", { action: "send_link", organization_id: orgId, doc_id: d.id });
    try {
      if (!r.ok || !r.data.url) throw new Error(r.ok ? "Arquivo indisponível" : r.message);
      const blob = await (await fetch(r.data.url)).blob();
      onFile(new File([blob], r.data.file_name || d.title, { type: r.data.mime || blob.type }));
      setOpen(false);
    } catch (e) {
      toast({ variant: "destructive", title: "Não consegui anexar", description: e instanceof Error ? e.message : undefined });
    } finally { setBusy(null); }
  };
  const fill = async (d: Doc) => {
    setBusy(d.id);
    const r = await callFunction<{ title: string; text: string; faltando: string[] }>("knowledge", { action: "fill", organization_id: orgId, doc_id: d.id, conversation_id: conversationId });
    setBusy(null);
    if (!r.ok) return toast({ variant: "destructive", title: "Não consegui preencher", description: r.message });
    setFilled(r.data); setOpen(false);
  };
  const shown = docs.filter((d) => d.title.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" title="Documento da base (enviar ou preencher contrato)" disabled={disabled}><FileText className="w-4 h-4" /></Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-2 space-y-2">
          <Input className="h-8" placeholder="Buscar documento" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-64 overflow-y-auto space-y-1">
            {shown.length === 0 && <p className="text-xs text-muted-foreground p-2">Nenhum documento marcado "Pode ser enviado" na Base de conhecimento.</p>}
            {shown.map((d) => (
              <div key={d.id} className="flex items-center gap-1 rounded px-2 py-1 hover:bg-muted">
                <span className="flex-1 truncate text-sm">{d.title}</span>
                {busy === d.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {["contrato", "orcamento"].includes(d.kind) && (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!!busy} title="Preencher com os dados do cliente" onClick={() => void fill(d)}>
                    <FileSignature className="w-3.5 h-3.5 mr-1" /> Preencher</Button>
                )}
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!!busy} onClick={() => void send(d)}>Anexar</Button>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <Dialog open={!!filled} onOpenChange={(o) => !o && setFilled(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{filled?.title} — preenchido</DialogTitle>
            <DialogDescription>
              Confira antes de enviar. {filled?.faltando.length ? `Falta preencher: ${filled.faltando.join(", ")} (marcado como [preencher: …]).` : "Todos os campos foram preenchidos com a ficha do cliente."}
            </DialogDescription>
          </DialogHeader>
          {filled && <Textarea rows={14} value={filled.text} onChange={(e) => setFilled({ ...filled, text: e.target.value })} />}
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={!filled || filled.text.length > 4000} title={filled && filled.text.length > 4000 ? "Longo demais para mensagem: envie como arquivo" : undefined}
              onClick={() => { if (filled) { onText(filled.text); setFilled(null); } }}>Usar como mensagem</Button>
            <Button onClick={() => {
              if (!filled) return;
              const name = `${filled.title.replace(/[^\wÀ-ú -]+/g, "").trim() || "documento"}.txt`;
              onFile(new File([filled.text], name, { type: "text/plain" })); setFilled(null);
            }}>Anexar como arquivo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Anexo recebido (ex.: e-mail) → Base de conhecimento. Só quem cuida da base. */
export function AddToKnowledgeButton({ orgId, messageId }: { orgId: string; messageId: string }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (done) return <span className="text-[11px] opacity-70">Na base de conhecimento</span>;
  return (
    <button type="button" className="inline-flex items-center gap-1 text-[11px] underline opacity-70 hover:opacity-100" disabled={busy}
      onClick={async () => {
        setBusy(true);
        const r = await callFunction<{ status: string; error?: string }>("knowledge", { action: "from_message", organization_id: orgId, message_id: messageId });
        setBusy(false);
        if (!r.ok) return toast({ variant: "destructive", title: "Não adicionado", description: r.message });
        setDone(true);
        toast(r.data.status === "ready"
          ? { title: "Adicionado à base", description: "Ajuste o uso (interno, atendimento ou enviável) em Base de conhecimento." }
          : { variant: "destructive", title: "Guardado, mas não consegui ler", description: r.data.error });
      }}>
      <BookPlus className="w-3 h-3" /> {busy ? "Adicionando…" : "Adicionar à base"}
    </button>
  );
}
