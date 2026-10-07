/**
 * Mídia das conversas (spec atendimento §6): tipo real pelos bytes iniciais,
 * limites do WhatsApp, arquivos perigosos e gravação no bucket privado
 * media/{org}/{conversa}/{uuid}.{ext}.
 */

export type MediaType = "image" | "audio" | "video" | "document" | "sticker";

export const LIMITS: Record<MediaType, number> = {
  image: 5 * 1024 * 1024,
  sticker: 5 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
};

/** Extensões executáveis ou de script: nunca exibidas, gravadas como octet-stream. */
const DANGEROUS = /\.(exe|bat|cmd|com|scr|pif|js|mjs|vbs|vbe|wsf|ps1|msi|apk|jar|html?|svg|hta|sh|dll)$/i;

const OFFICE: Record<string, string> = {
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/amr": "amr",
  "audio/webm": "webm", "video/mp4": "mp4", "video/3gpp": "3gp", "application/pdf": "pdf",
  "text/plain": "txt", "text/csv": "csv", "application/zip": "zip",
};

function extOf(name: string | null | undefined) {
  const m = String(name ?? "").toLowerCase().match(/\.([a-z0-9]{1,5})$/);
  return m ? m[1] : "";
}

function ascii(b: Uint8Array, start: number, len: number) {
  return String.fromCharCode(...b.subarray(start, start + len));
}

/** Tipo pelos bytes; o nome só desempata formatos-contêiner (zip/ole do Office). */
export function sniffMime(b: Uint8Array, name?: string | null): string {
  const ext = extOf(name);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 4 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return "image/png";
  if (ascii(b, 0, 4) === "GIF8") return "image/gif";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
  if (ascii(b, 0, 4) === "%PDF") return "application/pdf";
  if (ascii(b, 0, 4) === "OggS") return "audio/ogg";
  if (ascii(b, 0, 5) === "#!AMR") return "audio/amr";
  if (ascii(b, 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "audio/webm";
  if (ascii(b, 4, 4) === "ftyp") {
    const brand = ascii(b, 8, 4);
    if (brand.startsWith("3gp")) return "video/3gpp";
    if (brand.startsWith("M4A") || ext === "m4a") return "audio/mp4"; // áudio gravado no navegador (Chrome grava MP4 com marca genérica)
    return "video/mp4";
  }
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) {
    return OFFICE[ext] && ext.endsWith("x") ? OFFICE[ext] : "application/zip";
  }
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) {
    return OFFICE[ext] && !ext.endsWith("x") ? OFFICE[ext] : "application/octet-stream";
  }
  // Texto simples: sem bytes de controle nos primeiros 512.
  const head = b.subarray(0, 512);
  if (head.length && head.every((c) => c === 9 || c === 10 || c === 13 || c >= 32)) {
    return ext === "csv" ? "text/csv" : "text/plain";
  }
  return "application/octet-stream";
}

export function typeOf(mime: string, hint?: string | null): MediaType {
  if (hint === "sticker") return "sticker";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

export function isDangerous(name: string | null | undefined) {
  return DANGEROUS.test(String(name ?? ""));
}

/**
 * Grava bytes recebidos no bucket e devolve os campos da mensagem.
 * Arquivo perigoso vira octet-stream (nunca exibido inline).
 */
export async function storeMedia(
  // deno-lint-ignore no-explicit-any
  admin: any,
  orgId: string,
  conversationId: string,
  bytes: Uint8Array,
  opts: { name?: string | null; hint?: string | null } = {},
) {
  let mime = sniffMime(bytes, opts.name);
  if (isDangerous(opts.name)) mime = "application/octet-stream";
  const type = typeOf(mime, opts.hint);
  const ext = EXT[mime] ?? (OFFICE[extOf(opts.name)] === mime ? extOf(opts.name) : "bin");
  const path = `${orgId}/${conversationId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await admin.storage.from("media").upload(path, bytes, { contentType: mime, upsert: false });
  if (error) {
    console.error("[media] upload falhou", { message: error.message });
    return null;
  }
  return {
    type,
    media_path: path,
    media_mime: mime,
    media_size: bytes.length,
    media_name: opts.name ? String(opts.name).slice(0, 200) : `${type}.${ext}`,
  };
}
