/**
 * Leitura da RPI (Revista da Propriedade Industrial) — seção de Marcas, em XML.
 * O INPI publica toda terça um ZIP (~10 MB, ~60 MB de XML) com todos os despachos
 * da semana. Aqui: abre o ZIP, descompacta em fluxo (sem guardar o XML inteiro) e
 * separa só os processos que interessam — pelo número, pelo titular ou por uma marca
 * parecida com a nossa (para dar tempo de oposição).
 */

export interface RpiDispatch { codigo: string; nome: string; complemento?: string }
export interface RpiProcess {
  numero: string;
  marca?: string;
  apresentacao?: string;
  titulares: string[];
  despachos: RpiDispatch[];
  classes: { codigo: string; status?: string }[];
}
export interface RpiWatch { numbers: string[]; titulares: string[]; terms: string[] }
export interface RpiHit extends RpiProcess { motivo: "numero" | "titular" | "marca"; termo?: string }

/** Minúsculas, sem acento e só letras/números: "Deixa com a I.A." → "deixacomaia". */
export const normName = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const unesc = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();

/** Primeiro arquivo do ZIP (pelo diretório central, que traz o tamanho certo). */
export function zipFirstEntry(zip: Uint8Array): { method: number; data: Uint8Array } {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ZIP inválido (sem diretório central)");
  const cd = dv.getUint32(eocd + 16, true);
  if (dv.getUint32(cd, true) !== 0x02014b50) throw new Error("ZIP inválido (diretório central)");
  const method = dv.getUint16(cd + 10, true);
  const size = dv.getUint32(cd + 20, true);
  const local = dv.getUint32(cd + 42, true);
  if (dv.getUint32(local, true) !== 0x04034b50) throw new Error("ZIP inválido (cabeçalho local)");
  const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
  if (start + size > zip.length) throw new Error("ZIP incompleto");
  return { method, data: zip.subarray(start, start + size) };
}

export function parseProcess(block: string): RpiProcess {
  const attr = (tag: string, name: string) => {
    const m = tag.match(new RegExp(`${name}="([^"]*)"`));
    return m ? unesc(m[1]) : undefined;
  };
  const numero = block.match(/<processo numero="(\d+)"/)?.[1] ?? "";
  const marcaTag = block.match(/<marca\b[^>]*>/)?.[0];
  const marca = block.match(/<marca\b[^>]*>\s*<nome>([^<]*)<\/nome>/)?.[1];
  const despachos: RpiDispatch[] = [];
  for (const m of block.matchAll(/<despacho\b([^>]*?)(\/>|>([\s\S]*?)<\/despacho>)/g)) {
    const comp = m[3]?.match(/<texto-complementar>([\s\S]*?)<\/texto-complementar>/)?.[1];
    despachos.push({ codigo: attr(m[1], "codigo") ?? "", nome: attr(m[1], "nome") ?? "", ...(comp ? { complemento: unesc(comp).slice(0, 2000) } : {}) });
  }
  const titulares = [...block.matchAll(/<titular\b[^>]*nome-razao-social="([^"]*)"/g)].map((m) => unesc(m[1]));
  const classes = [...block.matchAll(/<classe-nice codigo="([^"]*)">([\s\S]*?)<\/classe-nice>/g)].map((m) => {
    const st = m[2].match(/<status>([^<]*)<\/status>/)?.[1];
    return { codigo: m[1], ...(st ? { status: unesc(st) } : {}) };
  });
  return {
    numero, titulares, despachos, classes,
    ...(marca ? { marca: unesc(marca) } : {}),
    ...(marcaTag && attr(marcaTag, "apresentacao") ? { apresentacao: attr(marcaTag, "apresentacao") } : {}),
  };
}

/** Procura num trecho de XML com processos completos. */
export function scanSegment(seg: string, w: { numbers: string[]; titular: RegExp | null; terms: string[] }, out: Map<string, RpiHit>) {
  const blockAt = (pos: number) => {
    const a = seg.lastIndexOf("<processo ", pos);
    const b = seg.indexOf("</processo>", pos);
    return a < 0 || b < 0 ? null : seg.slice(a, b + 11);
  };
  const add = (pos: number, motivo: RpiHit["motivo"], termo?: string) => {
    const block = blockAt(pos);
    if (!block) return;
    const p = parseProcess(block);
    if (!p.numero || out.has(p.numero)) return;
    out.set(p.numero, { ...p, motivo, ...(termo ? { termo } : {}) });
  };
  for (const n of w.numbers) {
    const needle = `<processo numero="${n}"`;
    for (let i = seg.indexOf(needle); i >= 0; i = seg.indexOf(needle, i + 1)) add(i + 1, "numero");
  }
  if (w.titular) {
    // Regex simples (rápida) e depois confere se o trecho está dentro do nome de um titular.
    w.titular.lastIndex = 0;
    for (const m of seg.matchAll(w.titular)) {
      const tag = seg.lastIndexOf("<", m.index!);
      if (seg.startsWith("<titular ", tag) && seg.indexOf(">", tag) > m.index!) add(m.index!, "titular");
    }
  }
  if (w.terms.length) {
    // Só normaliza os nomes que têm o começo de algum termo (economiza CPU).
    const pre = [...new Set(w.terms.map((t) => t.slice(0, 3)))];
    for (const m of seg.matchAll(/<nome>([^<]{2,200})<\/nome>/g)) {
      const low = m[1].toLowerCase();
      if (!pre.some((p) => low.includes(p))) continue;
      const n = normName(unesc(m[1]));
      const t = w.terms.find((x) => n.includes(x));
      if (t) add(m.index!, "marca", t);
    }
  }
}

/** Lê a revista inteira (ZIP) e devolve os processos encontrados. */
export async function scanRpiZip(zip: Uint8Array, watch: RpiWatch): Promise<{ numero: number | null; data: string | null; hits: RpiHit[] }> {
  const { method, data } = zipFirstEntry(zip);
  if (method !== 8 && method !== 0) throw new Error(`ZIP com compressão não suportada (${method})`);
  // Entrega o ZIP em pedaços de 256 KB: a saída também vem em pedaços e o XML (~60 MB)
  // nunca fica inteiro na memória (limite da Edge Function).
  let off = 0;
  const raw = new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(c) {
      if (off >= data.length) return c.close();
      c.enqueue(data.slice(off, off + 262144));
      off += 262144;
    },
  });
  const stream: ReadableStream<Uint8Array> = method === 8 ? raw.pipeThrough(new DecompressionStream("deflate-raw")) : raw;
  const dec = new TextDecoder("utf-8");
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tit = watch.titulares.map((t) => t.trim()).filter(Boolean);
  const w = {
    numbers: [...new Set(watch.numbers.filter((n) => /^\d{9}$/.test(n)))],
    titular: tit.length ? new RegExp(tit.map(esc).join("|"), "gi") : null,
    terms: [...new Set(watch.terms.map(normName).filter((t) => t.length >= 4))],
  };
  const out = new Map<string, RpiHit>();
  let carry = "";
  let header: string | null = null;
  for await (const chunk of stream) {
    let text = carry + dec.decode(chunk, { stream: true });
    if (header === null && text.length > 300) header = text.slice(0, 300);
    const end = text.lastIndexOf("</processo>");
    if (end < 0) { carry = text; continue; }
    const cut = end + 11;
    scanSegment(text.slice(0, cut), w, out);
    carry = text.slice(cut);
    text = "";
  }
  carry += dec.decode();
  if (carry.includes("</processo>")) scanSegment(carry, w, out);
  const h = (header ?? carry).match(/<revista numero="(\d+)" data="(\d{2})\/(\d{2})\/(\d{4})"/);
  return { numero: h ? Number(h[1]) : null, data: h ? `${h[4]}-${h[3]}-${h[2]}` : null, hits: [...out.values()] };
}

export type Nivel = "urgente" | "atencao" | "info" | "ok";
/** O que o despacho quer dizer e quanto tempo há para agir (prazo contado da publicação). */
export function inpiGuidance(nome: string): { nivel: Nivel; texto: string; dias?: number } {
  const n = nome.toLowerCase();
  if (/exig[eê]ncia formal/.test(n)) return { nivel: "urgente", dias: 5, texto: "Exigência formal: responder no e-Marcas em até 5 dias, senão o pedido é considerado inexistente." };
  if (/exig[eê]ncia/.test(n)) return { nivel: "urgente", dias: 60, texto: "Exigência do examinador: responder no e-Marcas em até 60 dias (ver o texto do despacho)." };
  if (/notifica[cç][aã]o de oposi[cç][aã]o/.test(n)) return { nivel: "urgente", dias: 60, texto: "Alguém apresentou oposição ao pedido. Há 60 dias para a manifestação (recomendado: agente de propriedade industrial)." };
  if (/publica[cç][aã]o de pedido|republica[cç][aã]o/.test(n)) return { nivel: "info", dias: 60, texto: "Pedido publicado. Terceiros têm 60 dias para oposição; não precisa fazer nada agora." };
  if (/^deferimento do pedido|deferimento parcial/.test(n)) return { nivel: "atencao", dias: 60, texto: "Pedido deferido! Pagar a taxa de concessão (1º decênio) em até 60 dias (ou nos 30 seguintes, com acréscimo)." };
  if (/concess[aã]o de registro/.test(n)) return { nivel: "ok", texto: "Registro concedido: a marca é da Clubetec por 10 anos (renovável)." };
  if (/indeferimento do pedido/.test(n)) return { nivel: "urgente", dias: 60, texto: "Pedido indeferido. Há 60 dias para recurso (recomendado: agente de propriedade industrial)." };
  if (/inexistente|arquivamento/.test(n)) return { nivel: "urgente", texto: "Pedido arquivado ou considerado inexistente: verificar o motivo no e-Marcas/pePI." };
  if (/sobrestamento/.test(n)) return { nivel: "info", texto: "Exame suspenso aguardando outro processo; não precisa fazer nada agora." };
  return { nivel: "info", texto: "Novo despacho no processo." };
}
