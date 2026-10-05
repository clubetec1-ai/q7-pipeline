import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { HttpError, requirePermission, requireUser, resolveOrg } from "../_shared/auth.ts";
import { putSecret } from "../_shared/secrets.ts";
import { moduleOn } from "../_shared/modules.ts";
import { inspectPage, PAGE_TOKEN, pageToken, subscribePage } from "../_shared/meta-messaging.ts";

/**
 * Facebook e Instagram (dono/admin, módulo Canais): conectar a Página com o token
 * (conferido na Meta; vai para o Vault e nunca volta), e desconectar.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    if (!["connect", "disconnect"].includes(action)) throw new HttpError(400, "Ação inválida");
    const ctx = await requireUser(req);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (action === "connect") {
      const orgId = await resolveOrg(ctx, body?.organization_id);
      await requirePermission(ctx, orgId, "org.settings");
      if (!(await moduleOn(admin, orgId, "canais"))) throw new HttpError(403, "O módulo Canais não está contratado.");
      const pageId = String(body?.page_id ?? "").trim();
      const token = String(body?.token ?? "").trim();
      if (!/^[0-9]{5,30}$/.test(pageId)) throw new HttpError(400, "ID da Página inválido (só números).");
      if (token.length < 20 || token.length > 1000 || /\s/.test(token)) throw new HttpError(400, "Token da Página inválido.");

      const { data: other } = await admin.from("meta_pages").select("id, organization_id").eq("page_id", pageId).maybeSingle();
      if (other && other.organization_id !== orgId) throw new HttpError(409, "Esta Página já está conectada em outra empresa.");

      const info = await inspectPage(token, pageId);
      if (!info.ok) throw new HttpError(400, info.error);
      if (info.igId) {
        const { data: igOther } = await admin.from("meta_pages").select("organization_id").eq("ig_account_id", info.igId).maybeSingle();
        if (igOther && igOther.organization_id !== orgId) throw new HttpError(409, "Este Instagram já está conectado em outra empresa.");
      }
      const row = {
        organization_id: orgId, page_id: pageId, name: info.name, ig_account_id: info.igId, ig_username: info.igUsername,
        instagram: !!info.igId, status: "connected", last_error: null, updated_at: new Date().toISOString(),
      };
      const { data: saved, error } = other
        ? await admin.from("meta_pages").update(row).eq("id", other.id).select("id").single()
        : await admin.from("meta_pages").insert(row).select("id").single();
      if (error || !saved) throw new HttpError(500, "Não foi possível salvar a Página.");
      if (!(await putSecret(admin, PAGE_TOKEN(saved.id), token))) throw new HttpError(500, "Não foi possível guardar o token.");
      const subscribed = await subscribePage(token, pageId, true);
      if (!subscribed) {
        await admin.from("meta_pages").update({ status: "error", last_error: "A Meta não ligou o recebimento das mensagens (assinatura da Página)." }).eq("id", saved.id);
      }
      await admin.from("audit_log").insert({ organization_id: orgId, actor_id: ctx.user.id, action: "meta_page.connected", target: saved.id, meta: { page_id: pageId, instagram: !!info.igId } });
      return json({ ok: true, id: saved.id, name: info.name, instagram: info.igUsername, subscribed });
    }

    // disconnect
    const id = String(body?.page ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "Página inválida");
    const { data: pg } = await admin.from("meta_pages").select("id, organization_id, page_id").eq("id", id).maybeSingle();
    if (!pg) throw new HttpError(404, "Página não encontrada");
    await requirePermission(ctx, pg.organization_id, "org.settings");
    const token = await pageToken(admin, pg.id);
    if (token) await subscribePage(token, pg.page_id, false);
    await admin.rpc("service_meta_page_forget", { page: pg.id });
    await admin.from("meta_pages").update({ status: "disconnected", updated_at: new Date().toISOString() }).eq("id", pg.id);
    await admin.from("audit_log").insert({ organization_id: pg.organization_id, actor_id: ctx.user.id, action: "meta_page.disconnected", target: pg.id });
    return json({ ok: true });
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    console.error("[meta-pages]", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Erro interno" }, 500);
  }
});
