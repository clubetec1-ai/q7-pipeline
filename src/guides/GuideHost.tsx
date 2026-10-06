import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ArrowLeft, ArrowRight, Film } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DemoPlayer } from "./DemoPlayer";
import { guideById, guidesFor } from "./registry";
import { guideSeen, markGuideSeen } from "./types";

/**
 * Mostra os passo a passo: abre sozinho na primeira visita à tela e quando alguém chama
 * openGuide(id) (botão de ajuda, "Como funciona"). Cada passo tem texto + vídeo curto.
 */
export function GuideHost() {
  const { pathname } = useLocation();
  const [id, setId] = useState<string | null>(null);
  const [i, setI] = useState(0);

  useEffect(() => {
    const onOpen = (e: Event) => { setI(0); setId(String((e as CustomEvent).detail ?? "")); };
    window.addEventListener("guide:open", onOpen);
    return () => window.removeEventListener("guide:open", onOpen);
  }, []);
  useEffect(() => {
    const g = guidesFor(pathname).find((x) => x.autoOpen && !guideSeen(x.id));
    if (!g) return;
    const t = window.setTimeout(() => { setI(0); setId(g.id); }, 500);
    return () => window.clearTimeout(t);
  }, [pathname]);

  const g = id ? guideById(id) : undefined;
  if (!g) return null;
  const s = g.steps[i];
  const last = i === g.steps.length - 1;
  const close = () => { markGuideSeen(g.id); setId(null); setI(0); };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <p className="text-xs text-muted-foreground">{g.title} · passo {i + 1} de {g.steps.length}</p>
          <DialogTitle>{s.title}</DialogTitle>
          <DialogDescription className="sr-only">Passo a passo de {g.title}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[1fr_1.15fr]">
          <div className="space-y-3 text-sm">{s.body}</div>
          {(s.video || (s.demo && g.mock)) && (
            <div className="space-y-1">
              <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><Film className="h-3.5 w-3.5" /> Veja o caminho</p>
              {s.video
                ? <video key={s.video} src={s.video} controls playsInline className="w-full rounded-lg border" />
                : <DemoPlayer key={`${g.id}-${i}`} scenes={s.demo!} render={g.mock!} />}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 pt-2">
          <div className="flex gap-1" aria-hidden>
            {g.steps.map((_, k) => <span key={k} className={`h-2 w-2 rounded-full ${k === i ? "bg-primary" : "bg-muted"}`} />)}
          </div>
          <div className="flex gap-2">
            {i > 0 ? <Button variant="ghost" onClick={() => setI(i - 1)}><ArrowLeft className="w-4 h-4 mr-1" /> Voltar</Button>
              : <Button variant="ghost" onClick={close}>Pular</Button>}
            {last ? <Button onClick={close}>Começar <ArrowRight className="w-4 h-4 ml-1" /></Button>
              : <Button onClick={() => setI(i + 1)}>Próximo <ArrowRight className="w-4 h-4 ml-1" /></Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
