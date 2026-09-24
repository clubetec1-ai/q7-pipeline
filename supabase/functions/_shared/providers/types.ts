/**
 * Contrato entre o ClubeCRM e os provedores de WhatsApp.
 *
 * O resto do sistema — achar a conversa, chamar a Groq, gravar mensagem, agendar
 * follow-up — não sabe qual provedor está em uso. Tudo que é específico de Uazapi
 * ou Meta Cloud API mora atrás destes tipos.
 *
 * Design: docs/superpowers/specs/2026-09-23-whatsapp-cloud-api-design.md
 */

export type ProviderId = "uazapi" | "cloud";

/** Uma linha de public.whatsapp_instances. */
export interface InstanceRow {
  id: string;
  user_id: string;
  name: string;
  phone: string | null;
  provider: ProviderId;
  // Uazapi
  server_url: string | null;
  // Ambos: token da Uazapi, ou access token permanente da Meta
  instance_token: string | null;
  // Cloud API
  phone_number_id: string | null;
  waba_id: string | null;
  [key: string]: unknown;
}

/**
 * O que chegou, já normalizado. `kind` decide o que o webhook faz:
 *   message    → fluxo completo (conversa, IA, resposta)
 *   status     → confirmação de entrega/leitura, ignorada
 *   connection → atualiza o status da instância
 *   ignore     → grupo, payload desconhecido, evento sem conteúdo
 */
export interface NormalizedInbound {
  kind: "message" | "status" | "connection" | "ignore";
  provider: ProviderId;
  /** Como localizar a instância dona desta mensagem. */
  ref: {
    token?: string | null;
    phoneNumberId?: string | null;
    wabaId?: string | null;
    name?: string | null;
    ownerPhone?: string | null;
  };
  phone: string;
  text: string | null;
  mediaId: string | null;
  mediaKind: "audio" | "image" | "video" | "document" | null;
  contactName: string | null;
  fromMe: boolean;
  isGroup: boolean;
  /** Só para kind === "connection". */
  status?: string | null;
}

export interface SendResult {
  ok: boolean;
  error?: string;
  /** Código do provedor, ex.: "131047" na Meta. */
  code?: string;
  /**
   * true quando a Meta recusou por estar fora da janela de 24h.
   * Nesse caso só template aprovado passa.
   */
  outsideWindow?: boolean;
}

export interface TemplateRef {
  name: string;
  language: string;
  /** Parâmetros posicionais do corpo, na ordem de {{1}}, {{2}}... */
  bodyParams?: string[];
}

export const EMPTY_INBOUND: NormalizedInbound = {
  kind: "ignore",
  provider: "uazapi",
  ref: {},
  phone: "",
  text: null,
  mediaId: null,
  mediaKind: null,
  contactName: null,
  fromMe: false,
  isGroup: false,
};
