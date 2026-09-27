import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface LibraryPick { id: string; name: string }

/** Escolhe um arquivo da biblioteca da empresa para enviar na conversa. */
export function LibraryPicker({ orgId, onPick, disabled }: { orgId: string; onPick: (f: LibraryPick) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<LibraryPick[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!open) return;
    supabase.from("library_files").select("id, name").eq("organization_id", orgId).order("name")
      .then(({ data }) => setFiles(data ?? []));
  }, [open, orgId]);

  const shown = files.filter((f) => f.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" title="Arquivo da biblioteca" disabled={disabled}><BookOpen className="w-4 h-4" /></Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2 space-y-2">
        <Input className="h-8" placeholder="Buscar arquivo" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="max-h-60 overflow-y-auto">
          {shown.length === 0 && <p className="text-xs text-muted-foreground p-2">Nenhum arquivo na biblioteca.</p>}
          {shown.map((f) => (
            <button key={f.id} type="button" className="w-full text-left text-sm rounded px-2 py-1.5 hover:bg-muted truncate"
              onClick={() => { onPick(f); setOpen(false); setQ(""); }}>{f.name}</button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
