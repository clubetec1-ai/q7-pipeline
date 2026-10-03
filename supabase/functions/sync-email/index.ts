import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import PostalMime from "npm:postal-mime@2.4.1";
import { forOrg } from "../_shared/tenant.ts";
import { getSecret, safeEqual } from "../_shared/secrets.ts";
import { storeMedia } from "../_shared/media.ts";
import { accountPassword, type MailAccount, openImap } from "../_shared/mail.ts";
import { friendlyMailError, htmlToText, isAutomated, isIgnored, stripQuoted } from "../_shared/mail-utils.ts";

/**
 * Recebimento do canal de e-mail (spec canal-email §Recebimento). Cron a cada
 * minuto (private.sync_email_tick, pg_net + x-cron-secret). Por caixa: lê só
 * UIDs novos (a primeira leitura começa "de agora", sem importar histórico),
 * ignora respostas automáticas/listas/da própria caixa e grava como atendimento.
 */

const MAX_ACCOUNTS = 20;
const MAX_PER_ACCOUNT = 25;
const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024;

function ok(body: unknown = { ok: true }, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// deno-lint-ignore no-explicit-any
async function conversationFor(admin: any, acc: MailAccount, from: string, name: string | null) {
  const org = forOrg(admin, acc.organization_id);
  const now = new Date().toISOString();
  const find = () => org.select("conversations").eq("email_account_id", acc.id).eq("contact_email", from).maybeSingle();
  let { data: conv } = await find();
  if (conv) {
    await org.update("conversations", { last_message_at: now, last_inbound_at: now, contact_name: conv.contact_name || name })
      .eq("id", conv.id);
    return conv;
  }
  // E-mail novo entra sem etapa: só vai para o funil quando alguém escolher a etapa na conversa.
  // (Muito e-mail é aviso, fornecedor ou cobrança; o funil fica só com quem é venda.)
  const { data: created, error } = await org.insert("conversations", {
    channel: "email", email_account_id: acc.id, contact_email: from, contact_name: name,
    ai_enabled: false, last_message_at: now, last_inbound_at: now, stage_id: null,
  }).select().single();
  if (error) ({ data: conv } = await find()); // corrida com outra execução
  return created ?? conv;
}

// deno-lint-ignore no-explicit-any
async function syncAccount(admin: any, acc: MailAccount) {
  const org = forOrg(admin, acc.organization_id);
  const pass = await accountPassword(admin, acc.id);
  if (!pass) return { skipped: "sem senha" };
  let client;
  try {
    client = await openImap(acc, pass);
  } catch (e) {
    await org.update("email_accounts", { health_status: "critical", health_error: friendlyMailError(e), last_sync_at: new Date().toISOString() })
      .eq("id", acc.id);
    return { error: "login" };
  }

  // Remetentes que a equipe marcou como "Não é atendimento".
  const { data: ign } = await org.select("email_ignore", "pattern");
  const ignored = (ign ?? []).map((r: { pattern: string }) => r.pattern);

  let imported = 0;
  let failed = false;
  let last = acc.last_uid ?? null;
  let validity: number | null = null;
  try {
    const box = await client.mailboxOpen("INBOX", { readOnly: true });
    validity = Number(box.uidValidity);
    // Caixa nova ou UIDVALIDITY mudou: começa do agora (não importa histórico).
    if (last === null || acc.uidvalidity !== validity) last = Number(box.uidNext) - 1;
    const found = ((await client.search({ uid: `${last + 1}:*` }, { uid: true })) || []) as number[];
    const uids = found.map(Number).filter((u: number) => u > last!).sort((a: number, b: number) => a - b).slice(0, MAX_PER_ACCOUNT);

    for (const uid of uids) {
      last = uid;
      const m = await client.fetchOne(String(uid), { source: true, size: true }, { uid: true });
      if (!m?.source || (m.size ?? 0) > MAX_MESSAGE_BYTES) continue;
      const mail = await PostalMime.parse(m.source);
      const from = String(mail.from?.address ?? "").trim().toLowerCase();
      const headers = (mail.headers ?? []) as unknown as { key: string; value: string }[];
      if (!from || from === acc.address.toLowerCase() || isAutomated(headers, from) || isIgnored(ignored, from)) continue;

      const conv = await conversationFor(admin, acc, from, mail.from?.name?.slice(0, 120) || null);
      if (!conv) continue;
      if (mail.messageId) {
        const { data: dup } = await org.select("messages", "id").eq("conversation_id", conv.id).eq("email_message_id", mail.messageId).maybeSingle();
        if (dup) continue;
      }
      const { data: ticket } = await admin.rpc("service_ticket_for_inbound", { conv: conv.id, from_me: false });
      const text = stripQuoted(mail.text || htmlToText(mail.html || "")).slice(0, 20_000) || "(e-mail sem texto)";
      await org.insert("messages", {
        conversation_id: conv.id, ticket_id: ticket?.id ?? null, direction: "inbound", sender: "contact", content: text,
        email_subject: (mail.subject ?? "").slice(0, 300) || null, email_message_id: mail.messageId ?? null,
        email_in_reply_to: mail.inReplyTo ?? null,
      });
      for (const a of (mail.attachments ?? []).slice(0, MAX_ATTACHMENTS)) {
        const bytes = a.content instanceof ArrayBuffer ? new Uint8Array(a.content) : new TextEncoder().encode(String(a.content ?? ""));
        if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES) continue;
        const fields = await storeMedia(admin, acc.organization_id, conv.id, bytes, { name: a.filename ?? null });
        if (fields) {
          await org.insert("messages", {
            conversation_id: conv.id, ticket_id: ticket?.id ?? null, direction: "inbound", sender: "contact",
            content: `[${fields.type}] ${fields.media_name}`, ...fields,
          });
        }
      }
      imported++;
    }
  } catch (e) {
    failed = true;
    console.error("[sync-email] falhou", { account: acc.id, message: e instanceof Error ? e.message.slice(0, 200) : String(e) });
  } finally {
    await client.logout().catch(() => {});
  }
  await org.update("email_accounts", {
    last_uid: last, uidvalidity: validity, last_sync_at: new Date().toISOString(),
    ...(failed ? { health_status: "warning", health_error: "Falha ao ler alguns e-mails; tentando de novo" } : { health_status: "ok", health_error: null }),
  }).eq("id", acc.id);
  return { imported };
}

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const expected = await getSecret(admin, "platform:cron_secret");
  if (!expected || !safeEqual(req.headers.get("x-cron-secret") ?? "", expected)) return ok({ ok: false, error: "unauthorized" }, 401);

  const { data: accounts, error } = await admin.from("email_accounts")
    .select("id, organization_id, name, address, username, imap_host, imap_port, smtp_host, smtp_port, last_uid, uidvalidity, organizations!inner(status)")
    .eq("status", "active").eq("has_password", true).eq("organizations.status", "active").order("last_sync_at", { ascending: true, nullsFirst: true }).limit(MAX_ACCOUNTS);
  if (error) return ok({ ok: false, error: error.message }, 500);

  const result: Record<string, unknown> = {};
  for (const acc of accounts ?? []) result[acc.id] = await syncAccount(admin, acc as MailAccount);
  return ok({ ok: true, result });
});
