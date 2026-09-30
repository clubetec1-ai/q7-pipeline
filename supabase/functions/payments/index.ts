import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { requireModule } from "../_shared/modules.ts";
import { HttpError, permissionsIn, requirePermission, requireUser, resolveOrg } from "../_shared/auth.ts";
import { forOrg } from "../_shared/tenant.ts";
import { putSecret } from "../_shared/secrets.ts";
import { asaas, asaasConfig, asaasError, type AsaasCfg, brDate, brl } from "../_shared/asaas.ts";

/**
 * Cobrança pelo WhatsApp (Asaas):
 *  - connect (org.settings): valida a chave, guarda no Vault e cadastra o
 *    webhook no Asaas sozinho (token gerado aqui, também no Vault);
 *  - create: cria a cobrança (o cliente escolhe PIX, boleto ou cartão) e envia
 *    na conversa pela send-message (mesmas regras de assumir/permissão);
 *  - cancel. Quem cobra: gestores; atendentes só se o dono liberar.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const WEBHOOK_EVENTS = ["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED", "PAYMENT_OVERDUE", "PAYMENT_DELETED", "PAYMENT_REFUNDED", "PAYMENT_RESTORED"];

function token(): string {
  const b = crypto.getRandomValues(new Uint8Array(36));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    const ctx = await requireUser(req);
    const orgId = await resolveOrg(ctx, body?.organization_id);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (action !== "disconnect") await requireModule(admin, orgId, "cobrancas");
    const org = forOrg(admin, orgId);
    const { data: orgRow } = await admin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
    const settings = (orgRow?.settings ?? {}) as Record<string, any>;
    const pay = (settings.payments ?? {}) as Record<string, any>;
    const saveSettings = (patch: Record<string, unknown>) =>
      admin.from("organizations").update({ settings: { ...settings, payments: { ...pay, ...patch } } }).eq("id", orgId);

    if (action === "connect") {
      await requirePermission(ctx, orgId, "org.settings");
      const env = body?.env === "production" ? "production" : "sandbox";
      const key = String(body?.api_key ?? "").trim();
      if (key.length < 20) throw new HttpError(400, "Cole a chave de API do Asaas");
      const cfg: AsaasCfg = { env, key };
      const check = await asaas(cfg, "GET", "/customers?limit=1");
      if (!check.ok) throw new HttpError(400, asaasError(check));
      if (!(await putSecret(admin, `org:${orgId}:asaas_api_key`, key))) throw new HttpError(500, "Não foi possível guardar a chave");

      const { data: base } = await admin.from("app_settings").select("value").eq("key", "functions_base_url").maybeSingle();
      const tok = token();
      const hook = await asaas(cfg, "POST", "/webhooks", {
        name: "ClubeCRM", url: `${base?.value}/payments-webhook?org=${orgId}`, email: ctx.user.email ?? undefined,
        enabled: true, interrupted: false, authToken: tok, sendType: "SEQUENTIALLY", events: WEBHOOK_EVENTS,
      });
      let warning: string | null = null;
      if (hook.ok) await putSecret(admin, `org:${orgId}:asaas_webhook_token`, tok);
      else warning = `Chave salva, mas o aviso automático de pagamento não foi cadastrado (${asaasError(hook)}). Tente conectar de novo.`;
      await saveSettings({ provider: "asaas", env, connected_at: new Date().toISOString(), webhook_id: hook.ok ? hook.data?.id ?? null : null });
      await admin.from("audit_log").insert({ organization_id: orgId, actor_id: ctx.user.id, action: "payments.connect", target: "asaas", meta: { env, webhook: hook.ok } });
      return json({ ok: true, env, warning });
    }

    if (action === "disconnect") {
      await requirePermission(ctx, orgId, "org.settings");
      await saveSettings({ provider: null, webhook_id: null });
      await admin.from("audit_log").insert({ organization_id: orgId, actor_id: ctx.user.id, action: "payments.disconnect", target: "asaas" });
      return json({ ok: true });
    }

    // Criar/cancelar: gestores sempre; atendentes só se liberado.
    const perms = await permissionsIn(ctx, orgId);
    const canCharge = perms.includes("org.settings") || perms.includes("reports.view")
      || (pay.allow_agents === true && perms.includes("conversations.attend"));
    if (!canCharge) throw new HttpError(403, "Sem permissão para cobrar. Peça a um gestor.");
    const cfg = await asaasConfig(admin, orgId);
    if (!cfg) throw new HttpError(409, "Conecte o Asaas em Cobranças antes de cobrar.");

    if (action === "create") {
      const conversationId = String(body?.conversation_id ?? "");
      const value = Math.round(Number(String(body?.value ?? "").replace(",", ".")) * 100) / 100;
      const due = String(body?.due_date ?? "");
      const description = String(body?.description ?? "").trim().slice(0, 300);
      if (!(value >= 5 && value <= 1_000_000)) throw new HttpError(400, "Valor inválido (mínimo R$ 5,00)");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || due < new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)) {
        throw new HttpError(400, "Vencimento inválido (hoje ou depois)");
      }
      // A conversa precisa ser visível para quem cobra (RLS do usuário).
      const { data: conv } = await ctx.userClient.from("conversations").select("id, organization_id, contact_id").eq("id", conversationId).maybeSingle();
      if (!conv || conv.organization_id !== orgId || !conv.contact_id) throw new HttpError(404, "Conversa não encontrada");
      const { data: ct } = await org.select("contacts", "id, name, phone, email, document").eq("id", conv.contact_id).maybeSingle();
      const doc = String(ct?.document ?? "").replace(/\D/g, "");
      if (![11, 14].includes(doc.length)) throw new HttpError(400, "Preencha o CPF/CNPJ do cliente na ficha antes de cobrar.");

      // Cliente no Asaas (reaproveita pelo id do contato).
      const found = await asaas(cfg, "GET", `/customers?externalReference=${ct.id}`);
      let customerId: string | null = found.ok ? found.data?.data?.[0]?.id ?? null : null;
      if (!customerId) {
        const phone = String(ct.phone ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
        const c = await asaas(cfg, "POST", "/customers", {
          name: (ct.name || ct.phone || "Cliente").slice(0, 100), cpfCnpj: doc, email: ct.email || undefined,
          mobilePhone: phone.length >= 10 ? phone : undefined, externalReference: ct.id, notificationDisabled: true,
        });
        if (!c.ok) throw new HttpError(400, asaasError(c));
        customerId = c.data.id;
      }
      const chargeId = crypto.randomUUID();
      const p = await asaas(cfg, "POST", "/payments", {
        customer: customerId, billingType: "UNDEFINED", value, dueDate: due, description: description || undefined, externalReference: chargeId,
      });
      if (!p.ok) throw new HttpError(400, asaasError(p));
      const pix = await asaas(cfg, "GET", `/payments/${p.data.id}/pixQrCode`);
      const pixCode = pix.ok && typeof pix.data?.payload === "string" ? pix.data.payload : null;
      const { error } = await org.insert("charges", {
        id: chargeId, contact_id: ct.id, conversation_id: conv.id, provider_id: p.data.id, value, due_date: due,
        description: description || null, invoice_url: p.data.invoiceUrl ?? null, pix_code: pixCode, created_by: ctx.user.id,
      });
      if (error) console.error("[payments] cobranca criada no Asaas mas nao gravada", { id: p.data.id, code: error.code });
      await admin.from("audit_log").insert({ organization_id: orgId, actor_id: ctx.user.id, action: "payments.create", target: chargeId, meta: { value, due } });

      let sent = false;
      let sendError: string | null = null;
      if (body?.send !== false) {
        const first = String(ct.name ?? "").trim().split(/\s+/)[0];
        const text = [
          `Olá${first ? ` ${first}` : ""}! Segue a cobrança${description ? ` de ${description}` : ""}: ${brl(value)}, vencimento ${brDate(due)}.`,
          p.data.invoiceUrl ? `Pague por PIX, boleto ou cartão: ${p.data.invoiceUrl}` : "",
          pixCode ? `\nPIX copia e cola:\n${pixCode}` : "",
        ].filter(Boolean).join("\n");
        const { data: base } = await admin.from("app_settings").select("value").eq("key", "functions_base_url").maybeSingle();
        const r = await fetch(`${base?.value}/send-message`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: req.headers.get("Authorization") ?? "", apikey: req.headers.get("apikey") ?? "" },
          body: JSON.stringify({ conversation_id: conv.id, text }),
        });
        const out = await r.json().catch(() => ({}));
        sent = !!out?.ok;
        sendError = sent ? null : String(out?.error ?? "não enviada");
      }
      return json({ ok: true, charge_id: chargeId, invoice_url: p.data.invoiceUrl ?? null, sent, send_error: sendError });
    }

    if (action === "cancel") {
      const { data: ch } = await org.select("charges", "id, provider_id, status").eq("id", String(body?.charge_id ?? "")).maybeSingle();
      if (!ch) throw new HttpError(404, "Cobrança não encontrada");
      if (!["pending", "overdue"].includes(ch.status)) throw new HttpError(409, "Só dá para cancelar cobrança em aberto");
      const r = await asaas(cfg, "DELETE", `/payments/${ch.provider_id}`);
      if (!r.ok) throw new HttpError(400, asaasError(r));
      await org.update("charges", { status: "canceled" }).eq("id", ch.id);
      await admin.from("audit_log").insert({ organization_id: orgId, actor_id: ctx.user.id, action: "payments.cancel", target: ch.id });
      return json({ ok: true });
    }
    throw new HttpError(400, "Ação inválida");
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    console.error("[payments]", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Erro inesperado" }, 500);
  }
});
