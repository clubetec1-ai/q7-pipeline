import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { HttpError, requirePermission, requireUser } from "../_shared/auth.ts";

/**
 * LGPD — anonimizar contato a pedido do titular (dono/admin, org.settings).
 * A organização vem do próprio contato (nunca do navegador); o banco troca os
 * dados pessoais e devolve os arquivos, que são apagados do armazenamento.
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
    const contactId = String(body?.contact_id ?? "");
    const reason = String(body?.reason ?? "").trim().slice(0, 300);
    if (!/^[0-9a-f-]{36}$/i.test(contactId)) throw new HttpError(400, "Contato inválido");
    if (reason.length < 5) throw new HttpError(400, "Informe o motivo (ex.: pedido do titular por WhatsApp em 29/09).");
    const ctx = await requireUser(req);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: ct } = await admin.from("contacts").select("organization_id").eq("id", contactId).maybeSingle();
    if (!ct) throw new HttpError(404, "Contato não encontrado");
    await requirePermission(ctx, ct.organization_id, "org.settings"); // também confere que a pessoa é da organização

    const { data, error } = await admin.rpc("service_anonymize_contact", {
      org: ct.organization_id, contact: contactId, actor: ctx.user.id, reason,
    });
    if (error) throw new HttpError(500, "Não foi possível anonimizar");
    const media = ((data as { media?: string[] })?.media ?? []).filter((p) => p.startsWith(`${ct.organization_id}/`));
    let removed = 0;
    for (let i = 0; i < media.length; i += 100) {
      const { data: gone } = await admin.storage.from("media").remove(media.slice(i, i + 100));
      removed += gone?.length ?? 0;
    }
    return json({ ok: true, conversations: (data as { conversations?: number })?.conversations ?? 0, files: removed, already: !!(data as { already?: boolean })?.already });
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    console.error("[anonymize-contact]", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Erro inesperado" }, 500);
  }
});
