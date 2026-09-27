import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { getSecret } from "./secrets.ts";

interface UazapiConfig {
  serverUrl: string;
  adminToken: string | null;
  instanceToken: string | null;
}

let cache: { data: UazapiConfig | null; expires: number } | null = null;
const CACHE_TTL_MS = 60_000;

export async function getUazapiConfig(): Promise<UazapiConfig | null> {
  if (cache && cache.expires > Date.now()) return cache.data;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  let serverUrl: string | null = null;
  let adminToken: string | null = null;
  let instanceToken: string | null = null;

  if (supabaseUrl && serviceKey) {
    try {
      const admin = createClient(supabaseUrl, serviceKey);
      const { data } = await admin
        .from("app_settings")
        .select("key,value")
        .eq("key", "uazapi_server_url");
      serverUrl = data?.[0]?.value ?? null;
      // Token de administrador da plataforma: só no Vault.
      adminToken = await getSecret(admin, "platform:uazapi_admin_token");
    } catch (e) {
      console.error("[get-uazapi-config] db read failed:", e);
    }
  }


  if (!serverUrl) {
    cache = { data: null, expires: Date.now() + CACHE_TTL_MS };
    return null;
  }

  const config: UazapiConfig = {
    serverUrl: serverUrl.replace(/\/$/, ""),
    adminToken,
    // Sem token de instância global: cada número usa só o próprio token (Vault).
    // Um token compartilhado faria o número de um cliente enviar pelo de outro.
    instanceToken,
  };

  cache = { data: config, expires: Date.now() + CACHE_TTL_MS };
  return config;
}
