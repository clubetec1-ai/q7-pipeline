import { GRAPH_VERSION } from "./providers/cloud.ts";
import { getSecret } from "./secrets.ts";

/**
 * Messenger e Instagram Direct pela Plataforma do Messenger (mesma API para os dois,
 * com o token da Página). O token fica no Vault (metapage:<id>:token) e nunca vai
 * para o navegador.
 */
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
export const PAGE_TOKEN = (pageUuid: string) => `metapage:${pageUuid}:token`;

export interface MetaSend { ok: boolean; messageId?: string; error?: string }

// deno-lint-ignore no-explicit-any
export async function pageToken(admin: any, pageUuid: string): Promise<string | null> {
  return await getSecret(admin, PAGE_TOKEN(pageUuid));
}

/** Mensagem de texto para a pessoa (PSID no Messenger, IGSID no Instagram). */
export async function sendMetaText(token: string, recipientId: string, text: string): Promise<MetaSend> {
  try {
    const res = await fetch(`${GRAPH}/me/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text: text.slice(0, 2000) } }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: friendly(data?.error?.code, data?.error?.message) };
    return { ok: true, messageId: data?.message_id };
  } catch {
    return { ok: false, error: "A Meta não respondeu. Tente de novo." };
  }
}

/** Nome da pessoa (o melhor que a Meta deixar ver); null se não der. */
export async function metaProfileName(token: string, userId: string, channel: "messenger" | "instagram"): Promise<string | null> {
  const fields = channel === "instagram" ? "name,username" : "first_name,last_name";
  try {
    const res = await fetch(`${GRAPH}/${encodeURIComponent(userId)}?fields=${fields}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    const name = channel === "instagram" ? (d.name || (d.username ? `@${d.username}` : "")) : [d.first_name, d.last_name].filter(Boolean).join(" ");
    return String(name ?? "").trim().slice(0, 120) || null;
  } catch {
    return null;
  }
}

/** Confere o token e devolve a Página e a conta do Instagram ligada (se houver). */
export async function inspectPage(token: string, pageId: string): Promise<
  { ok: true; name: string; igId: string | null; igUsername: string | null } | { ok: false; error: string }
> {
  try {
    const res = await fetch(`${GRAPH}/${encodeURIComponent(pageId)}?fields=name,instagram_business_account{id,username}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d?.name) return { ok: false, error: friendly(d?.error?.code, d?.error?.message) };
    return { ok: true, name: String(d.name).slice(0, 120), igId: d.instagram_business_account?.id ?? null,
      igUsername: d.instagram_business_account?.username ?? null };
  } catch {
    return { ok: false, error: "A Meta não respondeu. Tente de novo." };
  }
}

/** Liga (ou desliga) o recebimento das mensagens da Página no app da Clubetec. */
export async function subscribePage(token: string, pageId: string, on: boolean): Promise<boolean> {
  const url = `${GRAPH}/${encodeURIComponent(pageId)}/subscribed_apps` + (on ? "?subscribed_fields=messages,messaging_postbacks,message_echoes" : "");
  try {
    const res = await fetch(url, { method: on ? "POST" : "DELETE", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

function friendly(code: number | undefined, msg: string | undefined): string {
  if (code === 190) return "O token da Página é inválido ou venceu. Gere um novo e conecte de novo.";
  if (code === 10 || code === 200) return "Falta permissão no app da Meta (pages_messaging / instagram_manage_messages).";
  if (code === 551 || code === 100) return "A pessoa não pode receber esta mensagem agora (janela de 24 h ou conta indisponível).";
  return (msg ?? "A Meta recusou.").slice(0, 200);
}
