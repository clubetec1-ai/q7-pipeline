/**
 * Canal de e-mail (IMAP/SMTP). A senha da caixa só vem do Vault
 * (email:<id>:password); o servidor informado pelo cliente precisa ser público.
 */
import { ImapFlow } from "npm:imapflow@1.0.171";
import nodemailer from "npm:nodemailer@6.9.16";
import MailComposer from "npm:nodemailer@6.9.16/lib/mail-composer/index.js";
import { getSecret } from "./secrets.ts";
import { checkPublicHost } from "./flow/http.ts";

export interface MailAccount {
  id: string; organization_id: string; name: string; address: string; username: string;
  imap_host: string; imap_port: number; smtp_host: string; smtp_port: number;
  signature?: string | null; last_uid?: number | null; uidvalidity?: number | null; department_id?: string | null;
}

// deno-lint-ignore no-explicit-any
export async function accountPassword(admin: any, id: string) {
  return await getSecret(admin, `email:${id}:password`);
}

async function guard(host: string) {
  const bad = await checkPublicHost(host);
  if (bad) throw new Error(bad);
}

export async function openImap(acc: Pick<MailAccount, "imap_host" | "imap_port" | "username">, pass: string) {
  await guard(acc.imap_host);
  const client = new ImapFlow({
    host: acc.imap_host, port: acc.imap_port, secure: acc.imap_port === 993,
    auth: { user: acc.username, pass }, logger: false, socketTimeout: 30_000, greetingTimeout: 15_000,
  });
  await client.connect();
  return client;
}

export async function smtpTransport(acc: Pick<MailAccount, "smtp_host" | "smtp_port" | "username">, pass: string) {
  await guard(acc.smtp_host);
  return nodemailer.createTransport({
    host: acc.smtp_host, port: acc.smtp_port, secure: acc.smtp_port === 465, requireTLS: acc.smtp_port === 587,
    auth: { user: acc.username, pass }, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
  });
}

/** Provedores que já guardam no "Enviados" o que sai pelo SMTP deles (copiar duplicaria). */
const AUTO_SENT = /(gmail|googlemail|google|office365|outlook|hotmail|live\.com|zoho|yahoo|icloud|me\.com)/i;

/**
 * Guarda uma cópia do e-mail enviado na pasta "Enviados" (\Sent, ou Sent/Enviados) da
 * própria caixa, para a empresa ver no webmail o que o sistema respondeu.
 */
export async function copyToSent(
  acc: Pick<MailAccount, "imap_host" | "imap_port" | "username" | "smtp_host">,
  pass: string,
  // deno-lint-ignore no-explicit-any
  opts: Record<string, any>,
) {
  if (AUTO_SENT.test(acc.smtp_host) || AUTO_SENT.test(acc.imap_host)) return;
  const raw: Uint8Array = await new MailComposer(opts).compile().build();
  const client = await openImap(acc, pass);
  try {
    const boxes = (await client.list()) as { path: string; specialUse?: string }[];
    const sent = boxes.find((b) => b.specialUse === "\Sent")
      ?? boxes.find((b) => /^(inbox[./])?(sent|enviad|itens enviados|sent items|sent messages)/i.test(b.path));
    if (sent) await client.append(sent.path, raw, ["\Seen"]);
  } finally {
    await client.logout().catch(() => {});
  }
}
