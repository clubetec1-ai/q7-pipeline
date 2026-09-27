/**
 * Resposta por e-mail do atendente (ramo de e-mail da send-message). Mesmo
 * assunto ("Re:"), In-Reply-To/References da última mensagem recebida,
 * assinatura da caixa e anexo da conversa ou da biblioteca.
 */
import { HttpError } from "./auth.ts";
import { forOrg } from "./tenant.ts";
import { isDangerous, sniffMime, typeOf } from "./media.ts";
import { loadLibraryFile } from "./library.ts";
import { accountPassword, smtpTransport } from "./mail.ts";
import { friendlyMailError, replySubject } from "./mail-utils.ts";

const MAX_ATTACHMENT = 20 * 1024 * 1024;

export async function sendEmailMessage(p: {
  // deno-lint-ignore no-explicit-any
  admin: any; orgId: string; conv: any; ticketId: string | null; text: string;
  mediaPath: string | null; mediaName: string; libraryId: string | null;
}): Promise<{ sent: { ok: boolean; messageId?: string; error?: string }; fields: Record<string, unknown> }> {
  const { admin, orgId, conv, ticketId, text } = p;
  const org = forOrg(admin, orgId);
  const { data: acc } = await org.select("email_accounts").eq("id", conv.email_account_id).maybeSingle();
  if (!acc) throw new HttpError(404, "Caixa de e-mail da conversa não encontrada");
  if (acc.status === "disabled") throw new HttpError(409, "Esta caixa de e-mail está desativada.");
  const pass = await accountPassword(admin, acc.id);
  if (!pass) throw new HttpError(409, "A caixa de e-mail está sem senha. Configure em Números → E-mails.");

  const [{ data: lastIn }, { data: t }] = await Promise.all([
    org.select("messages", "email_subject, email_message_id").eq("conversation_id", conv.id).eq("direction", "inbound")
      .not("email_message_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ticketId ? org.select("tickets", "protocol").eq("id", ticketId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const subject = replySubject(lastIn?.email_subject, t?.protocol ? `Atendimento #${t.protocol}` : `Atendimento ${acc.name}`);

  let fields: Record<string, unknown> = { type: "text" };
  const attachments: { filename: string; content: Uint8Array; contentType: string }[] = [];
  if (p.libraryId) {
    const f = await loadLibraryFile(admin, orgId, p.libraryId).catch((e) => { throw new HttpError(400, e.message); });
    attachments.push({ filename: f.name, content: f.bytes, contentType: f.mime });
    fields = { type: f.type, media_path: f.path, media_mime: f.mime, media_size: f.bytes.length, media_name: f.name };
  } else if (p.mediaPath) {
    if (!p.mediaPath.startsWith(`${orgId}/${conv.id}/`)) throw new HttpError(400, "Arquivo de outra conversa");
    if (isDangerous(p.mediaName)) throw new HttpError(400, "Tipo de arquivo não permitido");
    const { data: blob, error } = await admin.storage.from("media").download(p.mediaPath);
    if (error || !blob) throw new HttpError(404, "Arquivo não encontrado");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length > MAX_ATTACHMENT) throw new HttpError(400, "Anexo grande demais para e-mail (máx. 20 MB)");
    const mime = sniffMime(bytes, p.mediaName);
    attachments.push({ filename: p.mediaName, content: bytes, contentType: mime });
    fields = { type: typeOf(mime), media_path: p.mediaPath, media_mime: mime, media_size: bytes.length, media_name: p.mediaName };
  }

  const body = [text, acc.signature ? `-- \n${acc.signature}` : ""].filter(Boolean).join("\n\n") || " ";
  try {
    const transport = await smtpTransport(acc, pass);
    const info = await transport.sendMail({
      from: { name: acc.name, address: acc.address }, to: conv.contact_email, subject, text: body,
      ...(lastIn?.email_message_id ? { inReplyTo: lastIn.email_message_id, references: lastIn.email_message_id } : {}),
      attachments,
    });
    return { sent: { ok: true, messageId: info.messageId }, fields: { ...fields, email_subject: subject, email_message_id: info.messageId ?? null } };
  } catch (e) {
    return { sent: { ok: false, error: friendlyMailError(e) }, fields: { ...fields, email_subject: subject } };
  }
}
