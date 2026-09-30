import { forwardRef, useState } from "react";
import { Paperclip, Upload } from "lucide-react";

/**
 * Seletor de arquivo no padrão do sistema: botão + arrastar e soltar, mostrando o
 * nome escolhido (no lugar do "Escolher arquivo" do navegador).
 */
export const FilePicker = forwardRef<HTMLInputElement, { accept?: string; file: File | null; onFile: (f: File | null) => void; hint?: string }>(
  function FilePicker({ accept, file, onFile, hint }, ref) {
    const [over, setOver] = useState(false);
    return (
      <label
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
        className={`flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-4 text-center cursor-pointer transition ${over ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}>
        {file ? (
          <span className="inline-flex items-center gap-2 text-sm font-medium"><Paperclip className="w-4 h-4" /> {file.name}</span>
        ) : (
          <>
            <Upload className="w-5 h-5 text-muted-foreground" />
            <span className="text-sm"><b>Escolher arquivo</b> ou arraste aqui</span>
          </>
        )}
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      </label>
    );
  },
);
