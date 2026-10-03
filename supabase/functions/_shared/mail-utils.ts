/** Regras do canal de e-mail sem dependências (testáveis). */

export interface Header { key: string; value: string }

/** Resposta automática, lista ou boletim: não abre atendimento (evita loop). */
export function isAutomated(headers: Header[], from: string): boolean {
  const h = (k: string) => headers.find((x) => x.key.toLowerCase() === k)?.value?.toLowerCase() ?? "";
  if (h("auto-submitted") && h("auto-submitted") !== "no") return true;
  if (/^(bulk|list|junk|auto_reply)$/.test(h("precedence"))) return true;
  if (h("list-id") || h("list-unsubscribe") || h("x-autoreply") || h("x-autorespond") || h("x-auto-response-suppress") || h("feedback-id")) return true;
  // Plataformas de disparo em massa/transacional (Mailchimp, SendGrid, SES, RD Station, HubSpot, Mailgun...).
  if (h("x-mc-user") || h("x-sg-eid") || h("x-ses-outgoing") || h("x-campaign") || h("x-campaignid") || h("x-rpcampaign")
    || h("x-hs-cid") || h("x-mailgun-tag") || h("x-mailer").includes("mailchimp") || h("x-mailer").includes("rdstation")) return true;
  const local = from.split("@")[0] ?? "";
  // "no-reply" em qualquer parte do nome (ads-support-noreply@, naoresponda@...).
  if (/(^|[._+-])(no-?reply|do-?not-?reply|nao-?responda|naoresponder)([._+-]|$)/i.test(local)) return true;
  // Caixas que só enviam avisos (nunca são um cliente escrevendo): sistemas, cobrança automática, cadastro, segurança.
  return /^(mailer-daemon|postmaster|hostmaster|webmaster|bounce[s]?|newsletter|news|marketing|mkt|comunicacao|comunicado[s]?|transacional|notificac(ao|oes)|notification[s]?|alert[s]?|avisos?|pagamento[s]?|faturamento|cobranca[s]?|billing|invoice[s]?|nfe|nf-e|notafiscal|boleto[s]?|cadastro|seguranca|security|accounts?|verify|verificacao)([._+-]|$)/i.test(local);
}

/** O remetente está na lista "Não é atendimento" da empresa (e-mail exato ou @domínio)? */
export function isIgnored(patterns: string[], from: string): boolean {
  const f = from.toLowerCase();
  const domain = "@" + (f.split("@")[1] ?? "");
  return patterns.some((p) => p === f || p === domain);
}

/** "Re: assunto" sem repetir o prefixo. */
export function replySubject(subject: string | null | undefined, fallback: string): string {
  const s = String(subject ?? "").trim();
  if (!s) return fallback;
  return /^(re|res|resp)\s*:/i.test(s) ? s : `Re: ${s}`;
}

/** Texto do HTML quando o e-mail não traz parte texto (nunca renderizamos HTML). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Corta o histórico citado ("Em ... escreveu:" / "On ... wrote:" / linhas com ">"). */
export function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/);
  const cut = lines.findIndex((l) =>
    /^(em|on) .{4,200}(escreveu|wrote):?\s*$/i.test(l.trim()) || /^-{2,}\s*(mensagem original|original message)/i.test(l.trim()) ||
    /^(de|from):\s.+@/i.test(l.trim()));
  const body = (cut > 0 ? lines.slice(0, cut) : lines).filter((l, i, a) => !(l.startsWith(">") && i > 0 && a[i - 1].startsWith(">")));
  return body.join("\n").trim() || text.trim();
}

/** Erro técnico de IMAP/SMTP → frase para o dono da empresa. */
export function friendlyMailError(e: unknown): string {
  const any = e as { message?: string; code?: string; authenticationFailed?: boolean; responseCode?: number };
  const msg = String(any?.message ?? e ?? "");
  if (any?.authenticationFailed || any?.code === "EAUTH" || /auth|invalid credentials|login|535|unexpected close/i.test(msg)) {
    return "Usuário ou senha incorretos. No Gmail e no Outlook, use uma senha de app.";
  }
  if (/ENOTFOUND|getaddrinfo|não encontrado|name or service/i.test(msg)) return "Servidor não encontrado. Confira o endereço.";
  if (/timed? ?out|ETIMEDOUT|ECONNREFUSED/i.test(msg)) return "O servidor não respondeu. Confira o endereço e a porta.";
  if (/certificate|self signed|TLS/i.test(msg)) return "Problema no certificado de segurança do servidor.";
  if (/endereço interno/.test(msg)) return "Endereço de servidor não permitido.";
  return "Não foi possível conectar. Confira os dados da caixa.";
}
