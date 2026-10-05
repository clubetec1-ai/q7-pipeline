import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, HelpCircle, Mic, MicVocal, Paperclip, PenLine, Play, Save, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const SEEN_KEY = "clubecrm:diag-guia-visto";
const seen = () => { try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return true; } };
const markSeen = () => { try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* só deste navegador */ } };

/** Imitação de um botão da tela com uma seta apontando: "é aqui que você clica". */
function Pointer({ icon, label, note }: { icon: ReactNode; label: string; note: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="inline-flex shrink-0 items-center gap-1 rounded-md border bg-background px-2.5 py-1 font-medium shadow-sm">{icon}{label}</span>
      <ArrowLeft className="w-4 h-4 shrink-0 text-primary" />
      <span className="text-muted-foreground">{note}</span>
    </div>
  );
}

const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: "Vamos conhecer a sua empresa",
    body: (
      <>
        <p>O Diagnóstico é uma conversa sobre como a sua empresa funciona: o que vende, como atende, os processos de cada setor e o que você quer melhorar.</p>
        <p className="rounded-md bg-primary/10 p-3"><b>Por que é tão importante:</b> é com essas respostas que os agentes de IA vão atender os seus clientes e que montamos os processos da sua empresa. Quanto mais detalhes você contar, mais o atendimento fica com a cara do seu negócio.</p>
        <p>Não tem resposta certa ou errada, e você não precisa fazer tudo de uma vez: vá no seu tempo.</p>
      </>
    ),
  },
  {
    title: "Escolha o jeito de responder",
    body: (
      <>
        <p>Em cada etapa você pode responder do jeito que for mais confortável:</p>
        <Pointer icon={<MicVocal className="w-4 h-4" />} label="Entrevista por voz" note="a IA pergunta falando e você responde falando, como numa conversa" />
        <Pointer icon={<Mic className="w-4 h-4" />} label="Falar" note="você fala e o texto aparece escrito na caixa" />
        <Pointer icon={<PenLine className="w-4 h-4" />} label="Escrever" note="digite direto na caixa, do seu jeito" />
        <p className="text-muted-foreground">Pode misturar: começar falando e completar escrevendo.</p>
      </>
    ),
  },
  {
    title: "Na entrevista por voz, você no controle",
    body: (
      <>
        <Pointer icon={<Play className="w-4 h-4" />} label="Voz" note="escolha a voz que achar mais agradável (dá para ouvir antes)" />
        <Pointer icon={<Mic className="w-4 h-4" />} label="Responder" note="clique quando estiver pronto; pense com calma antes" />
        <Pointer icon={<CheckCircle2 className="w-4 h-4" />} label="Terminei de responder" note="clique quando acabar de falar" />
        <p className="text-muted-foreground">Pode pedir para ouvir a pergunta de novo e encerrar quando quiser. O áudio não fica guardado, só o texto.</p>
      </>
    ),
  },
  {
    title: "Anexe o que você já tem",
    body: (
      <>
        <Pointer icon={<Paperclip className="w-4 h-4" />} label="Anexar materiais" note="PDF, Word, Excel ou texto, até 10 MB" />
        <p>Exemplos que ajudam muito: <b>modelo de orçamento</b>, <b>tabela de preços</b>, <b>missão, visão e valores</b>, roteiro de atendimento, contratos, manuais, fluxogramas.</p>
        <p className="text-muted-foreground">Durante a entrevista, quando você citar um desses materiais, a IA lembra de pedir o arquivo. A IA lê tudo junto com as suas respostas.</p>
      </>
    ),
  },
  {
    title: "Tudo fica salvo, etapa por etapa",
    body: (
      <>
        <Pointer icon={<Save className="w-4 h-4" />} label="Continuar entrevista" note="cada resposta é salva na hora; se fechar a página, continue de onde parou" />
        <Pointer icon={<Sparkles className="w-4 h-4" />} label="Organizar com IA" note="a IA arruma o que você contou para você conferir" />
        <Pointer icon={<CheckCircle2 className="w-4 h-4" />} label="Aprovar" note="você confere, corrige se precisar, aprova e segue para a próxima etapa" />
        <p className="text-muted-foreground">Ficou em dúvida em alguma etapa? Pode pular e voltar depois.</p>
      </>
    ),
  },
];

/** Passo a passo do Diagnóstico: abre sozinho na primeira visita e pelo botão "Como funciona". */
export function HowItWorks() {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  useEffect(() => { if (!seen()) setOpen(true); }, []);
  const close = () => { markSeen(); setOpen(false); setI(0); };
  const last = i === STEPS.length - 1;
  const s = STEPS[i];

  return (
    <>
      <Button type="button" size="sm" variant="ghost" className="w-full justify-start" onClick={() => setOpen(true)}>
        <HelpCircle className="w-4 h-4 mr-2" /> Como funciona
      </Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <p className="text-xs text-muted-foreground">Passo {i + 1} de {STEPS.length}</p>
            <DialogTitle>{s.title}</DialogTitle>
            <DialogDescription className="sr-only">Como responder o Diagnóstico</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">{s.body}</div>
          <div className="flex items-center justify-between gap-2 pt-2">
            <div className="flex gap-1" aria-hidden>
              {STEPS.map((_, k) => <span key={k} className={`h-2 w-2 rounded-full ${k === i ? "bg-primary" : "bg-muted"}`} />)}
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
    </>
  );
}
