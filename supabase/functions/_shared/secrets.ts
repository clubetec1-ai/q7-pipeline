/**
 * Segredos do Vault, referenciados por nome (spec §6.3):
 *   org:<org_id>:<chave> · instance:<instance_id>:(token|webhook|app_secret) · platform:<chave>
 *
 * Leitura só com service_role, pelas RPCs service_*. Nunca registrar o valor
 * em log nem devolvê-lo em resposta HTTP.
 */
// deno-lint-ignore no-explicit-any
type SupabaseClient = { rpc: (fn: string, args?: Record<string, unknown>) => any };

const TTL_MS = 60_000;
const cache = new Map<string, { value: string | null; at: number }>();

export async function getSecret(admin: SupabaseClient, name: string): Promise<string | null> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const { data, error } = await admin.rpc("service_get_secret", { secret_name: name });
  if (error) {
    console.error("[secrets] leitura falhou", { name, code: error.code });
    return null;
  }
  const value = (data as string | null) || null;
  cache.set(name, { value, at: Date.now() });
  return value;
}

export async function putSecret(admin: SupabaseClient, name: string, value: string): Promise<boolean> {
  const { error } = await admin.rpc("service_put_secret", { secret_name: name, secret_value: value });
  cache.delete(name);
  if (error) console.error("[secrets] gravação falhou", { name, code: error.code });
  return !error;
}

export async function hasSecret(admin: SupabaseClient, name: string): Promise<boolean> {
  const { data } = await admin.rpc("service_has_secret", { secret_name: name });
  return data === true;
}

/** Cópia da linha da instância com o token vindo do Vault. */
export async function withInstanceToken<T extends { id: string; instance_token?: string | null }>(
  admin: SupabaseClient,
  inst: T,
): Promise<T> {
  const token = await getSecret(admin, `instance:${inst.id}:token`);
  return { ...inst, instance_token: token };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Hex(key: string, body: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Comparação em tempo constante (não revela onde os valores divergem). */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function randomHex(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}
