import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Member } from "./useEquipeData";

/** Escolha de pessoas para um departamento ou grupo. Devolve o que entrou e o que saiu. */
export function MembersPicker({
  open, title, description, candidates, selected, onClose, onSave,
}: {
  open: boolean;
  title: string;
  description: string;
  candidates: Member[];
  selected: string[];
  onClose: () => void;
  onSave: (added: string[], removed: string[]) => Promise<void>;
}) {
  const [picked, setPicked] = useState<string[]>(selected);
  const [saving, setSaving] = useState(false);
  useEffect(() => setPicked(selected), [selected, open]);

  const save = async () => {
    setSaving(true);
    await onSave(
      picked.filter((id) => !selected.includes(id)),
      selected.filter((id) => !picked.includes(id)),
    );
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="max-h-72 overflow-y-auto space-y-2">
          {candidates.length === 0 && <p className="text-sm text-muted-foreground">Ninguém disponível.</p>}
          {candidates.map((m) => (
            <label key={m.user_id} className="flex items-center gap-3 rounded-md border p-2 text-sm">
              <Checkbox checked={picked.includes(m.user_id)}
                onCheckedChange={(c) => setPicked((cur) => (c ? [...cur, m.user_id] : cur.filter((x) => x !== m.user_id)))} />
              <span className="font-medium">{m.name}</span>
              <span className="text-muted-foreground truncate">{m.email}</span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
