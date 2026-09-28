import { checkPublicHost, checkUrl } from "./flow/http.ts";

/**
 * Consultoria do entrevistador 2.0: busca em fontes abertas (site e CNPJ) com a
 * mesma proteção do bloco HTTP (só https, sem endereço interno, tempo e tamanho
 * limitados) e estimativa de custo mensal dos agentes de IA.
 */

const MAX_HTML = 500 * 1024;

/** Texto visível do site da empresa (até ~6 mil caracteres) ou erro. */
export async function fetchSiteText(raw: string): Promise<{ text?: string; url?: string; error?: string }> {
  let target = raw.trim();
  if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
  target = target.replace(/^http:\/\//i, "https://");
  for (let hop = 0; hop < 3; hop++) {
    const { url, error } = checkUrl(target);
    if (!url) return { error: error ?? "URL inválida" };
    const bad = await checkPublicHost(url.hostname);
    if (bad) return { error: bad };
    let res: Response;
    try {
      res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "ClubeCRM/1.0 (+levantamento)", Accept: "text/html" } });
    } catch { return { error: "site não respondeu" }; }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      target = new URL(res.headers.get("location")!, url).toString();
      continue;
    }
    if (!res.ok) return { error: `site respondeu ${res.status}` };
    if (!/text\/html|text\/plain/i.test(res.headers.get("content-type") ?? "")) return { error: "não é uma página" };
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      size += value.length;
      chunks.push(value);
      if (size > MAX_HTML) { await reader.cancel(); break; }
    }
    const all = new Uint8Array(Math.min(size, MAX_HTML));
    let off = 0;
    for (const c of chunks) {
      const part = c.subarray(0, all.length - off);
      all.set(part, off);
      off += part.length;
      if (off >= all.length) break;
    }
    const html = new TextDecoder().decode(all);
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
    const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1] ?? "";
    const text = html
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#?\w+;/g, " ")
      .replace(/\s+/g, " ").trim();
    return { url: url.toString(), text: [title, desc, text].filter(Boolean).join("\n").slice(0, 6000) };
  }
  return { error: "redirecionamentos demais" };
}

/** Dados públicos do CNPJ (BrasilAPI), sem sócios nem contatos pessoais. */
export async function lookupCnpj(raw: string): Promise<{ text?: string; error?: string }> {
  const cnpj = raw.replace(/\D/g, "");
  if (cnpj.length !== 14) return { error: "CNPJ precisa de 14 números" };
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { error: res.status === 404 ? "CNPJ não encontrado" : "consulta indisponível" };
    const d = await res.json();
    const lines = [
      `Razão social: ${d.razao_social ?? ""}`, `Nome fantasia: ${d.nome_fantasia ?? ""}`,
      `Atividade principal: ${d.cnae_fiscal_descricao ?? ""}`,
      `Outras atividades: ${(d.cnaes_secundarios ?? []).slice(0, 5).map((c: { descricao?: string }) => c.descricao).filter(Boolean).join("; ")}`,
      `Cidade: ${d.municipio ?? ""}/${d.uf ?? ""}`, `Início: ${d.data_inicio_atividade ?? ""}`,
      `Porte: ${d.porte ?? ""}`, `Situação: ${d.descricao_situacao_cadastral ?? ""}`,
    ];
    return { text: lines.join("\n") };
  } catch { return { error: "consulta indisponível" }; }
}

// Preço por milhão de tokens (US$). Estimativa: revisar quando os provedores mudarem.
export const PRICES: Record<string, { label: string; in: number; out: number }> = {
  groq: { label: "Groq (Llama 3.3 70b)", in: 0.59, out: 0.79 },
  haiku: { label: "Claude Haiku 4.5", in: 1, out: 5 },
  sonnet: { label: "Claude Sonnet 5", in: 2, out: 10 },
};
export const USD_BRL = 5.6;
// Tokens por resposta da IA (entrada inclui instruções + histórico).
const PER_REPLY = { simples: { in: 1500, out: 200 }, complexa: { in: 4000, out: 600 } };

export function monthlyCost(volume: number, complexity: "simples" | "complexa") {
  const v = Math.max(0, Math.min(1_000_000, Math.round(volume || 0)));
  const t = PER_REPLY[complexity];
  const brl = (p: { in: number; out: number }) =>
    Math.round(((v * t.in * p.in + v * t.out * p.out) / 1_000_000) * USD_BRL * 100) / 100;
  return {
    volume: v,
    groq: brl(PRICES.groq),
    claude: brl(complexity === "simples" ? PRICES.haiku : PRICES.sonnet),
    claude_model: complexity === "simples" ? PRICES.haiku.label : PRICES.sonnet.label,
  };
}
