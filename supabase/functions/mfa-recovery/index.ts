import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { HttpError, requireUser } from "../_shared/auth.ts";
import { sha256Hex } from "../_shared/secrets.ts";
import { esc, sendSystemEmail } from "../_shared/email.ts";

/**
 * Códigos de recuperação do MFA (da própria pessoa logada).
 *  - generate: só com o código já digitado (aal2); cria 10 códigos de uso único
 *    (devolvidos uma vez; só o hash fica guardado) e invalida os anteriores.
 *  - redeem: perdeu o celular — com a senha (aal1) + um código, remove os fatores
 *    para cadastrar o novo celular. 5 erros a cada 15 min; avisa por e-mail.
 *  - notify_disabled: avisa por e-mail quando a pessoa desativou o MFA.
 * Tudo vai para a auditoria (sem o código).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 símbolos, sem 0/O/1/I
const newCode = () => {
  const b = crypto.getRandomValues(new Uint8Array(10));
  const s = [...b].map((x) => ALPHABET[x % 32]).join("");
  return `${s.slice(0, 5)}-${s.slice(5)}`;
};
const norm = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");
const hashOf = (userId: string, code: string) => sha256Hex(`${userId}:${norm(code)}`);

/** Nível da sessão (aal1/aal2) do JWT já validado por requireUser. */
function sessionAal(req: Request): string {
  try {
    const part = (req.headers.get("Authorization") ?? "").split(".")[1] ?? "";
    const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    return String(payload?.aal ?? "aal1");
  } catch { return "aal1"; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    const ctx = await requireUser(req);
    const uid = ctx.user.id;
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const audit = (a: string, meta: Record<string, unknown> = {}) =>
      admin.from("audit_log").insert({ organization_id: null, actor_id: uid, action: a, target: uid, meta });
    const verifiedFactors = async () => {
      const { data } = await admin.auth.admin.mfa.listFactors({ userId: uid });
      return (data?.factors ?? []).filter((f: { status: string }) => f.status === "verified");
    };
    const mail = (subject: string, line: string) => sendSystemEmail(admin, {
      to: ctx.user.email ?? "", subject: `[ClubeCRM] ${subject}`,
      text: `Olá!\n\n${line}\n\nSe não foi você, troque a senha agora e fale com o responsável pela sua empresa.\n\nClubeCRM`,
      html: `<p>Olá!</p><p>${esc(line)}</p><p><b>Se não foi você</b>, troque a senha agora e fale com o responsável pela sua empresa.</p><p>ClubeCRM</p>`,
    });

    if (action === "generate") {
      if (sessionAal(req) !== "aal2" || !(await verifiedFactors()).length) {
        throw new HttpError(403, "Ative a verificação em duas etapas e entre com o código antes de gerar os códigos de recuperação.");
      }
      const codes = Array.from({ length: 10 }, newCode);
      await admin.from("mfa_recovery_codes").delete().eq("user_id", uid);
      const rows = await Promise.all(codes.map(async (c) => ({ user_id: uid, code_hash: await hashOf(uid, c) })));
      const { error } = await admin.from("mfa_recovery_codes").insert(rows);
      if (error) throw new HttpError(500, "Não foi possível gerar os códigos");
      await audit("mfa.recovery_generated", { count: codes.length });
      return json({ ok: true, codes });
    }

    if (action === "redeem") {
      const since = new Date(Date.now() - 15 * 60_000).toISOString();
      const { count } = await admin.from("audit_log").select("id", { count: "exact", head: true })
        .eq("actor_id", uid).eq("action", "mfa.recovery_failed").gte("created_at", since);
      if ((count ?? 0) >= 5) throw new HttpError(429, "Muitas tentativas. Espere 15 minutos.");
      const code = String(body?.code ?? "");
      if (norm(code).length !== 10) { await audit("mfa.recovery_failed"); throw new HttpError(400, "Código inválido"); }
      const { data: used } = await admin.from("mfa_recovery_codes").update({ used_at: new Date().toISOString() })
        .eq("user_id", uid).eq("code_hash", await hashOf(uid, code)).is("used_at", null).select("id");
      if (!used?.length) { await audit("mfa.recovery_failed"); throw new HttpError(400, "Código inválido ou já usado"); }
      for (const f of await verifiedFactors()) await admin.auth.admin.mfa.deleteFactor({ userId: uid, id: f.id });
      await audit("mfa.recovery_used");
      await mail("Verificação em duas etapas removida", "Um código de recuperação foi usado na sua conta e o aplicativo autenticador antigo foi removido. Cadastre o celular novo em Segurança.");
      return json({ ok: true });
    }

    if (action === "notify_disabled") {
      if ((await verifiedFactors()).length) return json({ ok: true, skipped: true });
      await admin.from("mfa_recovery_codes").delete().eq("user_id", uid);
      await audit("mfa.disabled");
      await mail("Verificação em duas etapas desativada", "A verificação em duas etapas foi desativada na sua conta. Agora o login pede só a senha.");
      return json({ ok: true });
    }
    throw new HttpError(400, "Ação inválida");
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    console.error("[mfa-recovery]", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Erro inesperado" }, 500);
  }
});
