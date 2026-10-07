import type { ReactNode } from "react";
import { GripVertical, KeyRound, Lock, Plug, Plus, Sparkles, Webhook } from "lucide-react";

/** Miniaturas das telas para as demonstrações dos guias (Fluxos, Equipe, Etiquetas, Funil, Cobranças, Integrações, API e Configurações). Dados fictícios. */
function B({ d, children, primary }: { d: string; children: ReactNode; primary?: boolean }) {
  return <span data-demo={d} className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-medium ${primary ? "bg-primary text-primary-foreground" : "bg-background"}`}>{children}</span>;
}
const Box = ({ d, children, cls }: { d?: string; children: ReactNode; cls?: string }) => <div data-demo={d} className={`rounded border p-1 ${cls ?? ""}`}>{children}</div>;
const Chip = ({ c, children }: { c: string; children: ReactNode }) => <span className={`rounded px-1 ${c}`}>{children}</span>;

export function FluxosMock({ state }: { state: string }) {
  return (
    <div className="h-full p-2 space-y-1.5">
      <p className="font-semibold">Menus e respostas automáticas</p>
      <p className="flex gap-1"><span data-demo="nome" className="flex-1 rounded border px-1 text-muted-foreground">Nome do novo fluxo</span><B d="btn-criar" primary><Plus className="h-2.5 w-2.5" /> Criar</B></p>
      <Box d="lista"><p className="flex justify-between"><b>Recepção e triagem</b> <Chip c="bg-muted">v3</Chip></p><p className="flex justify-between">Pesquisa de satisfação <Chip c="border">Rascunho</Chip></p></Box>
      <Box d="prontos"><p className="font-medium">Modelos prontos</p><p>Recepção e triagem · Fora do horário · IA para dúvidas · <B d="btn-modelo">Instalar</B></p></Box>
      {state !== "inicio" && (
        <Box d="numeros"><p className="font-medium">Qual fluxo cada número usa</p><p className="flex justify-between">Padrão da empresa <Chip c="border">Recepção e triagem ▾</Chip></p><p className="flex justify-between">Depois que o atendente finaliza <Chip c="border">Pesquisa ▾</Chip></p></Box>
      )}
    </div>
  );
}

export function EquipeMock({ state }: { state: string }) {
  const tab = state === "setores" ? "Departamentos" : state === "mensagens" ? "Mensagens automáticas" : "Membros";
  return (
    <div className="h-full p-2 space-y-1.5">
      <p className="font-semibold">Equipe e permissões</p>
      <p data-demo="abas" className="flex gap-1">{["Membros", "Departamentos", "Grupos", "Mensagens automáticas"].map((t) => <Chip key={t} c={t === tab ? "bg-primary text-primary-foreground" : "border"}>{t}</Chip>)}</p>
      {tab === "Membros" && <Box d="membros"><p className="flex justify-between">Ana (dona) <Chip c="bg-muted">Dono</Chip></p><p className="flex justify-between">Bruno <Chip c="bg-muted">Atendente</Chip></p><p><B d="btn-convidar" primary><Plus className="h-2.5 w-2.5" /> Convidar pessoa</B></p></Box>}
      {tab === "Departamentos" && <Box d="setores"><p className="flex justify-between">Comercial <span>2 pessoas · fila</span></p><p className="flex justify-between">Suporte <span>1 pessoa · fila</span></p></Box>}
      {tab === "Mensagens automáticas" && <Box d="mensagens"><p>Saudação: "Olá! Seu protocolo é 2026-0142."</p><p>Fora do horário: "Voltamos amanhã às 9h."</p></Box>}
    </div>
  );
}

export function EtiquetasMock() {
  return (
    <div className="h-full p-2 space-y-1.5">
      <p className="font-semibold">Etiquetas e grupos</p>
      <Box d="etiquetas">
        <p className="flex justify-between font-medium">Etiquetas <span className="flex gap-1"><B d="btn-padrao"><Sparkles className="h-2.5 w-2.5" /> Padrão</B><B d="btn-nova"><Plus className="h-2.5 w-2.5" /> Novo</B></span></p>
        <p className="flex gap-1"><Chip c="bg-amber-200 text-amber-900">⭐ VIP</Chip><Chip c="bg-red-200 text-red-900">Urgente</Chip><Chip c="bg-sky-200 text-sky-900">Retornar contato</Chip></p>
        <p data-demo="setores" className="text-muted-foreground">Setores que usam: Comercial ✓ · Suporte ✓</p>
      </Box>
      <Box d="grupos"><p className="flex justify-between font-medium">Grupos de clientes <B d="btn-sensivel"><Lock className="h-2.5 w-2.5" /> Sensível</B></p><p>Clientes 2025 · Inadimplentes 🔒</p></Box>
    </div>
  );
}

export function FunilMock({ state }: { state: string }) {
  const moved = state === "movido";
  return (
    <div className="h-full p-2 space-y-1.5">
      <p className="flex justify-between font-semibold">Funil <B d="btn-etapas">Editar etapas</B></p>
      <div data-demo="colunas" className="grid grid-cols-3 gap-1">
        <Box><p className="font-medium">Novo lead</p>{!moved && <p data-demo="cartao" className="rounded bg-muted px-1 flex items-center gap-0.5"><GripVertical className="h-2.5 w-2.5" /> Maria S.</p>}<p className="rounded bg-muted px-1">João P.</p></Box>
        <Box d="destino"><p className="font-medium">Em negociação</p>{moved && <p data-demo="cartao" className="rounded bg-primary/15 px-1 flex items-center gap-0.5"><GripVertical className="h-2.5 w-2.5" /> Maria S.</p>}</Box>
        <Box><p className="font-medium">Fechado</p><p className="rounded bg-muted px-1">Carla M.</p></Box>
      </div>
    </div>
  );
}

export function CobrancasMock() {
  return (
    <div className="h-full p-2 space-y-1.5">
      <p className="font-semibold">Cobranças</p>
      <Box d="asaas" cls="bg-amber-50 dark:bg-amber-950/30"><p className="flex justify-between">Para cobrar, conecte o Asaas primeiro. <B d="btn-asaas" primary>Conectar o Asaas</B></p></Box>
      <Box d="nova"><p className="font-medium">Nova cobrança</p><p className="flex gap-1"><span data-demo="cliente" className="flex-1 rounded border px-1 text-muted-foreground">Nome ou telefone do cliente</span><B d="btn-cobrar">Cobrar</B></p></Box>
      <p data-demo="resumo" className="flex gap-1"><Chip c="border">Em aberto: R$ 450,00</Chip><Chip c="border">Recebido em 30 dias: R$ 1.280,00</Chip></p>
    </div>
  );
}

export function IntegracoesMock() {
  return (
    <div className="h-full p-2 space-y-1.5">
      <p className="font-semibold">Integrações</p>
      <Box d="conectores"><p className="font-medium flex items-center gap-1"><Plug className="h-2.5 w-2.5" /> Conectores prontos</p><p>Google Agenda · Bling <B d="btn-conectar">Conectar</B></p></Box>
      <Box d="nova"><p className="flex justify-between font-medium">Outro sistema <B d="btn-nova" primary><Plus className="h-2.5 w-2.5" /> Nova integração</B></p><p className="text-muted-foreground">Ex.: consultar o status do pedido pelo telefone do cliente</p></Box>
      <Box d="passos"><p>1. Guardar a chave 🔒 · 2. Configurar · 3. Testar · <B d="btn-fluxo">Criar fluxo (rascunho)</B></p></Box>
    </div>
  );
}

export function ApiMock() {
  return (
    <div className="h-full p-2 space-y-1.5">
      <p className="font-semibold">API e webhooks</p>
      <Box d="chaves"><p className="flex justify-between font-medium"><span className="flex items-center gap-1"><KeyRound className="h-2.5 w-2.5" /> Chaves de API</span><B d="btn-chave" primary><Plus className="h-2.5 w-2.5" /> Nova chave</B></p><p>n8n <span className="font-mono">dca_7f2…</span> · ler contatos <B d="btn-revogar">Revogar</B></p></Box>
      <Box d="webhooks"><p className="flex justify-between font-medium"><span className="flex items-center gap-1"><Webhook className="h-2.5 w-2.5" /> Webhooks</span><B d="btn-endereco"><Plus className="h-2.5 w-2.5" /> Novo endereço</B></p><p>https://meu-sistema/aviso · mudou de etapa <B d="btn-teste">Enviar um teste</B></p></Box>
    </div>
  );
}

export function ConfiguracoesMock() {
  const card = (d: string, t: string, s: string) => <div data-demo={d} className="rounded border p-1"><p className="font-medium">{t}</p><p className="text-muted-foreground">{s}</p></div>;
  return (
    <div className="h-full p-2 space-y-1">
      <p className="font-semibold">Configurações</p>
      <p className="text-[10px] uppercase text-muted-foreground">1. Onde seus clientes falam com você</p>
      <div className="grid grid-cols-2 gap-1">{card("whatsapp", "WhatsApp", "Conectar o número")}{card("email", "E-mail", "Caixas atendidas")}</div>
      <p className="text-[10px] uppercase text-muted-foreground">2. Sua empresa</p>
      <div className="grid grid-cols-2 gap-1">{card("diagnostico", "Conte sobre a empresa", "Diagnóstico por texto ou voz")}{card("horario", "Horário de atendimento", "Dias e horas")}</div>
      <p className="text-[10px] uppercase text-muted-foreground">3. Assistente de IA · 4. Equipe · 5. Vendas</p>
      <div className="grid grid-cols-2 gap-1">{card("ia", "Ligar e testar o assistente", "Comportamento e teste")}{card("equipe", "Pessoas e convites", "Quem faz o quê")}</div>
    </div>
  );
}
