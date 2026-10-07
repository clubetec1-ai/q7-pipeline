/**
 * Dica de vocabulário para a transcrição (relato do dono, 07/10: nomes de cidades e palavras saindo errados). O serviço
 * de transcrição aceita um texto de contexto: vai o nome da empresa e os nomes próprios que já aparecem no que a empresa
 * escreveu (cidades, marcas, siglas como NR10). Regra pura e testada; só nomes, nada de frase inteira.
 */
const COMUNS = new Set(("A O As Os Um Uma De Da Do Das Dos E Em No Na Nos Nas Para Por Com Se Que Quando Como Qual Quais Mas " +
  "Hoje Normalmente Então Bom Sim Não Também Porém Caso Isso Essa Esse Já Ou Na Ele Ela Eles Elas Nós Você Vocês Agora Depois " +
  "Antes Sempre Nunca Cada Muito Pouco Pergunta Resposta Olá Obrigado Para Seria Bem Assim Ainda Mais Menos Só").split(" "));

export function sttHint(orgName: string, texts: string[], max = 40): string {
  const seen = new Map<string, number>();
  for (const t of texts) {
    for (const m of String(t ?? "").matchAll(/\b([A-ZÀ-Ú][\wÀ-ú]{2,}(?:\s(?:de|do|da|dos|das)?\s?[A-ZÀ-Ú][\wÀ-ú]+)?|[A-Z]{2,}\d*|NR\s?\d{1,2})\b/gu)) {
      const w = m[1].trim();
      if (COMUNS.has(w.split(" ")[0])) continue;
      seen.set(w, (seen.get(w) ?? 0) + 1);
    }
  }
  const nomes = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([w]) => w);
  return `Entrevista em português do Brasil com o dono da empresa ${orgName}.${nomes.length ? ` Nomes e termos que podem aparecer: ${nomes.join(", ")}.` : ""}`.slice(0, 800);
}
