import { CheckCircle2, HelpCircle, LifeBuoy, Mic, MicVocal, Paperclip, Pause, PenLine, Play, PlayCircle, RotateCcw, Save, Sparkles, ThumbsDown, Undo2 } from "lucide-react";
import { Pointer } from "./Pointer";
import { DiagMock } from "./mocks/DiagMock";
import { SupportMock } from "./mocks/SupportMock";
import type { Guide } from "./types";

/**
 * Passo a passo de cada tela (padrão do produto: toda tela que o cliente usa sozinho tem
 * um guia aqui, com demonstração animada ou vídeo). Novo guia = novo item nesta lista.
 */
export const GUIDES: Guide[] = [
  {
    id: "diagnostico",
    title: "Diagnóstico da empresa",
    routes: ["/diagnostico"],
    autoOpen: true,
    mock: (state) => <DiagMock state={state} />,
    steps: [
      {
        title: "Vamos conhecer a sua empresa",
        body: (
          <>
            <p>O Diagnóstico é uma conversa sobre como a sua empresa funciona: o que vende, como atende, os processos de cada setor e o que você quer melhorar.</p>
            <p className="rounded-md bg-primary/10 p-3"><b>Por que é tão importante:</b> é com essas respostas que os agentes de IA vão atender os seus clientes e que montamos os processos da sua empresa. Quanto mais detalhes você contar, mais o atendimento fica com a cara do seu negócio.</p>
            <p>Não tem resposta certa ou errada, e você não precisa fazer tudo de uma vez: vá no seu tempo.</p>
          </>
        ),
        demo: [
          { state: "pagina", target: "nav-empresa", caption: "As etapas ficam no menu da esquerda" },
          { state: "pagina", target: "titulo", caption: "Em cima, o que contar nesta etapa" },
          { state: "aprovado", target: "nav-empresa", caption: "Etapa concluída ganha ✓ e você segue para a próxima" },
        ],
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
        demo: [
          { state: "pagina", target: "caixa", caption: "Escreva direto na caixa…" },
          { state: "escrevendo", target: "caixa", caption: "…do seu jeito, sem formalidade" },
          { state: "escrevendo", target: "btn-falar", caption: "Ou clique em Falar…" },
          { state: "falando", target: "btn-falar", caption: "…e o que você fala vira texto" },
          { state: "pagina", target: "btn-entrevista", caption: "Ou faça a entrevista por voz" },
        ],
      },
      {
        title: "Na entrevista por voz, você no controle",
        body: (
          <>
            <Pointer icon={<Play className="w-4 h-4" />} label="Voz" note="escolha a voz que achar mais agradável (dá para ouvir antes)" />
            <Pointer icon={<Mic className="w-4 h-4" />} label="Responder" note="clique quando estiver pronto; pense com calma antes" />
            <Pointer icon={<CheckCircle2 className="w-4 h-4" />} label="Terminei de responder" note="clique quando acabar de falar" />
            <Pointer icon={<Pause className="w-4 h-4" />} label="Pausar" note="deu um branco? pause e continue quando quiser" />
            <Pointer icon={<RotateCcw className="w-4 h-4" />} label="Recomeçar esta resposta" note="errou? apaga só esta resposta e começa de novo" />
            <Pointer icon={<Undo2 className="w-4 h-4" />} label="Pergunta anterior" note="volta uma pergunta para responder de novo, sem perder as outras" />
            <p className="text-muted-foreground">Pode pedir para ouvir a pergunta de novo e encerrar quando quiser. O áudio não fica guardado, só o texto.</p>
          </>
        ),
        demo: [
          { state: "pagina", target: "btn-entrevista", caption: "Clique em Entrevista por voz" },
          { state: "entrevista", target: "voz", caption: "Escolha a voz (dá para ouvir antes)" },
          { state: "entrevista", target: "btn-responder", caption: "Pense com calma e clique em Responder" },
          { state: "ouvindo", target: "btn-pausar", caption: "Deu um branco? Pausar (ou recomeçar só esta resposta)" },
          { state: "ouvindo", target: "btn-terminei", caption: "Fale e clique em Terminei de responder" },
          { state: "pergunta2", caption: "A IA faz a próxima pergunta — cada resposta já fica salva", ms: 3400 },
        ],
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
        demo: [
          { state: "pergunta2", target: "btn-anexar-material", caption: "Citou um material? Aparece o botão para anexar" },
          { state: "anexado", caption: "O arquivo fica guardado e a IA lê junto", ms: 2600 },
          { state: "pagina", target: "btn-anexar", caption: "Também dá para anexar a qualquer momento" },
        ],
      },
      {
        title: "Tudo fica salvo, etapa por etapa",
        body: (
          <>
            <Pointer icon={<Save className="w-4 h-4" />} label="Salvar e próxima etapa" note="guarda o que você contou e já leva para a próxima etapa" />
            <Pointer icon={<Sparkles className="w-4 h-4" />} label="Organizar com IA" note="quando quiser, a IA arruma o que você contou para conferir" />
            <Pointer icon={<CheckCircle2 className="w-4 h-4" />} label="Aprovar e seguir" note="você confere, corrige se precisar e aprova" />
            <Pointer icon={<Mic className="w-4 h-4" />} label="Falar" note="na conferência também: cada caixa tem o microfone para completar falando" />
            <p className="text-muted-foreground">O texto é salvo sozinho enquanto você escreve: se fechar ou atualizar a página, continua de onde parou. Ficou em dúvida? Pode pular e voltar depois.</p>
          </>
        ),
        demo: [
          { state: "salvo", target: "salvo", caption: "Tudo é salvo sozinho enquanto você escreve" },
          { state: "salvo", target: "btn-salvar-proxima", caption: "Salvar e próxima etapa: guarda e já avança" },
          { state: "proxima", target: "titulo", caption: "Próxima etapa — volte na anterior quando quiser" },
          { state: "salvo", target: "btn-organizar", caption: "Quando quiser: Organizar com IA…" },
          { state: "organizado", target: "btn-aprovar", caption: "…confira e aprove" },
        ],
      },
    ],
  },
  {
    id: "suporte",
    title: "Ajuda e suporte",
    routes: ["/configuracoes/suporte"],
    autoOpen: true,
    mock: (state) => <SupportMock state={state} />,
    steps: [
      {
        title: "Primeiro, a Ajuda",
        body: (
          <>
            <Pointer icon={<HelpCircle className="w-4 h-4" />} label="?" note="no topo de qualquer tela: abre a Ajuda" />
            <Pointer icon={<PlayCircle className="w-4 h-4" />} label="Passo a passo e vídeo" note="o caminho da tela em que você está" />
            <p>Na Ajuda você também pergunta "como faço…?" e a IA responde com o caminho e um botão que leva à tela certa.</p>
          </>
        ),
        demo: [
          { state: "ajuda", target: "btn-ajuda", caption: "Clique no ? no topo da tela" },
          { state: "ajuda", target: "btn-guia", caption: "Veja o passo a passo e o vídeo desta tela" },
          { state: "ajuda", target: "btn-sim", caption: "Ou pergunte: a IA mostra o caminho" },
        ],
      },
      {
        title: "Não resolveu? A Ajuda abre o chamado",
        body: (
          <>
            <Pointer icon={<ThumbsDown className="w-4 h-4" />} label="Não resolveu" note="aparece depois de cada resposta da IA" />
            <Pointer icon={<LifeBuoy className="w-4 h-4" />} label="Abrir chamado" note="vai com a conversa, a tela e a urgência que a IA avaliou" />
            <p className="text-muted-foreground">A equipe Clubetec é avisada na hora; chamados urgentes também chegam por e-mail para ela.</p>
          </>
        ),
        demo: [
          { state: "ajuda", target: "btn-nao", caption: "Não resolveu? Clique aqui" },
          { state: "nao", target: "btn-abrir", caption: "Abrir chamado: a conversa vai junto" },
          { state: "aberto", target: "aberto", caption: "Pronto — a equipe já foi avisada" },
        ],
      },
      {
        title: "Acompanhe aqui",
        body: (
          <>
            <p>Nesta tela ficam todos os chamados da empresa, com a urgência, a situação e a <b>resposta da equipe</b>. Quando a situação muda, você também recebe um aviso no sino.</p>
            <p className="text-muted-foreground">Também dá para abrir um chamado direto aqui, escolhendo a urgência.</p>
          </>
        ),
        demo: [
          { state: "lista", target: "chamado", caption: "Situação e resposta da equipe em cada chamado", ms: 3600 },
        ],
      },
    ],
  },
];

export const guidesFor = (pathname: string) => GUIDES.filter((g) => g.routes.includes(pathname));
export const guideById = (id: string) => GUIDES.find((g) => g.id === id);
