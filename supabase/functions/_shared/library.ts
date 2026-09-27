/**
 * Arquivos da biblioteca da empresa (media/{org}/library/...). Sempre pela
 * organização do atendimento (forOrg) — um id de outra empresa não é achado.
 */
import { forOrg } from "./tenant.ts";
import { LIMITS, type MediaType, sniffMime, typeOf } from "./media.ts";
import * as providers from "./providers/index.ts";

/** Tipos que o WhatsApp aceita receber. */
export const SENDABLE =
  /^(image\/(jpeg|png)|audio\/(ogg|mpeg|mp4|aac|amr)|video\/(mp4|3gpp)|application\/pdf|text\/(plain|csv)|application\/(zip|msword|vnd\.)[\w.+-]*)$/;

export interface LibraryFile { id: string; name: string; path: string; bytes: Uint8Array; mime: string; type: MediaType }

/** Carrega e valida um arquivo da biblioteca. Lança Error com mensagem legível. */
// deno-lint-ignore no-explicit-any
export async function loadLibraryFile(admin: any, orgId: string, id: string): Promise<LibraryFile> {
  const { data: row } = await forOrg(admin, orgId).select("library_files", "id, name, media_path").eq("id", id).maybeSingle();
  if (!row || !String(row.media_path).startsWith(`${orgId}/library/`)) throw new Error("Arquivo da biblioteca não encontrado");
  const { data: blob, error } = await admin.storage.from("media").download(row.media_path);
  if (error || !blob) throw new Error("Arquivo da biblioteca indisponível");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mime = sniffMime(bytes, row.name);
  if (!SENDABLE.test(mime)) throw new Error("Tipo de arquivo não aceito pelo WhatsApp");
  const type = typeOf(mime);
  if (bytes.length > LIMITS[type]) throw new Error("Arquivo grande demais para o WhatsApp");
  return { id: row.id, name: row.name, path: row.media_path, bytes, mime, type };
}

/** Envia um arquivo da biblioteca e grava a mensagem (IA/fluxo). */
export async function sendLibraryFile(p: {
  // deno-lint-ignore no-explicit-any
  admin: any; orgId: string; inst: any; conv: any; ticketId: string; fileId: string; caption?: string; sender: "ai" | "human";
}) {
  const f = await loadLibraryFile(p.admin, p.orgId, p.fileId);
  const sent = await providers.sendMedia(p.inst, p.conv.contact_phone, {
    type: f.type, bytes: f.bytes, mime: f.mime, name: f.name, caption: p.caption || undefined,
  });
  await forOrg(p.admin, p.orgId).insert("messages", {
    conversation_id: p.conv.id, ticket_id: p.ticketId, direction: "outbound", sender: p.sender,
    content: p.caption || `[${f.type}]`, type: f.type, media_path: f.path, media_mime: f.mime,
    media_size: f.bytes.length, media_name: f.name,
    status: sent.ok ? "sent" : "failed", provider_message_id: sent.messageId ?? null,
    error: sent.ok ? null : (sent.error ?? "falha").slice(0, 300),
  });
  return sent.ok;
}
