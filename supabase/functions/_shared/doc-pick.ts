/**
 * Escolhe o texto dos anexos que vai para a IA, dentro de um limite de caracteres.
 * - tira trechos repetidos (o mesmo arquivo anexado mais de uma vez);
 * - mantém a ordem dos documentos e das páginas;
 * - se não couber tudo, entra o começo de cada documento e depois os trechos que mais
 *   falam do assunto (palavras do foco), marcando "[...]" onde houve corte.
 */
export interface Chunk { doc_id: string; ord: number; content: string }

const STOP = new Set(("para pela pelo como mais quando onde qual quais voces vocês sobre essa esse isso esta este " +
  "seus suas nossa nosso tem tambem também muito cada fazer feito ainda entre depois antes porque desta deste " +
  "empresa etapa cliente clientes").split(" "));

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
// Compara pelo começo da palavra: "reclamação" e "reclamações" contam como a mesma.
const words = (s: string) => new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.slice(0, 6)));

export function pickDocText(chunks: Chunk[], docOrder: string[], focus: string, budget: number, names: Record<string, string> = {}): string {
  const seen = new Set<string>();
  const list = [...chunks]
    .sort((a, b) => (docOrder.indexOf(a.doc_id) - docOrder.indexOf(b.doc_id)) || a.ord - b.ord)
    .filter((c) => {
      const key = norm(c.content).replace(/\s+/g, " ").trim();
      if (key.length < 3 || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const total = list.reduce((t, c) => t + c.content.length, 0);
  let keep: Set<Chunk>;
  if (total <= budget) {
    keep = new Set(list);
  } else {
    keep = new Set();
    let used = 0;
    const add = (c: Chunk) => {
      if (keep.has(c) || used + c.content.length > budget) return;
      keep.add(c); used += c.content.length;
    };
    // Começo de cada documento (dá o contexto: título, sumário).
    const firsts = new Map<string, Chunk>();
    for (const c of list) if (!firsts.has(c.doc_id) && c.content.trim().length > 40) firsts.set(c.doc_id, c);
    for (const c of firsts.values()) add(c);
    // Depois, os trechos que mais falam do assunto.
    const f = words(focus);
    const score = (c: Chunk) => { let n = 0; for (const w of words(c.content)) if (f.has(w)) n++; return n; };
    list.map((c, i) => ({ c, i, s: score(c) })).sort((a, b) => b.s - a.s || a.i - b.i).forEach(({ c }) => add(c));
  }
  let out = "";
  let lastDoc = "";
  let lastIdx = -1;
  list.forEach((c, i) => {
    if (!keep.has(c)) return;
    if (c.doc_id !== lastDoc) { out += `${out ? "\n\n" : ""}=== Documento: ${names[c.doc_id] ?? "anexo"} ===\n`; lastDoc = c.doc_id; }
    else if (lastIdx !== i - 1) out += "\n[...]\n";
    else out += "\n";
    out += c.content.trim();
    lastIdx = i;
  });
  return out;
}
