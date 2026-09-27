/**
 * E-mails do sistema (alertas, avisos) pelo Resend. Configuração da
 * plataforma: chave no Vault (platform:resend_api_key) e remetente em
 * app_settings.email_from. Sem configuração → { skipped } (nunca lança).
 */
import { getSecret } from "./secrets.ts";

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface EmailResult { ok: boolean; skipped?: string; error?: string }

// deno-lint-ignore no-explicit-any
export async function sendSystemEmail(admin: any, m: { to: string; subject: string; text: string; html: string }): Promise<EmailResult> {
  const [key, { data: from }] = await Promise.all([
    getSecret(admin, "platform:resend_api_key"),
    admin.from("app_settings").select("value").eq("key", "email_from").maybeSingle(),
  ]);
  if (!key || !from?.value) return { ok: false, skipped: "e-mail do sistema não configurado" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.to)) return { ok: false, skipped: "destinatário sem e-mail válido" };
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
