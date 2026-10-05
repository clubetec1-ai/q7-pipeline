import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { HttpError, isPlatformOperator, requirePermission, requireUser, resolveOrg } from "../_shared/auth.ts";
import { getSecret, putSecret, randomHex } from "../_shared/secrets.ts";
import { asaas, asaasError, type AsaasCfg, mapStatus } from "../_shared/asaas.ts";

/**
 * Assinatura do Deixa com a IA, cobrada pelo Asaas da CLUBETEC (não o do cliente).
 *  - platform_connect (operador): chave da Clubetec no Vault + cadastro do aviso (webhook);
 *  - subscribe (dono, org.billing): cliente + assinatura mensal no Asaas (o cliente escolhe PIX,
 *    boleto ou cartão na página do Asaas — nenhum dado de pagamento passa por aqui);
 *  - status: cobranças da assinatura com o link para pagar; cancel: não renova.
 * Ids e situação gravados só por RPC service_* (auditadas).
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const EVENTS = ["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED", "PAYMENT_OVERDUE", "PAYMENT_DELETED", "PAYMENT_REFUNDED", "SUBSCRIPTION_DELETED"];
const today = () => new Date().toISOString().slice(0, 10);

/** CPF/CNPJ com dígito verificador válido. */
function validDoc(d: string): boolean {
  if (!/^\d{11}$|^\d{14}$/.test(d) || /^(\d)\1+$/.test(d)) return false;
  const calc = (base: string, weights: number[]) => {
    const s = weights.reduce((acc, w, i) => acc + Number(base[i]) * w, 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  if (d.length === 11) {
    const w1 = [10, 9, 8, 7, 6, 5, 4, 3, 2], w2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
    return calc(d, w1) === Number(d[9]) && calc(d, w2) === Number(d[10]);
  }
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return calc(d, w1) === Number(d[12]) && calc(d, w2) === Number(d[13]);
}

// deno-lint-ignore no-explicit-any
async function platformCfg(admin: any): Promise<AsaasCfg | null> {
  const key = await getSecret(admin, "platform:asaas_api_key");
  if (!key) return null;
  const { data } = await admin.from("app_settings").select("value").eq("key", "platform_asaas_env").maybeSingle();
  return { env: data?.value === "production" ? "production" : "sandbox", key };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    const ctx = await requireUser(req);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (action === "platform_connect") {
      if (!(await isPlatformOperator(ctx))) throw new HttpError(403, "Só a Clubetec");
      const env = body?.env === "production" ? "production" : "sandbox";
      const key = String(body?.api_key ?? "").trim();
      if (key.length < 20) throw new HttpError(400, "Cole a chave de API do Asaas da Clubetec");
      const cfg: AsaasCfg = { env, key };
      const check = await asaas(cfg, "GET", "/customers?limit=1");
      if (!check.ok) throw new HttpError(400, asaasError(check));
      if (!(await putSecret(admin, "platform:asaas_api_key", key))) throw new HttpError(500, "Não foi possível guardar a chave");
      await admin.from("app_settings").upsert({ key: "platform_asaas_env", value: env, updated_by: ctx.user.id }, { onConflict: "key" });
      const { data: base } = await admin.from("app_settings").select("value").eq("key", "functions_base_url").maybeSingle();
      const tok = randomHex(24);
      const hook = await asaas(cfg, "POST", "/webhooks", {
        name: "Deixa com a IA — assinaturas", url: `${base?.value}/billing-webhook`, email: ctx.user.email ?? undefined,
        enabled: true, interrupted: false, authToken: tok, sendType: "SEQUENTIALLY", events: EVENTS,
      });
      if (hook.ok) await putSecret(admin, "platform:asaas_webhook_token", tok);
      await admin.from("audit_log").insert({ actor_id: ctx.user.id, action: "platform.billing_connect", target: "asaas", meta: { env, webhook: hook.ok } });
      return json({ ok: true, env, warning: hook.ok ? null : `Chave salva, mas o aviso de pagamento não foi cadastrado (${asaasError(hook)}).` });
    }

    const orgId = await resolveOrg(ctx, body?.organization_id);
    await requirePermission(ctx, orgId, "org.billing");
    const cfg = await platformCfg(admin);
    if (!cfg) throw new HttpError(409, "A cobrança online ainda não está ativa. Fale com a Clubetec para assinar.");
    const { data: sub } = await admin.from("subscriptions").select("*").eq("organization_id", orgId).maybeSingle();

    if (action === "status") {
      if (!sub?.asaas_subscription_id) return json({ ok: true, invoices: [] });
      const r = await asaas(cfg, "GET", `/subscriptions/${sub.asaas_subscription_id}/payments?limit=12`);
      const extra = sub.setup_payment_id ? await asaas(cfg, "GET", `/payments/${sub.setup_payment_id}`) : null;
      // deno-lint-ignore no-explicit-any
      const list: any[] = [...(r.ok ? r.data?.data ?? [] : []), ...(extra?.ok ? [extra.data] : [])];
      return json({ ok: true, invoices: list.map((p) => ({ id: String(p.id), value: Number(p.value) || 0, due: String(p.dueDate ?? ""), status: mapStatus(String(p.status ?? "")), url: p.invoiceUrl ?? null }))
        .sort((a, b) => b.due.localeCompare(a.due)) });
    }

    if (action === "cancel") {
      if (!sub?.asaas_subscription_id) throw new HttpError(409, "Não há assinatura para cancelar.");
      const r = await asaas(cfg, "DELETE", `/subscriptions/${sub.asaas_subscription_id}`);
      if (!r.ok) throw new HttpError(502, asaasError(r));
      await admin.rpc("service_billing_cancel", { org: orgId });
      await admin.from("audit_log").insert({ organization_id: orgId, actor_id: ctx.user.id, action: "billing.cancel", target: sub.asaas_subscription_id });
      return json({ ok: true });
    }

    if (action !== "subscribe") throw new HttpError(400, "Ação inválida");
    const planKey = String(body?.plan ?? "");
    const doc = String(body?.cpf_cnpj ?? "").replace(/\D/g, "");
    if (!validDoc(doc)) throw new HttpError(400, "CPF ou CNPJ inválido.");
    const { data: plan } = await admin.from("plans").select("*").eq("key", planKey).eq("active", true).eq("public", true).maybeSingle();
    if (!plan) throw new HttpError(400, "Plano indisponível.");
    const { data: orgRow } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle();
    const email = sub?.billing_email || ctx.user.email || undefined;

    let customer = sub?.asaas_customer_id ?? null;
    if (!customer) {
      const c = await asaas(cfg, "POST", "/customers", { name: orgRow?.name ?? "Cliente", cpfCnpj: doc, email, externalReference: orgId, notificationDisabled: false });
      if (!c.ok) throw new HttpError(400, asaasError(c));
      customer = String(c.data.id);
    }
    const value = Number(plan.price_cents) / 100;
    const description = `Deixa com a IA — plano ${plan.name}`;
    let subId = sub?.asaas_subscription_id ?? null;
    if (subId) {
      const u = await asaas(cfg, "POST", `/subscriptions/${subId}`, { value, description, updatePendingPayments: true });
      if (!u.ok) subId = null; // assinatura antiga apagada no Asaas: cria outra
    }
    if (!subId) {
      const trialEnd = sub?.status === "trial" && sub.trial_ends_at ? String(sub.trial_ends_at).slice(0, 10) : today();
      const s = await asaas(cfg, "POST", "/subscriptions", {
        customer, billingType: "UNDEFINED", value, nextDueDate: trialEnd > today() ? trialEnd : today(), cycle: "MONTHLY",
        description, externalReference: orgId,
      });
      if (!s.ok) throw new HttpError(400, asaasError(s));
      subId = String(s.data.id);
    }
    // Implantação: cobrança única, só uma vez por empresa.
    let setupId = sub?.setup_payment_id ?? null;
    if (!setupId && Number(plan.setup_cents) > 0) {
      const p = await asaas(cfg, "POST", "/payments", {
        customer, billingType: "UNDEFINED", value: Number(plan.setup_cents) / 100, dueDate: today(),
        description: `Implantação — Deixa com a IA (${plan.name})`, externalReference: orgId,
      });
      if (p.ok) setupId = String(p.data.id);
    }
    const { error } = await admin.rpc("service_billing_link", { org: orgId, customer, sub: subId, plan: planKey, setup_id: setupId, email: email ?? null });
    if (error) throw new HttpError(500, "Assinatura criada no Asaas, mas não foi registrada. Fale com a Clubetec.");
    await admin.from("audit_log").insert({ organization_id: orgId, actor_id: ctx.user.id, action: "billing.subscribe", target: planKey });

    // Link da primeira cobrança em aberto (implantação ou mensalidade).
    const pays = await asaas(cfg, "GET", `/subscriptions/${subId}/payments?limit=3`);
    const setup = setupId ? await asaas(cfg, "GET", `/payments/${setupId}`) : null;
    // deno-lint-ignore no-explicit-any
    const open = [...(setup?.ok ? [setup.data] : []), ...(pays.ok ? pays.data?.data ?? [] : [])].find((p: any) => mapStatus(String(p?.status ?? "")) !== "paid");
    return json({ ok: true, url: open?.invoiceUrl ?? null });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error("billing:", e);
    return json({ ok: false, error: e instanceof HttpError ? e.message : "Erro interno" }, status);
  }
});
