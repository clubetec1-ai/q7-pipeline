/**
 * Asaas (cobrança por PIX/boleto/cartão). Chave por organização no Vault
 * (org:<org>:asaas_api_key); ambiente em organizations.settings.payments.env.
 */
import { getSecret } from "./secrets.ts";

export const ASAAS_BASE: Record<string, string> = {
  sandbox: "https://api-sandbox.asaas.com/v3",
  production: "https://api.asaas.com/v3",
};

export interface AsaasCfg { env: "sandbox" | "production"; key: string }

// deno-lint-ignore no-explicit-any
export async function asaasConfig(admin: any, orgId: string): Promise<AsaasCfg | null> {
  const { data } = await admin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  const p = (data?.settings?.payments ?? {}) as Record<string, unknown>;
  if (p.provider !== "asaas") return null;
  const key = await getSecret(admin, `org:${orgId}:asaas_api_key`);
  return key ? { env: p.env === "production" ? "production" : "sandbox", key } : null;
}

// deno-lint-ignore no-explicit-any
export async function asaas(cfg: AsaasCfg, method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  try {
    const res = await fetch(`${ASAAS_BASE[cfg.env]}${path}`, {
      method,
      headers: { access_token: cfg.key, "Content-Type": "application/json", "User-Agent": "ClubeCRM" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: {} };
  }
}

/** Mensagem de erro do Asaas em linguagem simples (sem detalhes internos). */
export function asaasError(r: { status: number; data: any }): string {
  if (r.status === 401) return "Chave do Asaas inválida ou de outro ambiente (sandbox × produção).";
  const d = r.data?.errors?.[0]?.description;
  return typeof d === "string" ? `Asaas: ${d.slice(0, 200)}` : r.status ? `Asaas respondeu HTTP ${r.status}` : "Não consegui falar com o Asaas.";
}

/** Status do Asaas → status da cobrança no CRM. */
export function mapStatus(s: string): "pending" | "paid" | "overdue" | "canceled" | "refunded" {
  if (["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(s)) return "paid";
  if (s === "OVERDUE") return "overdue";
  if (["REFUNDED", "REFUND_REQUESTED", "CHARGEBACK_REQUESTED"].includes(s)) return "refunded";
  if (s === "DELETED") return "canceled";
  return "pending";
}

export const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const brDate = (d: string) => d.split("-").reverse().join("/");
