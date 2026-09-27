/**
 * Canal de e-mail (IMAP/SMTP). A senha da caixa só vem do Vault
 * (email:<id>:password); o servidor informado pelo cliente precisa ser público.
 */
import { ImapFlow } from "npm:imapflow@1.0.171";
import nodemailer from "npm:nodemailer@6.9.16";
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
