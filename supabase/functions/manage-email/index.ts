import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { HttpError, requirePermission, requireUser, resolveOrg } from "../_shared/auth.ts";
import { forOrg } from "../_shared/tenant.ts";
import { accountPassword, openImap, smtpTransport } from "../_shared/mail.ts";
import { friendlyMailError } from "../_shared/mail-utils.ts";

/**
 * "Testar conexão" da caixa de e-mail (org.settings). Testa IMAP e SMTP com os
 * dados informados; a senha vem do formulário (ainda não salva) ou do Vault.
 * Nunca devolve a senha nem detalhes técnicos crus.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const HOST = /^[A-Za-z0-9.-]{3,253}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.action !== "test") throw new HttpError(400, "Ação inválida");
    const ctx = await requireUser(req);
    const orgId = await resolveOrg(ctx, body?.organization_id);
    await requirePermission(ctx, orgId, "org.settings");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const cfg = {
      username: String(body?.username ?? "").trim(),
      imap_host: String(body?.imap_host ?? "").trim(), imap_port: Number(body?.imap_port),
      smtp_host: String(body?.smtp_host ?? "").trim(), smtp_port: Number(body?.smtp_port),
    };
    if (!cfg.username || !HOST.test(cfg.imap_host) || !HOST.test(cfg.smtp_host)
        || ![993, 143].includes(cfg.imap_port) || ![465, 587].includes(cfg.smtp_port)) {
      throw new HttpError(400, "Confira servidor, porta e usuário");
    }
    let pass = typeof body?.password === "string" && body.password ? String(body.password) : null;
    const accountId = typeof body?.account_id === "string" ? body.account_id : null;
    if (!pass && accountId) {
      // Só caixa da própria organização.
      const { data: acc } = await forOrg(admin, orgId).select("email_accounts", "id").eq("id", accountId).maybeSingle();
      if (!acc) throw new HttpError(404, "Caixa não encontrada");
      pass = await accountPassword(admin, acc.id);
    }
    if (!pass) throw new HttpError(400, "Informe a senha");

    const result = { imap: { ok: false, error: "" }, smtp: { ok: false, error: "" } };
    try {
      const c = await openImap(cfg, pass);
      await c.logout().catch(() => {});
      result.imap.ok = true;
    } catch (e) { result.imap.error = friendlyMailError(e); }
    try {
      const t = await smtpTransport(cfg, pass);
      await t.verify();
      result.smtp.ok = true;
    } catch (e) { result.smtp.error = friendlyMailError(e); }
    return json({ ok: true, ...result });
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    console.error("[manage-email]", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Erro inesperado" }, 500);
  }
});
