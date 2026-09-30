import { useCallback, useEffect, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { Navigate, useNavigate } from "react-router-dom";
import { ExternalLink, FileText, LogOut, Trash2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { Logo } from "@/components/Logo";
import { MainNav } from "@/components/MainNav";
import { NumberHealthBanner } from "@/components/NumberHealthBanner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface FileRow { id: string; name: string; description: string | null; media_path: string; mime: string | null; size: number | null }

/** Tipos que o WhatsApp aceita (o servidor confere de novo ao enviar). */
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.mp4,.mp3,.ogg,.txt,.csv,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx";
const MAX = 100 * 1024 * 1024;
const kb = (n: number | null) => (!n ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Biblioteca de arquivos da empresa: atendentes enviam, fluxos e IA usam. */
export default function Biblioteca() {
  const { signOut, user } = useAuth();
  const { org, can } = useOrg();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [rows, setRows] = useState<FileRow[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<FileRow | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!org) return;
    const { data } = await supabase.from("library_files").select("id, name, description, media_path, mime, size")
      .eq("organization_id", org.id).order("name");
    setRows((data as FileRow[]) ?? []);
  }, [org]);
  useEffect(() => { void load(); }, [load]);

  if (!org) return null;
  if (!can("library.manage")) return <Navigate to="/" replace />;

  const upload = async () => {
    if (!file) return;
    if (file.size > MAX) return toast({ variant: "destructive", title: "Arquivo maior que 100 MB" });
    setBusy(true);
    const ext = (file.name.match(/\.[A-Za-z0-9]{1,8}$/)?.[0] ?? "").toLowerCase();
    const path = `${org.id}/library/${crypto.randomUUID()}${ext}`;
    const up = await supabase.storage.from("media").upload(path, file, { contentType: file.type || undefined });
    if (up.error) { setBusy(false); return toast({ variant: "destructive", title: "Não foi possível enviar", description: up.error.message }); }
    const { error } = await supabase.from("library_files").insert({
      organization_id: org.id, name: (name.trim() || file.name).slice(0, 120), description: description.trim() || null,
      media_path: path, mime: file.type || null, size: file.size, created_by: user?.id,
    });
    setBusy(false);
    if (error) {
      await supabase.storage.from("media").remove([path]);
      return toast({ variant: "destructive", title: "Não foi possível salvar", description: error.message });
    }
    setFile(null); setName(""); setDescription("");
    if (input.current) input.current.value = "";
    toast({ title: "Arquivo adicionado" });
    void load();
  };

  const open = async (r: FileRow) => {
    const { data } = await supabase.storage.from("media").createSignedUrl(r.media_path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  };

  const remove = async () => {
    if (!deleting) return;
    const { error } = await supabase.from("library_files").delete().eq("id", deleting.id);
    if (!error) await supabase.storage.from("media").remove([deleting.media_path]);
    setDeleting(null);
    if (error) return toast({ variant: "destructive", title: "Não foi possível apagar" });
    void load();
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="biblioteca" />
      <NumberHealthBanner />

      <main className="flex-1 w-full max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Biblioteca</h1>
          <p className="text-sm text-muted-foreground">
            Catálogos, tabelas de preço, manuais… A equipe envia pela conversa, as respostas rápidas e os fluxos anexam,
            e a IA envia quando você permitir no bloco “Agente de IA”.
          </p>
        </div>

        <section className="rounded-lg border p-4 space-y-3">
          <input ref={input} type="file" accept={ACCEPT} className="text-sm"
            onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f && !name) setName(f.name.replace(/\.[^.]+$/, "")); }} />
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="Nome (ex.: Tabela de preços 2026)" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Descrição para a IA (quando enviar)" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <Button onClick={upload} disabled={!file || busy}><Upload className="w-4 h-4 mr-1" /> {busy ? "Enviando..." : "Adicionar"}</Button>
          <p className="text-xs text-muted-foreground">Até 100 MB (no WhatsApp: imagens até 5 MB; áudio e vídeo até 16 MB).</p>
        </section>

        {rows.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum arquivo ainda.</p> : (
          <div className="divide-y rounded-lg border">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-3 p-3">
                <FileText className="w-5 h-5 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{r.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{[r.description, kb(r.size)].filter(Boolean).join(" · ")}</p>
                </div>
                <Button variant="ghost" size="icon" title="Abrir" onClick={() => open(r)}><ExternalLink className="w-4 h-4" /></Button>
                <Button variant="ghost" size="icon" title="Apagar" onClick={() => setDeleting(r)}><Trash2 className="w-4 h-4" /></Button>
              </div>
            ))}
          </div>
        )}
      </main>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Respostas rápidas com este arquivo passam a enviar só o texto. Fluxos e agentes de IA que usam o arquivo deixam de enviá-lo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Apagar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
