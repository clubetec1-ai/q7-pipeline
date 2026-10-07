/**
 * Trava contra pergunta repetida na entrevista (Diagnóstico): a IA às vezes refaz uma pergunta já respondida
 * ("Você poderia me confirmar…"). Regra fixa: compara as palavras que importam da pergunta nova com as já feitas.
 */
const STOP = new Set(("a o as os um uma uns umas de da do das dos e em no na nos nas para por com sem que qual quais como " +
  "voce voces vcs me te se sua seu suas seus isso essa esse esta este ao aos pode poderia poderiam confirmar confirma " +
  "falar fale conte contar mais ja tambem sobre quando onde porque por que ou ate entre e sao eh e foi ser ter tem").split(" "));

export const words = (s: string) => new Set(String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));

/** Devolve a pergunta anterior que a nova repete (ou null). */
export function repeatedOf(q: string, previous: string[]): string | null {
  const a = words(q);
  if (a.size < 3) return null;
  for (const p of previous) {
    const b = words(p);
    if (!b.size) continue;
    let common = 0;
    for (const w of a) if (b.has(w)) common++;
    const jaccard = common / (a.size + b.size - common);
    const contained = common / Math.min(a.size, b.size);
    // Parecidas no todo, ou a nova não pergunta nada além do que uma anterior já perguntou (ex.: versão curta da mesma).
    if (jaccard >= 0.6 || common / a.size >= 0.75 || (contained >= 0.8 && Math.min(a.size, b.size) >= 4)) return p;
  }
  return null;
}

/** Texto longo da etapa: o começo (contexto) e o fim (o que foi dito por último) — o meio é o que menos falta. */
export function headTail(text: string, head = 2000, tail = 7000): string {
  const t = String(text ?? "");
  return t.length <= head + tail ? t : `${t.slice(0, head)}\n[…]\n${t.slice(-tail)}`;
}
