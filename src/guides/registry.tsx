import { CheckCircle2, Clock, Network, PencilRuler, Facebook, FlaskConical, HelpCircle, LifeBuoy, Mail, Mic, MicVocal, MoreHorizontal, Paperclip, Pause, PenLine, Play, PlayCircle, Plus, QrCode, RotateCcw, Save, ShieldCheck, Sparkles, ThumbsDown, Undo2 } from "lucide-react";
import { Pointer } from "./Pointer";
import { AgenteMock } from "./mocks/AgenteMock";
import { DiagMock } from "./mocks/DiagMock";
import { OrganogramaMock } from "./mocks/OrganogramaMock";
import { ProcessosMock } from "./mocks/ProcessosMock";
import { NumerosMock } from "./mocks/NumerosMock";
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
      {
        title: "Veja o que falta e a revisão do diretor",
        body: (
          <>
            <p>Depois de organizar, aparece a barra <b>📊 Informação completa</b>: o que os agentes de IA precisam saber desta etapa, o que já está completo e o que ainda falta, com o <b>porquê</b> de cada item.</p>
            <Pointer icon={<CheckCircle2 className="w-4 h-4" />} label="Não temos isso" note="a empresa não tem aquilo? marque: conta como resolvido e a IA não pergunta mais" />
            <p>Logo abaixo, o <b>🧐 diretor da área (IA)</b> dá uma segunda opinião: aponta o que não bate com as outras etapas e os riscos (ex.: uma promessa que o agente não pode fazer).</p>
            <Pointer icon={<CheckCircle2 className="w-4 h-4" />} label="Corrigi / Está certo assim" note="ajustou o texto? marque Corrigi. Não é problema? Está certo assim — a IA não aponta mais"/>
            <p className="text-muted-foreground">Dá para aprovar com algo faltando — o sistema avisa o que o agente pode não conseguir resolver, e você completa quando puder (escrevendo, falando ou anexando).</p>
          </>
        ),
        demo: [
          { state: "organizado", target: "cobertura", caption: "Informação completa: o que já tem e o que falta" },
          { state: "organizado", target: "btn-nao-temos", caption: "Não tem isso na empresa? Marque Não temos isso" },
          { state: "organizado", target: "revisao", caption: "O diretor da área revisa e aponta o que não bate" },
          { state: "organizado", target: "btn-certo", caption: "Corrigi ou Está certo assim — você decide" },
          { state: "organizado", target: "btn-aprovar", caption: "Aprove — se faltar algo, o sistema avisa antes" },
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
  {
    id: "numeros",
    title: "WhatsApp, e-mail e redes",
    routes: ["/numeros"],
    autoOpen: true,
    mock: (state) => <NumerosMock state={state} />,
    steps: [
      {
        title: "Todos os seus canais num lugar só",
        body: (
          <>
            <p>Aqui você liga os canais por onde os clientes falam com a sua empresa: <b>WhatsApp</b>, <b>e-mail</b>, <b>Facebook</b> e <b>Instagram</b>. Tudo o que chegar por eles cai em Conversas, com a IA respondendo se você quiser.</p>
            <p>Cada número mostra se está <b>Conectado</b> (verde) ou com problema (vermelho), e quando chegou a última mensagem.</p>
            <p className="text-muted-foreground">Comece pelo WhatsApp principal da empresa. O resto pode ficar para depois.</p>
          </>
        ),
        demo: [
          { state: "lista", target: "card-numero", caption: "Cada número com a situação: verde é conectado" },
          { state: "lista", target: "btn-email", caption: "Embaixo, os e-mails…" },
          { state: "lista", target: "btn-facebook", caption: "…e o Facebook e o Instagram" },
        ],
      },
      {
        title: "WhatsApp oficial: o jeito recomendado",
        body: (
          <>
            <Pointer icon={<Plus className="w-4 h-4" />} label="Adicionar número" note="no canto de cima" />
            <Pointer icon={<ShieldCheck className="w-4 h-4" />} label="WhatsApp oficial (Meta)" note="sem risco de bloqueio" />
            <Pointer icon={<Facebook className="w-4 h-4" />} label="Conectar o WhatsApp com o Facebook" note="entre com o Facebook da empresa e escolha o número" />
            <p className="text-muted-foreground">Não precisa copiar código nenhum. Se a Meta pedir, use o mesmo login que administra a página da empresa.</p>
          </>
        ),
        demo: [
          { state: "lista", target: "btn-adicionar", caption: "Clique em Adicionar número" },
          { state: "add", target: "opt-meta", caption: "Escolha WhatsApp oficial (recomendado)" },
          { state: "meta", target: "btn-fb-whatsapp", caption: "Entre com o Facebook e escolha o número" },
          { state: "lista", target: "card-numero", caption: "Pronto: o número aparece conectado" },
        ],
      },
      {
        title: "Ou conecte lendo um QR Code",
        body: (
          <>
            <Pointer icon={<QrCode className="w-4 h-4" />} label="Por QR Code" note="para um WhatsApp comum, lendo o código com o celular" />
            <p>Dê um nome (ex.: Suporte), clique em Continuar e, no celular, abra o WhatsApp → <b>Aparelhos conectados</b> → <b>Conectar aparelho</b> e aponte para o código.</p>
            <p className="rounded-md bg-warning-soft p-2 text-warning-text">Atenção: esse jeito não é oficial e o WhatsApp pode bloquear o número. Use para números secundários.</p>
          </>
        ),
        demo: [
          { state: "add", target: "opt-qr", caption: "Escolha Por QR Code" },
          { state: "qr-nome", target: "btn-continuar", caption: "Dê um nome e clique em Continuar" },
          { state: "qr", target: "qr", caption: "No celular: Aparelhos conectados → Conectar aparelho", ms: 3400 },
          { state: "conectado", target: "novo-numero", caption: "Leu o código? O número aparece conectado" },
        ],
      },
      {
        title: "E-mail da empresa",
        body: (
          <>
            <Pointer icon={<Mail className="w-4 h-4" />} label="Conectar e-mail" note="escolha o provedor (Gmail, Outlook, Hostinger…) e os servidores vêm preenchidos" />
            <Pointer icon={<CheckCircle2 className="w-4 h-4" />} label="Testar conexão" note="confere antes de salvar; se der erro, a mensagem diz o que corrigir" />
            <p>Escolha também o <b>setor</b> que recebe esses e-mails. No Gmail, use uma <b>senha de app</b> (Conta Google → Segurança → Senhas de app).</p>
            <p className="text-muted-foreground">E-mails automáticos (boletos, avisos, newsletters) não viram atendimento.</p>
          </>
        ),
        demo: [
          { state: "lista", target: "btn-email", caption: "Clique em Conectar e-mail" },
          { state: "email", target: "provedor", caption: "Escolha o provedor: os servidores já vêm prontos" },
          { state: "email", target: "btn-testar", caption: "Teste a conexão…" },
          { state: "email-ok", target: "btn-email", caption: "…salve, e os e-mails chegam em Conversas" },
        ],
      },
      {
        title: "Facebook e Instagram",
        body: (
          <>
            <Pointer icon={<Facebook className="w-4 h-4" />} label="Conectar com o Facebook" note="entre e escolha a Página da empresa" />
            <p>O Instagram ligado à Página entra junto. As mensagens do Messenger e do Direct aparecem em Conversas, como o WhatsApp.</p>
          </>
        ),
        demo: [
          { state: "lista", target: "btn-facebook", caption: "Clique em Conectar com o Facebook" },
          { state: "pagina-ok", target: "btn-facebook", caption: "Escolha a Página: pronto, Messenger e Instagram ligados" },
        ],
      },
      {
        title: "Se um número cair",
        body: (
          <>
            <p>Se um número desconectar, ele fica <b>vermelho</b> aqui, aparece um aviso no topo das telas e você recebe um alerta no sino.</p>
            <Pointer icon={<MoreHorizontal className="w-4 h-4" />} label="⋯ → Reconectar (QR Code)" note="lê o código de novo; as conversas continuam" />
            <p className="text-muted-foreground">Não resolveu? Clique no <b>?</b> no topo e peça ajuda: a IA mostra o caminho e, se precisar, abre o chamado para a equipe.</p>
          </>
        ),
        demo: [
          { state: "caiu", target: "card-numero", caption: "Número com problema fica vermelho" },
          { state: "menu", target: "btn-menu", caption: "Clique em ⋯" },
          { state: "menu", target: "btn-reconectar", caption: "Reconectar (QR Code) e leia o código de novo" },
        ],
      },
    ],
  },
  {
    id: "agente",
    title: "Assistente de IA",
    routes: ["/agente"],
    autoOpen: true,
    mock: (state) => <AgenteMock state={state} />,
    steps: [
      {
        title: "Uma IA atendendo seus clientes na hora",
        body: (
          <>
            <p>O assistente responde os clientes no WhatsApp, no e-mail e nas redes <b>na hora, a qualquer horário</b>, e passa para uma pessoa da equipe quando precisa.</p>
            <p>Ele usa o que você contou no <b>Diagnóstico</b>: produtos, horários, regras, jeito de falar da marca e perfil dos clientes. Quanto mais completo o Diagnóstico, melhor ele atende.</p>
            <Pointer icon={<ShieldCheck className="w-4 h-4" />} label="O que a IA nunca faz" note="regras fixas de segurança: sem desconto, sem prometer prazo, sem pedir dados de cartão" />
          </>
        ),
        demo: [
          { state: "inicio", target: "regras", caption: "Regras fixas: o que a IA nunca faz" },
          { state: "inicio", target: "toggle", caption: "Comece desligado e teste antes" },
        ],
      },
      {
        title: "Diga como ele deve se comportar",
        body: (
          <>
            <Pointer icon={<Sparkles className="w-4 h-4" />} label="Usar texto sugerido" note="um ponto de partida pronto; ajuste do seu jeito" />
            <Pointer icon={<Mic className="w-4 h-4" />} label="Falar" note="prefere falar? clique e fale, o texto aparece na caixa" />
            <p>Escreva em poucas linhas o papel dele (ex.: "você é o atendente da loja, simpático, tira dúvidas e passa para o vendedor quando o cliente quer orçamento").</p>
            <p className="text-muted-foreground">Não precisa repetir o que já está no Diagnóstico: tom de voz, regras e perfil dos clientes entram sozinhos.</p>
          </>
        ),
        demo: [
          { state: "inicio", target: "btn-sugerido", caption: "Use o texto sugerido…" },
          { state: "sugerido", target: "caixa", caption: "…e ajuste do seu jeito" },
          { state: "sugerido", target: "btn-falar", caption: "Ou fale e o texto aparece" },
        ],
      },
      {
        title: "Teste antes de ligar",
        body: (
          <>
            <Pointer icon={<FlaskConical className="w-4 h-4" />} label="Testar o agente" note="no fim da página: escreva como se fosse o cliente" />
            <p>Faça as perguntas que seus clientes mais fazem e veja as respostas. Teste também um pedido difícil (desconto, reclamação) para ver se ele passa para uma pessoa.</p>
            <p className="text-muted-foreground">Nada é enviado para clientes de verdade. O teste usa o texto da caixa mesmo antes de salvar.</p>
          </>
        ),
        demo: [
          { state: "teste", target: "btn-enviar", caption: "Escreva como cliente e envie" },
          { state: "resposta", target: "resposta", caption: "Veja a resposta. Não gostou? Ajuste o texto e teste de novo", ms: 3400 },
        ],
      },
      {
        title: "Retomar quem parou de responder",
        body: (
          <>
            <Pointer icon={<Clock className="w-4 h-4" />} label="Follow-up automático" note="o agente retoma a conversa sozinho depois do tempo que você escolher" />
            <p className="text-muted-foreground">Comece com 1 vez por conversa. Mais que isso pode incomodar o cliente.</p>
          </>
        ),
        demo: [
          { state: "followup", target: "toggle-follow", caption: "Ligue e escolha depois de quantos minutos" },
        ],
      },
      {
        title: "Salve e ligue",
        body: (
          <>
            <Pointer icon={<Save className="w-4 h-4" />} label="Salvar" note="guarda o comportamento e o follow-up" />
            <p>Testou e gostou? Ligue o agente na chave do topo. A partir daí ele responde os atendimentos que estão com a IA. Se um cliente pedir uma pessoa, ou o assunto for difícil, ele passa para a equipe.</p>
            <p className="text-muted-foreground">Ao salvar, o 🛡️ Guardião de segurança confere o texto: promessas proibidas, pedido de senha ou cartão e dado pessoal escrito não passam. Dá para desligar a qualquer momento: os atendimentos vão direto para a equipe.</p>
          </>
        ),
        demo: [
          { state: "followup", target: "btn-salvar", caption: "Clique em Salvar" },
          { state: "salvo", target: "toggle", caption: "Ligue o agente: pronto, ele já atende" },
        ],
      },
      {
        title: "A IA sobe um degrau por vez",
        body: (
          <>
            <p>Ligada, a IA começa na <b>Sombra</b>: ela sugere a resposta dentro da conversa e uma pessoa envia (botão <b>Usar sugestão</b>). Depois que o Atendente geral (IA) passa na prova, você pode subir para o <b>Assistido</b>: ela envia o simples e passa reclamação, negociação e exceção para uma pessoa. O <b>Automático</b> libera depois de 14 dias no assistido sem tropeço.</p>
            <Pointer icon={<ShieldCheck className="w-4 h-4" />} label="Trava e disjuntor" note="resposta que promete, pede senha ou expõe dado nunca sai; 3 tropeços em 24 h e ela volta um degrau sozinha" />
          </>
        ),
        demo: [
          { state: "degraus", target: "modo-sombra", caption: "Começa na sombra: a IA sugere, você envia" },
          { state: "degraus", target: "modo-assistido", caption: "Com a prova em dia: assistido" },
          { state: "degraus", target: "disjuntor", caption: "O disjuntor protege: volta um degrau sozinho" },
        ],
      },
    ],
  },
  {
    id: "processos",
    title: "Processos da empresa",
    routes: ["/processos"],
    autoOpen: true,
    mock: (state) => <ProcessosMock state={state} />,
    steps: [
      {
        title: "Do Diagnóstico para o passo a passo",
        body: (
          <>
            <p>Aqui aparecem os processos que você contou no <b>Diagnóstico</b>, separados por setor. O <b>Arquiteto de processos (IA)</b> transforma cada um num passo a passo claro: o que dispara, quem faz, com que ferramenta, em quanto tempo e os casos diferentes.</p>
            <Pointer icon={<PencilRuler className="w-4 h-4" />} label="Desenhar com o Arquiteto" note="um processo por vez, ou Desenhar os que faltam do setor" />
          </>
        ),
        demo: [
          { state: "lista", target: "processo", caption: "Cada processo que você contou no Diagnóstico" },
          { state: "lista", target: "btn-desenhar", caption: "Clique em Desenhar com o Arquiteto" },
        ],
      },
      {
        title: "Cada passo diz o que vira automático",
        body: (
          <>
            <p>Em cada passo o Arquiteto indica o caminho mais simples e seguro:</p>
            <p><b>Fluxo automático</b> (regra fixa, sem IA) · <b>Modelo pronto</b> · <b>IA</b> (responde com a base de conhecimento) · <b>Pessoa</b> (decisão da equipe).</p>
            <p className="text-muted-foreground">Ele sempre explica o porquê de cada escolha.</p>
          </>
        ),
        demo: [
          { state: "desenhado", target: "passos", caption: "Cada passo com a decisão: automático, IA ou pessoa", ms: 3600 },
        ],
      },
      {
        title: "Travas de segurança e o Guardião",
        body: (
          <>
            <Pointer icon={<ShieldCheck className="w-4 h-4" />} label="Dinheiro, contrato, saúde ou jurídico" note="sempre fica com uma pessoa — a IA só prepara o resumo" />
            <Pointer icon={<ShieldCheck className="w-4 h-4" />} label="Dados sensíveis do cliente" note="CPF, saúde, dados financeiros ficam marcados, com a base legal da LGPD" />
            <p>Depois de cada desenho, o <b>🛡️ Guardião de segurança e LGPD (IA)</b> revisa tudo. Se ele <b>reprovar</b> (ex.: dado sensível sem base legal, promessa proibida), o processo não pode ser aprovado até corrigir — ele mostra o motivo. "Atenção" são pontos para você conferir.</p>
          </>
        ),
        demo: [
          { state: "desenhado", target: "trava", caption: "Desconto é decisão de pessoa: regra fixa" },
          { state: "desenhado", target: "dados", caption: "Dado sensível sempre marcado" },
          { state: "desenhado", target: "guardiao-selo", caption: "O Guardião de segurança revisa antes de aprovar" },
        ],
      },
      {
        title: "Aprove ou peça ajuste",
        body: (
          <>
            <Pointer icon={<CheckCircle2 className="w-4 h-4" />} label="Aprovar processo" note="você ou o responsável da área do setor" />
            <Pointer icon={<Mic className="w-4 h-4" />} label="Pedir ajuste e redesenhar" note="escreva ou fale o que mudar; o Arquiteto refaz" />
            <p className="text-muted-foreground">Processo aprovado é o que vai virar agentes e fluxos na implantação. Se você mudar algo depois, ele volta para aprovar, com versão nova.</p>
          </>
        ),
        demo: [
          { state: "desenhado", target: "btn-ajuste", caption: "Algo errado? Peça ajuste e o Arquiteto refaz" },
          { state: "desenhado", target: "btn-aprovar", caption: "Tudo certo? Aprovar processo" },
          { state: "aprovado", target: "processo", caption: "Aprovado: pronto para a implantação" },
        ],
      },
    ],
  },
  {
    id: "organograma",
    title: "Time de IA",
    routes: ["/organograma"],
    autoOpen: true,
    mock: (state) => <OrganogramaMock state={state} />,
    steps: [
      {
        title: "Uma equipe de IA, organizada como a sua empresa",
        body: (
          <>
            <p>O <b>cérebro</b> monta o time de agentes a partir dos seus setores e dos processos aprovados: diretores por área, coordenadores por setor, um <b>especialista para cada processo</b> e quem <b>atende os clientes</b>. Tem também a equipe de apoio (Arquiteto, Revisor, Guardião de segurança…).</p>
            <Pointer icon={<Network className="w-4 h-4" />} label="Montar o time com o cérebro" note="sem custo de IA: o time sai dos seus dados, nada é inventado" />
            <p className="text-muted-foreground">Empresa pequena? O cérebro junta os níveis: sem diretores e coordenadores sobrando.</p>
          </>
        ),
        demo: [
          { state: "vazio", target: "btn-montar", caption: "Clique em Montar o time com o cérebro" },
          { state: "proposto", target: "agente-cerebro", caption: "O cérebro no topo, ao seu lado" },
          { state: "proposto", target: "agente-especialista", caption: "Um especialista para cada processo aprovado" },
        ],
      },
      {
        title: "Cada um com o seu crachá",
        body: (
          <>
            <p>Cada agente mostra o que <b>vê</b>, o que <b>faz</b> e com quem <b>fala</b>. Só quem atende o cliente vê a conversa — e só a conversa que está atendendo. Diretores e o cérebro veem só números, sem nomes de pessoas.</p>
            <p className="text-muted-foreground">O nome sempre termina com "(IA)", e você pode dar um apelido (ex.: Bia).</p>
          </>
        ),
        demo: [
          { state: "proposto", target: "agente-executor", caption: "Quem atende vê só a conversa que está atendendo" },
          { state: "proposto", target: "apoio", caption: "A equipe de apoio cuida de segurança e qualidade" },
        ],
      },
      {
        title: "Você aprova e controla",
        body: (
          <>
            <Pointer icon={<CheckCircle2 className="w-4 h-4" />} label="Aprovar o time" note="todos começam só sugerindo: você decide o que vai para o cliente" />
            <Pointer icon={<Pause className="w-4 h-4" />} label="Pausar" note="desliga um agente na hora" />
            <p className="text-muted-foreground">"Executa sozinho" só fica disponível depois que o agente passar na prova dos cenários de teste. Antes de aprovar, o 🛡️ Guardião de segurança confere o crachá de cada agente.</p>
          </>
        ),
        demo: [
          { state: "proposto", target: "btn-aprovar-time", caption: "Confira e clique em Aprovar o time" },
          { state: "ativo", target: "autonomia", caption: "Autonomia: começa sugerindo" },
          { state: "ativo", target: "btn-pausar", caption: "Pause qualquer agente quando quiser" },
        ],
      },
      {
        title: "A prova antes de executar",
        body: (
          <>
            <p>Cada agente que atende passa por uma <b>prova</b> com 7 cenários: pergunta comum, caso diferente, fora do horário, reclamação, pedido proibido (ex.: desconto), tentativa de burla e pedido de dado de outro cliente. Você pode acrescentar os seus.</p>
            <Pointer icon={<FlaskConical className="w-4 h-4" />} label="Rodar a prova" note="em modo seguro: nada vai para cliente de verdade" />
            <p className="text-muted-foreground">Cada resposta é conferida por regras fixas e por um avaliador. Só com a prova em dia o agente pode "executar com aprovação". Mudou o comportamento, a base ou um processo? A prova vence e roda de novo.</p>
          </>
        ),
        demo: [
          { state: "prova", target: "prova", caption: "7 cenários obrigatórios por agente que atende" },
          { state: "prova", target: "btn-rodar", caption: "Rodar a prova: nada vai para cliente de verdade" },
        ],
      },
      {
        title: "O time conversa entre si",
        body: (
          <>
            <p>Quando um cliente pergunta algo que não está nas informações da empresa, o agente que atende anota a dúvida (sem dados do cliente). Ela <b>sobe pelo time</b>: cada nível tenta responder com o que pode ver (Diagnóstico, processos, base de conhecimento). Se ninguém souber, chega a <b>você</b>, em "Perguntas do time de IA" no Diagnóstico.</p>
            <p className="text-muted-foreground">Sua resposta entra na etapa certa do Diagnóstico — organize de novo e o agente passa a saber. O resumo da rede fica no Cérebro.</p>
          </>
        ),
        demo: [
          { state: "rede", target: "rede", caption: "A dúvida sobe pelo time; muitas o próprio time resolve" },
          { state: "rede", target: "pergunta-voce", caption: "O que ninguém sabe chega a você no Diagnóstico" },
        ],
      },
    ],
  },
];

export const guidesFor = (pathname: string) => GUIDES.filter((g) => g.routes.includes(pathname));
export const guideById = (id: string) => GUIDES.find((g) => g.id === id);
