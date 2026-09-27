/**
 * E-mails do sistema (alertas, avisos). Remetente em app_settings.email_from.
 * Envio por um de dois caminhos da plataforma (sem configuração → { skipped }):
 *  - Resend: chave no Vault (platform:resend_api_key);
 *  - SMTP (ex.: caixa da Hostinger): app_settings smtp_host/smtp_port/smtp_user
 *    e senha no Vault (platform:smtp_password).
 */
import { getSecret } from "./secrets.ts";
import { smtpTransport } from "./mail.ts";

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface EmailResult { ok: boolean; skipped?: string; error?: string }

// deno-lint-ignore no-explicit-any
export async function sendSystemEmail(admin: any, m: { to: string; subject: string; text: string; html: string }): Promise<EmailResult> {
  const [key, smtpPass, { data: cfg }] = await Promise.all([
    getSecret(admin, "platform:resend_api_key"),
    getSecret(admin, "platform:smtp_password"),
    admin.from("app_settings").select("key, value").in("key", ["email_from", "smtp_host", "smtp_port", "smtp_user"]),
  ]);
  const s = Object.fromEntries(((cfg ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  const from = { value: s.email_from };
  if (!from.value || (!key && !(smtpPass && s.smtp_host && s.smtp_user))) return { ok: false, skipped: "e-mail do sistema não configurado" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.to)) return { ok: false, skipped: "destinatário sem e-mail válido" };
  if (!key) {
    try {
      const t = await smtpTransport({ smtp_host: s.smtp_host, smtp_port: Number(s.smtp_port) || 465, username: s.smtp_user }, smtpPass!);
      await t.sendMail({ from: from.value, to: m.to, subject: m.subject.slice(0, 200), text: m.text, html: m.html });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "falha no envio" };
    }
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: from.value, to: [m.to], subject: m.subject.slice(0, 200), text: m.text, html: m.html }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, error: `Resend HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    await res.body?.cancel();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "falha no envio" };
  }
}
