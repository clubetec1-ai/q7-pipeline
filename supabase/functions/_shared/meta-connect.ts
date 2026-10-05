import { forOrg } from "./tenant.ts";
import { putSecret, randomHex } from "./secrets.ts";
import { GRAPH_VERSION } from "./providers/cloud.ts";
import { inspectPage, PAGE_TOKEN, subscribePage } from "./meta-messaging.ts";

/**
 * Ligar uma Página (Messenger/Instagram) ou um número oficial (WhatsApp Cloud) numa
 * empresa — o mesmo código para a conexão manual (ID + token) e para "Conectar com o
 * Facebook". Confere tudo na Meta antes de gravar; token só no Vault.
 */
export const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
// deno-lint-ignore no-explicit-any
type Admin = any;
export class ConnectError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function connectPage(admin: Admin, orgId: string, userId: string, pageId: string, token: string) {
  const { data: other } = await admin.from("meta_pages").select("id, organization_id").eq("page_id", pageId).maybeSingle();
  if (other && other.organization_id !== orgId) throw new ConnectError(409, "Esta Página já está conectada em outra empresa.");
  const info = await inspectPage(token, pageId);
  if (!info.ok) throw new ConnectError(400, info.error);
  if (info.igId) {
    const { data: igOther } = await admin.from("meta_pages").select("organization_id").eq("ig_account_id", info.igId).maybeSingle();
    if (igOther && igOther.organization_id !== orgId) throw new ConnectError(409, "Este Instagram já está conectado em outra empresa.");
  }
  const row = {
    organization_id: orgId, page_id: pageId, name: info.name, ig_account_id: info.igId, ig_username: info.igUsername,
    instagram: !!info.igId, status: "connected", last_error: null, updated_at: new Date().toISOString(),
  };
  const { data: saved, error } = other
    ? await admin.from("meta_pages").update(row).eq("id", other.id).select("id").single()
    : await admin.from("meta_pages").insert(row).select("id").single();
  if (error || !saved) throw new ConnectError(500, "Não foi possível salvar a Página.");
  if (!(await putSecret(admin, PAGE_TOKEN(saved.id), token))) throw new ConnectError(500, "Não foi possível guardar o token.");
  const subscribed = await subscribePage(token, pageId, true);
  if (!subscribed) {
    await admin.from("meta_pages").update({ status: "error", last_error: "A Meta não ligou o recebimento das mensagens (assinatura da Página)." }).eq("id", saved.id);
  }
  await admin.from("audit_log").insert({ organization_id: orgId, actor_id: userId, action: "meta_page.connected", target: saved.id, meta: { page_id: pageId, instagram: !!info.igId } });
  return { id: saved.id as string, name: info.name, instagram: info.igUsername, subscribed };
}

export async function connectCloudNumber(admin: Admin, orgId: string, userId: string,
  p: { phoneNumberId: string; wabaId: string; token: string; name?: string; color?: string | null; via: "manual" | "embedded_signup" }) {
  const { data: canAdd } = await admin.rpc("service_can_add_number", { org: orgId });
  if (canAdd !== true) throw new ConnectError(409, "Limite de números do seu plano atingido.");
  const { data: existing } = await admin.from("whatsapp_instances").select("organization_id").eq("phone_number_id", p.phoneNumberId).maybeSingle();
  if (existing) {
    throw new ConnectError(409, existing.organization_id === orgId ? "Este número já está conectado nesta empresa." : "Este número já está conectado em outra conta.");
  }
  const auth = { Authorization: `Bearer ${p.token}` };
  // 1. Posse: o token lista os números da WABA e o número informado está lá.
  const list = await fetch(`${GRAPH}/${p.wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,messaging_limit_tier`, { headers: auth });
  if (!list.ok) throw new ConnectError(400, "Este acesso não alcança essa conta do WhatsApp Business (WABA).");
  const numbers = ((await list.json())?.data ?? []) as Array<Record<string, string>>;
  const pn = numbers.find((n) => n.id === p.phoneNumberId);
  if (!pn) throw new ConnectError(400, "Esse número não pertence a essa conta do WhatsApp Business.");
  // 2. Recebimento de mensagens: inscreve o app na WABA.
  const sub = await fetch(`${GRAPH}/${p.wabaId}/subscribed_apps`, { method: "POST", headers: auth });
  if (!sub.ok) throw new ConnectError(400, "A Meta não permitiu ativar o recebimento de mensagens nessa conta.");
  // 3. Número novo na Cloud API precisa ser registrado (PIN de 6 dígitos guardado no cofre). Já registrado: segue.
  const pin = String(parseInt(randomHex(4), 16) % 900000 + 100000);
  const reg = p.via === "embedded_signup"
    ? await fetch(`${GRAPH}/${p.phoneNumberId}/register`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", pin }) }).catch(() => null)
    : null;
  // 4. Cria o número e guarda o token no Vault; se o Vault falhar, desfaz.
  const org = forOrg(admin, orgId);
  const { data: row, error } = await org.insert("whatsapp_instances", {
    user_id: userId, name: String(p.name ?? "").trim() || pn.verified_name || "WhatsApp Oficial",
    phone: String(pn.display_phone_number ?? "").replace(/\D/g, "") || null, provider: "cloud",
    phone_number_id: p.phoneNumberId, waba_id: p.wabaId, status: "connected", connected_via: p.via,
    color: p.color ?? null, quality_rating: pn.quality_rating ?? null, messaging_limit_tier: pn.messaging_limit_tier ?? null,
  }).select("id, name, phone").single();
  if (error || !row) throw new ConnectError(500, "Não foi possível registrar o número");
  const secretName = `instance:${row.id}:token`;
  if (!(await putSecret(admin, secretName, p.token))) {
    await org.delete("whatsapp_instances").eq("id", row.id);
    throw new ConnectError(500, "Não foi possível guardar o token com segurança. Nada foi salvo.");
  }
  if (reg?.ok) await putSecret(admin, `instance:${row.id}:pin`, pin);
  await org.update("whatsapp_instances", { secret_name: secretName }).eq("id", row.id);
  await admin.from("audit_log").insert({ organization_id: orgId, actor_id: userId, action: "number.connected", target: row.id, meta: { via: p.via } });
  return { instance_id: row.id as string, name: row.name as string, phone: row.phone as string | null };
}
