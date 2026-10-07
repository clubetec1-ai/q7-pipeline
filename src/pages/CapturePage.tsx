import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

interface Page { nome: string; titulo: string; texto: string; link: string }

/**
 * Página de captação pública (/c/:slug; Etapa B, item 3): o que o dono publicou em Funil de vendas, com o botão do
 * WhatsApp que já marca a origem do contato. Sem login.
 */
export default function CapturePage() {
  const { slug } = useParams<{ slug: string }>();
  const [page, setPage] = useState<Page | null | "erro">(null);
  useEffect(() => {
    void supabase.functions.invoke("capture-page", { body: { slug } }).then(({ data, error }) => {
      const d = data as (Page & { ok: boolean }) | null;
      setPage(!error && d?.ok ? d : "erro");
    });
  }, [slug]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 py-10">
      {page === null ? (
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      ) : page === "erro" ? (
        <p className="text-sm text-muted-foreground">Esta página não está disponível.</p>
      ) : (
        <main className="w-full max-w-md rounded-2xl border bg-card p-6 text-center space-y-4 shadow-sm">
          <p className="text-sm text-muted-foreground">{page.nome}</p>
          <h1 className="font-brand text-2xl leading-tight">{page.titulo}</h1>
          {page.texto && <p className="whitespace-pre-line text-sm">{page.texto}</p>}
          <Button asChild size="lg" className="w-full">
            <a href={page.link} rel="noopener noreferrer"><MessageCircle className="w-5 h-5 mr-2" /> Falar no WhatsApp</a>
          </Button>
          <p className="text-[11px] text-muted-foreground">Atendimento com Deixa com a IA</p>
        </main>
      )}
    </div>
  );
}
