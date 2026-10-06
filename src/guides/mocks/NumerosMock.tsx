import type { ReactNode } from "react";
import { Facebook, Instagram, Mail, MoreHorizontal, Plus, QrCode, ShieldCheck } from "lucide-react";

function B({ d, children, primary }: { d: string; children: ReactNode; primary?: boolean }) {
  return <span data-demo={d} className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 font-medium ${primary ? "bg-primary text-primary-foreground" : "bg-background"}`}>{children}</span>;
}
const Tag = ({ ok, children }: { ok: boolean; children: ReactNode }) =>
  <span className={`rounded px-1 ${ok ? "bg-success-soft text-success-text" : "bg-danger-soft text-danger-text"}`}>{children}</span>;

/** Miniatura da tela Números (WhatsApp, e-mail, Facebook e Instagram) para as demonstrações. Dados fictícios. */
export function NumerosMock({ state }: { state: string }) {
  const dialog = ["add", "meta", "qr-nome", "qr"].includes(state);
  const caiu = state === "caiu" || state === "menu";
  return (
    <div className="relative h-full p-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="font-semibold">WhatsApp e e-mail</p>
        <B d="btn-adicionar" primary><Plus className="h-2.5 w-2.5" /> Adicionar número</B>
      </div>
      <div data-demo="card-numero" className="rounded border p-1.5 space-y-1">
        <p className="flex items-center justify-between"><b>Comercial</b> <span data-demo="btn-menu" className="rounded border bg-background px-0.5"><MoreHorizontal className="h-2.5 w-2.5" /></span></p>
        <p className="flex flex-wrap gap-1"><span className="rounded border px-1">Oficial Meta</span>
          {state === "lista" || state === "conectado" || state === "add" || state === "meta" ? <Tag ok>Conectado</Tag> : caiu ? <Tag ok={false}>Desconectado</Tag> : <Tag ok>Conectado</Tag>}</p>
        {caiu && <p className="text-danger-text">O celular ficou sem internet — reconecte pelo QR</p>}
        {state === "menu" && <p data-demo="btn-reconectar" className="w-fit rounded border bg-background px-1">Reconectar (QR Code)</p>}
      </div>
      {state === "conectado" && <div data-demo="novo-numero" className="rounded border border-primary p-1.5"><b>Suporte</b> <span className="rounded border px-1">QR Code</span> <Tag ok>Conectado</Tag></div>}
      <div className="rounded border p-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1"><Mail className="h-2.5 w-2.5" /> E-mails {state === "email-ok" && <Tag ok>contato@ conectado</Tag>}</span>
        <B d="btn-email"><Plus className="h-2.5 w-2.5" /> Conectar e-mail</B>
      </div>
      {state === "email" && (
        <div className="rounded border bg-background p-1.5 space-y-0.5">
          <p data-demo="provedor">Provedor: <b>Gmail / Google Workspace</b> (servidores preenchidos)</p>
          <p>E-mail e senha de app · Setor que recebe</p>
          <p className="flex gap-1"><B d="btn-testar">Testar conexão</B> <B d="btn-salvar-email" primary>Salvar</B></p>
        </div>
      )}
      <div className="rounded border p-1.5 flex items-center justify-between">
        <span className="flex items-center gap-1"><Facebook className="h-2.5 w-2.5" /><Instagram className="h-2.5 w-2.5" /> Facebook e Instagram {state === "pagina-ok" && <Tag ok>Página conectada</Tag>}</span>
        <B d="btn-facebook"><Facebook className="h-2.5 w-2.5" /> Conectar com o Facebook</B>
      </div>
      {dialog && (
        <div className="absolute inset-x-3 top-6 rounded-md border bg-background p-2 shadow-lg space-y-1">
          <p className="font-semibold">Adicionar número</p>
          {state === "add" && (
            <>
              <p data-demo="opt-meta" className="rounded border p-1"><ShieldCheck className="inline h-2.5 w-2.5" /> <b>WhatsApp oficial (Meta)</b> — recomendado</p>
              <p data-demo="opt-qr" className="rounded border p-1"><QrCode className="inline h-2.5 w-2.5" /> <b>Por QR Code</b> — para números secundários</p>
            </>
          )}
          {state === "meta" && <B d="btn-fb-whatsapp" primary><Facebook className="h-2.5 w-2.5" /> Conectar o WhatsApp com o Facebook</B>}
          {state === "qr-nome" && <p>Nome na equipe: <span data-demo="campo-nome" className="rounded border px-1">Suporte</span> <B d="btn-continuar" primary>Continuar</B></p>}
          {state === "qr" && (
            <p className="flex items-center gap-1.5"><span data-demo="qr" className="inline-grid h-8 w-8 place-items-center rounded border"><QrCode className="h-6 w-6" /></span>
              No celular: WhatsApp → Aparelhos conectados → Conectar aparelho</p>
          )}
        </div>
      )}
    </div>
  );
}
