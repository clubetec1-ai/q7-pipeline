import { useEffect, useState } from "react";
import { AlertTriangle, Check, CheckCheck, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export interface MediaFields {
  type?: string;
  media_path?: string | null;
  media_mime?: string | null;
  media_name?: string | null;
  media_size?: number | null;
}

function size(n?: number | null) {
  if (!n) return "";
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * Mídia da mensagem com URL assinada de 10 min (o bucket é privado; a RLS de
 * storage confere se o usuário vê a conversa). Arquivo sem tipo seguro
 * (octet-stream) nunca é exibido inline: só baixa depois de um aviso.
 */
export function MessageMedia({ m }: { m: MediaFields }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!m.media_path) return;
    supabase.storage.from("media").createSignedUrl(m.media_path, 600).then(({ data }) => setUrl(data?.signedUrl ?? null));
  }, [m.media_path]);

  if (!m.type || m.type === "text") return null;
  if (!m.media_path) return <div className="text-xs italic opacity-70">arquivo indisponível</div>;
  if (!url) return <div className="text-xs opacity-70">carregando arquivo…</div>;

  const mime = m.media_mime ?? "";
  if ((m.type === "image" || m.type === "sticker") && mime.startsWith("image/")) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        <img src={url} alt={m.media_name ?? "imagem"} className="max-h-64 rounded-md" loading="lazy" />
      </a>
    );
  }
  if (m.type === "audio" && mime.startsWith("audio/")) return <audio controls src={url} className="max-w-full" />;
  if (m.type === "video" && mime.startsWith("video/")) return <video controls src={url} className="max-h-64 rounded-md" />;

  const unsafe = mime === "application/octet-stream";
  return (
    <a
      href={url}
      download={m.media_name ?? undefined}
      rel="noopener noreferrer"
      onClick={(e) => {
        if (unsafe && !window.confirm("Este arquivo pode ser perigoso. Baixar mesmo assim?")) e.preventDefault();
      }}
      className="flex items-center gap-2 rounded-md border border-current/20 px-2 py-1.5 text-xs hover:opacity-80"
    >
      {unsafe ? <AlertTriangle className="w-4 h-4 shrink-0" /> : <FileText className="w-4 h-4 shrink-0" />}
      <span className="truncate">{m.media_name ?? "arquivo"}</span>
      <span className="opacity-70 shrink-0">{size(m.media_size)}</span>
    </a>
  );
}

/** ✓ enviado · ✓✓ entregue · ✓✓ (destaque) lido · ! falhou */
export function DeliveryStatus({ status, error }: { status?: string | null; error?: string | null }) {
  if (!status) return null;
  if (status === "failed") {
    return <span title={error ?? "Falhou"} className="inline-flex items-center gap-0.5 text-xs font-semibold text-red-900"><AlertTriangle className="w-3 h-3" /> falhou</span>;
  }
  // Ícone + texto: cor sozinha não basta sobre o balão colorido.
  if (status === "read") {
    return <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-blue-900"><CheckCheck className="w-3.5 h-3.5" /> lida</span>;
  }
  if (status === "delivered") {
    return <span className="inline-flex items-center gap-0.5 text-xs opacity-90"><CheckCheck className="w-3.5 h-3.5" /> entregue</span>;
  }
  return <span className="inline-flex items-center gap-0.5 text-xs opacity-80"><Check className="w-3.5 h-3.5" /> enviada</span>;
}
