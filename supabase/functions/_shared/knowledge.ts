/**
 * Base de conhecimento: extrai o texto dos documentos da empresa, tira o que é
 * sensível, divide em trechos e monta o contexto que os agentes recebem.
 * Busca: service_search_knowledge (full-text em português, sem custo de IA).
 */

const MAX_TEXT = 300_000;
const MAX_CHUNKS = 400;

const decodeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

async function unzip(bytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  const { unzipSync } = await import("npm:fflate@0.8.2");
  return unzipSync(bytes);
}

async function docxText(bytes: Uint8Array): Promise<string> {
  const files = await unzip(bytes);
  const xml = new TextDecoder().decode(files["word/document.xml"] ?? new Uint8Array());
  return decodeXml(xml.replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>/g, "\t").replace(/<[^>]+>/g, ""));
}

async function xlsxText(bytes: Uint8Array): Promise<string> {
  const files = await unzip(bytes);
  const td = new TextDecoder();
  const shared = [...td.decode(files["xl/sharedStrings.xml"] ?? new Uint8Array()).matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => decodeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  const sheets = Object.keys(files).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort();
  const out: string[] = [];
  for (const name of sheets) {
    const xml = td.decode(files[name]);
    out.push(`## Planilha ${name.match(/sheet(\d+)/)?.[1] ?? ""}`);
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [...row[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
        const attrs = c[1] ?? "", inner = c[2] ?? "";
        const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        if (/t="s"/.test(attrs) && v !== undefined) return shared[Number(v)] ?? "";
        if (/t="inlineStr"/.test(attrs)) return decodeXml((inner.match(/<t[^>]*>([\s\S]*?)<\/t>/) ?? [])[1] ?? "");
        return v !== undefined ? decodeXml(v) : "";
      });
      if (cells.some((x) => x.trim())) out.push(cells.join(" | "));
      if (out.length > 5000) break;
    }
  }
  return out.join("\n");
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { getDocumentProxy, extractText } = await import("npm:unpdf@1");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [String(text ?? "")]).join("\n\n");
}

/** Texto do arquivo (ou erro legível). */
export async function extractDocText(bytes: Uint8Array, fileName: string, mime: string): Promise<{ text?: string; error?: string }> {
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  try {
    let text = "";
    if (ext === "pdf" || /pdf/.test(mime)) text = await pdfText(bytes);
    else if (ext === "docx") text = await docxText(bytes);
    else if (ext === "xlsx") text = await xlsxText(bytes);
    else if (["txt", "md", "csv", "tsv"].includes(ext) || /^text\//.test(mime)) text = new TextDecoder().decode(bytes);
    else return { error: "Formato não suportado. Use PDF, Word (.docx), Excel (.xlsx), CSV ou texto." };
    text = text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) return { error: "Não encontrei texto no arquivo (PDF digitalizado ainda não é lido)." };
    return { text: text.slice(0, MAX_TEXT) };
  } catch {
    return { error: "Não consegui ler o arquivo. Confira se ele abre normalmente e tente de novo." };
  }
}

/** Tira segredos e números de cartão antes de entrar na base (a IA nunca vê). */
export function sanitize(text: string): string {
  return text
    .split("\n")
    .filter((l) => !/\b(senha|password|token|api[\s_-]?key|pin|cvv)\b\s*[:=]/i.test(l))
    .join("\n")
    .replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => (m.replace(/\D/g, "").length >= 13 ? "[removido]" : m));
}

/** Trechos de ~1200 caracteres, respeitando parágrafos. */
export function chunkText(text: string): string[] {
  const parts = text.split(/\n{2,}|\n(?=## )/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    const pieces = p.length > 1800 ? p.match(/[\s\S]{1,1200}(\s|$)/g) ?? [p.slice(0, 1200)] : [p];
    for (const piece of pieces) {
      if ((cur + "\n\n" + piece).length > 1200 && cur) { out.push(cur); cur = ""; }
      cur = cur ? `${cur}\n\n${piece.trim()}` : piece.trim();
      if (out.length >= MAX_CHUNKS) return out;
    }
  }
  if (cur && out.length < MAX_CHUNKS) out.push(cur);
  return out.map((c) => c.slice(0, 2400));
}

/**
 * Contexto para o prompt de um agente ("" se nada relevante).
 * scope "cliente" = só documentos de atendimento/enviáveis; "interno" = todos.
 */
// deno-lint-ignore no-explicit-any
export async function knowledgeContext(admin: any, orgId: string, query: string, scope: "cliente" | "interno", depts: string[] | null = null, max = 3000): Promise<string> {
  if (!query || query.trim().length < 3) return "";
  const { data } = await admin.rpc("service_search_knowledge", { org: orgId, q: query.slice(0, 500), scope, depts, lim: 5 });
  const rows = (data ?? []) as { title: string; content: string }[];
  if (!rows.length) return "";
  let out = "";
  for (const r of rows) {
    const piece = `### ${r.title}\n${r.content}\n\n`;
    if ((out + piece).length > max) break;
    out += piece;
  }
  return out ? `Documentos da empresa relevantes (use para responder; não invente além deles):\n${out.trim()}` : "";
}
