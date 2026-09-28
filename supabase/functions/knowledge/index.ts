import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { HttpError, permissionsIn, requireUser, resolveOrg } from "../_shared/auth.ts";
import { forOrg } from "../_shared/tenant.ts";
import { chunkText, extractDocText, sanitize } from "../_shared/knowledge.ts";

/**
 * Base de conhecimento (dono/admin na empresa toda; supervisor nos setores dele):
 *  upload (arquivo em base64 → bucket privado + trechos), update (título, setor,
 *  uso), delete (arquivo + trechos), search (testar uma pergunta), link (baixar).
 * A organização vem do login; o setor é conferido no banco (can_manage_knowledge).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const clip = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);
const KINDS = ["contrato", "orcamento", "planilha", "manual", "politica", "script", "preco", "outro"];
const VIS = ["interno", "atendimento", "enviavel"];
const MAX_BYTES = 10 * 1024 * 1024;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    const ctx = await requireUser(req);
    const orgId = await resolveOrg(ctx, body?.organization_id);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const org = forOrg(admin, orgId);
    const canManage = async (dept: string | null) => {
      const { data } = await ctx.userClient.rpc("can_manage_knowledge", { org: orgId, dept });
      if (data !== true) throw new HttpError(403, dept ? "Sem permissão neste setor" : "Só o dono ou administrador cuida dos documentos da empresa toda");
    };
    const deptOf = async (v: unknown) => {
      const id = v ? String(v) : null;
      if (!id) return null;
      const { data } = await org.select("departments", "id").eq("id", id).maybeSingle();
      if (!data) throw new HttpError(400, "Setor inválido");
      return id;
    };
    const audit = (a: string, target: string, meta: Record<string, unknown> = {}) =>
      admin.from("audit_log").insert({ organization_id: orgId, actor_id: ctx.user.id, action: a, target, meta });

    if (action === "upload") {
      const dept = await deptOf(body?.department_id);
      await canManage(dept);
      const fileName = clip(body?.file_name, 200).replace(/[^\w.\-() À-ú]/g, "_") || "documento";
      const b64 = String(body?.data ?? "");
      if (b64.length > Math.ceil(MAX_BYTES * 4 / 3) + 16) throw new HttpError(413, "Arquivo acima de 10 MB");
      let bytes: Uint8Array;
      try { bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch { throw new HttpError(400, "Arquivo inválido"); }
      if (!bytes.length || bytes.length > MAX_BYTES) throw new HttpError(413, "Arquivo vazio ou acima de 10 MB");
      const { count } = await admin.from("knowledge_docs").select("id", { count: "exact", head: true }).eq("organization_id", orgId);
      if ((count ?? 0) >= 300) throw new HttpError(422, "Limite de 300 documentos atingido. Apague os que não usa mais.");
      const mime = clip(body?.mime, 120) || "application/octet-stream";

      const { data: doc, error } = await org.insert("knowledge_docs", {
        department_id: dept, title: clip(body?.title, 160) || fileName, kind: KINDS.includes(body?.kind) ? body.kind : "outro",
        visibility: VIS.includes(body?.visibility) ? body.visibility : "interno", file_name: fileName, mime, size: bytes.length,
        created_by: ctx.user.id,
      }).select("id").single();
      if (error || !doc) throw new HttpError(400, "Não foi possível criar o documento");
      const path = `${orgId}/${doc.id}/${fileName}`;
      const up = await admin.storage.from("knowledge").upload(path, bytes, { contentType: mime, upsert: false });
      if (up.error) {
        await org.delete("knowledge_docs").eq("id", doc.id);
        throw new HttpError(500, "Não foi possível guardar o arquivo");
      }
      const ex = await extractDocText(bytes, fileName, mime);
      if (!ex.text) {
        await org.update("knowledge_docs", { file_path: path, status: "failed", error: ex.error, updated_at: new Date().toISOString() }).eq("id", doc.id);
        await audit("knowledge.upload", doc.id, { ok: false });
        return json({ ok: true, id: doc.id, status: "failed", error: ex.error });
      }
      const chunks = chunkText(sanitize(ex.text));
      const { error: cErr } = await admin.from("knowledge_chunks").insert(
        chunks.map((content, ord) => ({ organization_id: orgId, doc_id: doc.id, ord, content })));
      await org.update("knowledge_docs", {
        file_path: path, status: cErr ? "failed" : "ready", error: cErr ? "Falha ao indexar" : null, chunks: cErr ? 0 : chunks.length,
        updated_at: new Date().toISOString(),
      }).eq("id", doc.id);
      await audit("knowledge.upload", doc.id, { ok: !cErr, chunks: chunks.length });
      return json({ ok: true, id: doc.id, status: cErr ? "failed" : "ready", chunks: chunks.length });
    }

    const docId = String(body?.doc_id ?? "");
    const getDoc = async () => {
      const { data } = await org.select("knowledge_docs").eq("id", docId).maybeSingle();
      if (!data) throw new HttpError(404, "Documento não encontrado");
      return data;
    };

    if (action === "update") {
      const d = await getDoc();
      await canManage(d.department_id);
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body?.title !== undefined) patch.title = clip(body.title, 160) || d.title;
      if (VIS.includes(body?.visibility)) patch.visibility = body.visibility;
      if (KINDS.includes(body?.kind)) patch.kind = body.kind;
      if (body?.department_id !== undefined) {
        const dept = await deptOf(body.department_id);
        await canManage(dept);
        patch.department_id = dept;
      }
      await org.update("knowledge_docs", patch).eq("id", d.id);
      await audit("knowledge.update", d.id, { visibility: patch.visibility ?? d.visibility });
      return json({ ok: true });
    }

    if (action === "delete") {
      const d = await getDoc();
      await canManage(d.department_id);
      if (d.file_path?.startsWith(`${orgId}/`)) await admin.storage.from("knowledge").remove([d.file_path]);
      await org.delete("knowledge_docs").eq("id", d.id);
      await audit("knowledge.delete", d.id, { title: d.title });
      return json({ ok: true });
    }

    if (action === "link") {
      const d = await getDoc();
      await canManage(d.department_id);
      if (!d.file_path?.startsWith(`${orgId}/`)) throw new HttpError(404, "Arquivo indisponível");
      const { data } = await admin.storage.from("knowledge").createSignedUrl(d.file_path, 300);
      return json({ ok: true, url: data?.signedUrl ?? null });
    }

    if (action === "search") {
      const perms = await permissionsIn(ctx, orgId);
      if (!perms.includes("org.settings") && !perms.includes("library.manage")) throw new HttpError(403, "Sem permissão");
      let depts: string[] | null = null;
      if (!perms.includes("org.settings")) {
        const { data } = await ctx.userClient.from("department_members").select("department_id").eq("user_id", ctx.user.id);
        depts = (data ?? []).map((r: { department_id: string }) => r.department_id);
      }
      const scope = body?.scope === "cliente" ? "cliente" : "interno";
      const { data } = await admin.rpc("service_search_knowledge", { org: orgId, q: clip(body?.q, 500), scope, depts, lim: 5 });
      return json({ ok: true, results: data ?? [] });
    }
    throw new HttpError(400, "Ação inválida");
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    console.error("[knowledge]", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Erro inesperado" }, 500);
  }
});
