import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { requireModule } from "../_shared/modules.ts";
import { HttpError, permissionsIn, requireUser, resolveOrg } from "../_shared/auth.ts";
import { forOrg } from "../_shared/tenant.ts";
import { chunkText, extractDocText, sanitize } from "../_shared/knowledge.ts";
import { aiKindOf, extractWithAI } from "../_shared/knowledge-ai.ts";
import { fillTemplate } from "../_shared/fill-template.ts";

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
    await requireModule(admin, orgId, "ia");
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

    // Limpeza: apaga só arquivos DESTA empresa que não pertencem a nenhum documento da base
    // (ex.: documento apagado por fora da tela). Dono ou administrador; fica na auditoria.
    if (action === "purge_orphans") {
      await canManage(null);
      const bucket = admin.storage.from("knowledge");
      const { data: folders, error } = await bucket.list(orgId, { limit: 1000 });
      if (error) throw new HttpError(500, "Não consegui listar os arquivos");
      const { data: docs } = await org.select("knowledge_docs", "id");
      const known = new Set(((docs ?? []) as { id: string }[]).map((d) => d.id));
      const paths: string[] = [];
      for (const f of folders ?? []) {
        if (!/^[0-9a-f-]{36}$/i.test(f.name) || known.has(f.name)) continue;
        const { data: files } = await bucket.list(`${orgId}/${f.name}`, { limit: 100 });
        for (const x of files ?? []) paths.push(`${orgId}/${f.name}/${x.name}`);
      }
      if (paths.length) await bucket.remove(paths);
      // Kit da marca: arquivos desta empresa que nem o kit, nem o logo das telas, nem uma rede usam mais.
      const brandBucket = admin.storage.from("brand");
      const { data: bfiles } = await brandBucket.list(orgId, { limit: 1000 });
      const { data: prof } = await org.select("company_profiles", "brand").maybeSingle();
      const kit = (prof?.brand ?? {}) as { files?: { path?: string }[]; theme?: { logo?: string } };
      const used = new Set([...(kit.files ?? []).map((f) => String(f.path ?? "")), String(kit.theme?.logo ?? "")]);
      const candidates = (bfiles ?? []).filter((f) => f.id && !used.has(`${orgId}/${f.name}`)).map((f) => `${orgId}/${f.name}`);
      const { data: nets } = candidates.length
        ? await admin.from("networks").select("brand").in("brand->>logo", candidates)
        : { data: [] };
      const netUsed = new Set(((nets ?? []) as { brand: { logo?: string } }[]).map((n) => String(n.brand?.logo ?? "")));
      const brandPaths = candidates.filter((p) => !netUsed.has(p));
      if (brandPaths.length) await brandBucket.remove(brandPaths);
      await audit("knowledge.purge_orphans", orgId, { files: paths.length, brand_files: brandPaths.length });
      return json({ ok: true, removed: paths.length, brand_removed: brandPaths.length });
    }

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
      // O armazenamento recusa acentos no caminho ("Política.pdf"): o caminho vai sem acento; o nome exibido continua igual.
      const storageName = fileName.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._() -]/g, "_");
      const path = `${orgId}/${doc.id}/${storageName}`;
      const up = await admin.storage.from("knowledge").upload(path, bytes, { contentType: mime, upsert: false });
      if (up.error) {
        await org.delete("knowledge_docs").eq("id", doc.id);
        throw new HttpError(500, "Não foi possível guardar o arquivo");
      }
      let ex = await extractDocText(bytes, fileName, mime);
      // PDF digitalizado, foto de documento, áudio ou vídeo: a IA lê/transcreve (Etapa B, item 4).
      if (!ex.text && aiKindOf(fileName, mime)) ex = await extractWithAI(admin, orgId, bytes, fileName, mime);
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


    // ---- Etapa B, item 4 -------------------------------------------------------------------------------------------
    // Documentos "Pode ser enviado" que esta pessoa pode mandar no atendimento (empresa toda + setores dela).
    const sendableFilter = async () => {
      const perms = await permissionsIn(ctx, orgId);
      if (!perms.includes("conversations.attend")) throw new HttpError(403, "Sem permissão para atender");
      if (perms.includes("org.settings")) return null;
      const { data } = await ctx.userClient.from("department_members").select("department_id").eq("user_id", ctx.user.id);
      return (data ?? []).map((r: { department_id: string }) => r.department_id) as string[];
    };
    if (action === "sendables") {
      const depts = await sendableFilter();
      let q = org.select("knowledge_docs", "id, title, file_name, department_id, kind").eq("visibility", "enviavel").not("file_path", "is", null).order("title").limit(100);
      if (depts) q = depts.length ? q.or(`department_id.is.null,department_id.in.(${depts.join(",")})`) : q.is("department_id", null);
      const { data } = await q;
      return json({ ok: true, docs: data ?? [] });
    }
    if (action === "send_link") {
      const depts = await sendableFilter();
      const { data: d } = await org.select("knowledge_docs", "id, file_path, file_name, mime, visibility, department_id").eq("id", String(body?.doc_id ?? "")).maybeSingle();
      if (!d || d.visibility !== "enviavel" || !d.file_path?.startsWith(`${orgId}/`)) throw new HttpError(404, "Documento não disponível para envio");
      if (depts && d.department_id && !depts.includes(d.department_id)) throw new HttpError(403, "Documento de outro setor");
      const { data } = await admin.storage.from("knowledge").createSignedUrl(d.file_path, 120);
      await audit("knowledge.send_link", d.id);
      return json({ ok: true, url: data?.signedUrl ?? null, file_name: d.file_name, mime: d.mime });
    }
    // Anexo recebido no atendimento (ex.: e-mail) entra na base. Quem ve a conversa e cuida da base.
    if (action === "from_message") {
      const { data: m } = await ctx.userClient.from("messages").select("id, organization_id, media_path, media_name, media_mime")
        .eq("id", String(body?.message_id ?? "")).maybeSingle();
      if (!m || m.organization_id !== orgId || !m.media_path?.startsWith(`${orgId}/`)) throw new HttpError(404, "Anexo não encontrado");
      const dept = await deptOf(body?.department_id);
      await canManage(dept);
      const { data: blob, error: dl } = await admin.storage.from("media").download(m.media_path);
      if (dl || !blob) throw new HttpError(404, "Arquivo não encontrado");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_BYTES) throw new HttpError(413, "Arquivo vazio ou acima de 10 MB");
      const fileName = clip(m.media_name, 200).replace(/[^\w.\-() À-ú]/g, "_") || "anexo";
      const mime = clip(m.media_mime, 120) || "application/octet-stream";
      const { data: doc, error } = await org.insert("knowledge_docs", {
        department_id: dept, title: clip(body?.title, 160) || fileName, kind: KINDS.includes(body?.kind) ? body.kind : "outro",
        visibility: VIS.includes(body?.visibility) ? body.visibility : "interno", file_name: fileName, mime, size: bytes.length, created_by: ctx.user.id,
      }).select("id").single();
      if (error || !doc) throw new HttpError(400, "Não foi possível criar o documento");
      const storageName = fileName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._() -]/g, "_");
      const path = `${orgId}/${doc.id}/${storageName}`;
      const up = await admin.storage.from("knowledge").upload(path, bytes, { contentType: mime, upsert: false });
      if (up.error) { await org.delete("knowledge_docs").eq("id", doc.id); throw new HttpError(500, "Não foi possível guardar o arquivo"); }
      let ex = await extractDocText(bytes, fileName, mime);
      if (!ex.text && aiKindOf(fileName, mime)) ex = await extractWithAI(admin, orgId, bytes, fileName, mime);
      if (!ex.text) {
        await org.update("knowledge_docs", { file_path: path, status: "failed", error: ex.error, updated_at: new Date().toISOString() }).eq("id", doc.id);
        await audit("knowledge.from_message", doc.id, { ok: false });
        return json({ ok: true, id: doc.id, status: "failed", error: ex.error });
      }
      const chunks = chunkText(sanitize(ex.text));
      const { error: cErr } = await admin.from("knowledge_chunks").insert(chunks.map((content, ord) => ({ organization_id: orgId, doc_id: doc.id, ord, content })));
      await org.update("knowledge_docs", { file_path: path, status: cErr ? "failed" : "ready", error: cErr ? "Falha ao indexar" : null,
        chunks: cErr ? 0 : chunks.length, updated_at: new Date().toISOString() }).eq("id", doc.id);
      await audit("knowledge.from_message", doc.id, { ok: !cErr, chunks: chunks.length });
      return json({ ok: true, id: doc.id, status: cErr ? "failed" : "ready" });
    }
    // Contrato/orçamento preenchido com os dados do cliente da conversa (texto para conferir e enviar).
    if (action === "fill") {
      const depts = await sendableFilter();
      const { data: conv } = await ctx.userClient.from("conversations").select("id, organization_id, contact_id, contact_name, contact_phone, contact_email")
        .eq("id", String(body?.conversation_id ?? "")).maybeSingle();
      if (!conv || conv.organization_id !== orgId) throw new HttpError(404, "Conversa não encontrada");
      const { data: d } = await org.select("knowledge_docs", "id, title, kind, visibility, department_id").eq("id", String(body?.doc_id ?? "")).maybeSingle();
      if (!d || !["contrato", "orcamento"].includes(d.kind) || d.visibility === "interno") throw new HttpError(404, "Modelo não encontrado");
      if (depts && d.department_id && !depts.includes(d.department_id)) throw new HttpError(403, "Modelo de outro setor");
      const { data: parts } = await org.select("knowledge_chunks", "content").eq("doc_id", d.id).order("ord");
      const raw = (parts ?? []).map((p: { content: string }) => p.content).join("\n\n");
      const { data: ct } = conv.contact_id ? await org.select("contacts", "name, phone, email, document, custom").eq("id", conv.contact_id).maybeSingle() : { data: null };
      const { data: tk } = await org.select("tickets", "protocol").eq("conversation_id", conv.id).neq("status", "closed").maybeSingle();
      const { data: o } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle();
      const custom = (ct?.custom ?? {}) as Record<string, unknown>;
      const vars: Record<string, string> = {
        ...Object.fromEntries(Object.entries(custom).filter(([, v]) => typeof v === "string" || typeof v === "number").map(([k, v]) => [k, String(v)])),
        nome: ct?.name || conv.contact_name || "", telefone: ct?.phone || conv.contact_phone || "", email: ct?.email || conv.contact_email || "",
        cpf_cnpj: ct?.document || "", documento: ct?.document || "", protocolo: tk?.protocol || "", empresa: o?.name || "",
        data: new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
      };
      const r = fillTemplate(raw, vars);
      await audit("knowledge.fill", d.id, { faltando: r.faltando.length });
      return json({ ok: true, title: d.title, text: r.text.slice(0, 20_000), faltando: r.faltando });
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
