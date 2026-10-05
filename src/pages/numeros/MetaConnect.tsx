import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Facebook } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

/** Botão "Conectar com o Facebook": abre o login da Meta (Página/Instagram ou WhatsApp oficial). */
export function FacebookButton({ orgId, kind, label, size = "sm" }: { orgId: string; kind: "pages" | "whatsapp"; label?: string; size?: "sm" | "default" }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const r = await callFunction<{ url: string }>("meta-connect", { action: "start", organization_id: orgId, kind });
    setBusy(false);
    if (!r.ok) return toast({ variant: "destructive", title: "Não deu para abrir o login", description: r.message });
    window.location.href = r.data.url; // login no Facebook; volta para Números para escolher
  };
  return (
    <Button size={size} disabled={busy} onClick={() => void go()} className="bg-[#1877F2] text-white hover:bg-[#166FE5]">
      <Facebook className="w-4 h-4 mr-1" /> {busy ? "Abrindo..." : label ?? "Conectar com o Facebook"}
    </Button>
  );
}

interface Option { id: string; label: string }

/**
 * Volta do login da Meta (?meta=<sessão> ou ?meta_erro=...): mostra as Páginas ou
 * os números liberados para a pessoa escolher e conecta.
 */
export function MetaConnectReturn({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const sessionId = params.get("meta");
  const err = params.get("meta_erro");
  const [sess, setSess] = useState<{ kind: string; options: Option[] } | null>(null);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);

  const clear = () => { params.delete("meta"); params.delete("meta_erro"); setParams(params, { replace: true }); };
  useEffect(() => {
    if (err) { toast({ variant: "destructive", title: "Não conectou", description: err }); clear(); }
  }, [err]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) return;
    void supabase.from("meta_connect_sessions").select("kind, options").eq("id", sessionId).maybeSingle().then(({ data }) => {
      if (!data) { toast({ variant: "destructive", title: "A conexão expirou", description: "Clique em Conectar com o Facebook de novo." }); clear(); return; }
      const opts = (data.options as unknown as Option[]) ?? [];
      setSess({ kind: data.kind, options: opts });
      setChoice(opts.length === 1 ? opts[0].id : "");
    });
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!sess || !sessionId) return null;
  const close = async (cancel: boolean) => {
    if (cancel) await callFunction("meta-connect", { action: "cancel", session: sessionId });
    setSess(null); clear();
  };
  const finish = async () => {
    setBusy(true);
    const r = await callFunction<{ name: string; instagram?: string | null }>("meta-connect", { action: "finish", session: sessionId, choice });
    setBusy(false);
    if (!r.ok) return toast({ variant: "destructive", title: "Não conectou", description: r.message });
    toast({ title: sess.kind === "pages" ? `Página ${r.data.name} conectada` : `Número ${r.data.name} conectado`,
      description: sess.kind === "pages" ? (r.data.instagram ? `Instagram @${r.data.instagram} também.` : "Sem Instagram ligado a esta Página.") : "Já pode receber e enviar pela API oficial." });
    await close(false);
    onDone();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && void close(true)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{sess.kind === "pages" ? "Qual Página conectar?" : "Qual número conectar?"}</DialogTitle>
          <DialogDescription>Estas são as que você liberou no login do Facebook.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {sess.options.map((o) => (
            <label key={o.id} className={`flex items-center gap-2 rounded-md border p-2 text-sm cursor-pointer ${choice === o.id ? "border-primary bg-primary/5" : ""}`}>
              <input type="radio" name="meta-choice" checked={choice === o.id} onChange={() => setChoice(o.id)} /> {o.label}
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => void close(true)}>Cancelar</Button>
          <Button disabled={!choice || busy} onClick={() => void finish()}>{busy ? "Conectando..." : "Conectar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
