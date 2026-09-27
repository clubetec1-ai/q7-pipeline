/**
 * Bloco HTTP do fluxo (spec fluxo §8) — chamada a sistemas externos com
 * guarda contra SSRF:
 *  - só https, porta 443, sem redirecionamento (3xx = erro);
 *  - DNS resolvido antes: QUALQUER IP privado/loopback/link-local/CGNAT/
 *    multicast/reservado (v4 ou v6, inclusive v4 mapeado) recusa a chamada;
 *  - 10 s de limite, resposta só JSON e até 256 KB;
 *  - variáveis entram no corpo como valores JSON (nunca concatenação) e na URL
 *    com encodeURIComponent; {{segredo.nome}} só aqui, só de http_secrets.
 * Risco residual documentado: DNS rebinding entre a checagem e a conexão.
 */

export const HTTP_TIMEOUT_MS = 10_000;
export const HTTP_MAX_BYTES = 256 * 1024;
const SECRET_RE = /\{\{segredo\.([a-z0-9_]{1,40})\}\}/g;

function v4(ip: string): number[] | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.every((n) => n <= 255) ? p : null;
}

function privateV4([a, b, c]: number[]): boolean {
  return a === 0 || a === 10 || a === 127 || a >= 224 ||           // própria rede, privada, loopback, multicast/reservado
    (a === 100 && b >= 64 && b <= 127) ||                           // CGNAT
    (a === 169 && b === 254) ||                                     // link-local (metadados de nuvem)
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||               // IETF / documentação
    (a === 198 && (b === 18 || b === 19)) ||                        // benchmark
    (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}

/** Expande um IPv6 em 8 grupos de 16 bits (aceita sufixo IPv4). */
function v6(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const tail = s.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (tail) {
    const p = v4(tail[1]);
    if (!p) return null;
    s = s.slice(0, -tail[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  if (!/^[0-9a-f:]+$/.test(s) || s.split("::").length > 2) return null;
  const [head, rest] = s.includes("::") ? s.split("::") : [s, null];
  const h = head ? head.split(":") : [];
  const r = rest ? rest.split(":") : [];
  const fill = rest === null ? [] : Array(8 - h.length - r.length).fill("0");
  const all = [...h, ...fill, ...r];
  if (all.length !== 8 || all.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return null;
  return all.map((x) => parseInt(x, 16));
}

/** IP que não pode ser destino (v4 ou v6). Entrada inválida = recusa. */
export function isBlockedIp(ip: string): boolean {
  const a = v4(ip);
  if (a) return privateV4(a);
  const g = v6(ip);
  if (!g) return true;
  const embedded = [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255];
  if (g.slice(0, 6).every((x) => x === 0)) return true;                                   // ::, ::1, ::a.b.c.d
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return privateV4(embedded);  // v4 mapeado
  if (g[0] === 0x64 && g[1] === 0xff9b) return privateV4(embedded);                        // NAT64
  return (g[0] & 0xfe00) === 0xfc00 ||   // fc00::/7 (ULA)
    (g[0] & 0xffc0) === 0xfe80 ||        // fe80::/10 (link-local)
    (g[0] & 0xff00) === 0xff00 ||        // multicast
    (g[0] === 0x2001 && g[1] === 0x0db8); // documentação
}

/** Valida URL (esquema, porta, nome) antes de resolver o DNS. Devolve o motivo da recusa. */
export function checkUrl(raw: string): { url?: URL; error?: string } {
  let url: URL;
  try { url = new URL(raw); } catch { return { error: "URL inválida" }; }
  if (url.protocol !== "https:") return { error: "só https" };
  if (url.port && url.port !== "443") return { error: "só a porta 443" };
  if (url.username || url.password) return { error: "URL com usuário/senha" };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || /\.(localhost|local|internal|lan|home|corp)$/.test(host)) {
    return { error: "endereço interno" };
  }
  if ((v4(host) || host.startsWith("[")) && isBlockedIp(host)) return { error: "endereço interno" };
  return { url };
}

async function resolveAll(host: string): Promise<string[]> {
  if (v4(host)) return [host];
  if (host.startsWith("[")) return [host.slice(1, -1)];
  const ips: string[] = [];
  for (const type of ["A", "AAAA"] as const) {
    try { ips.push(...await Deno.resolveDns(host, type)); } catch { /* sem registro deste tipo */ }
  }
  return ips;
}

// deno-lint-ignore no-explicit-any
type Json = any;
export interface HttpVars { vars: Record<string, string>; name: string; phone: string; protocol: string }

function render(tpl: string, v: HttpVars, secrets: Record<string, string>, enc: (s: string) => string): string {
  return String(tpl ?? "")
    .replace(SECRET_RE, (_, k) => enc(secrets[k] ?? ""))
    .replace(/\{var\.([a-z0-9_]{1,40})\}/gi, (_, k) => enc(v.vars[k] ?? ""))
    .split("{nome}").join(enc(v.name))
    .split("{telefone}").join(enc(v.phone))
    .split("{protocolo}").join(enc(v.protocol));
}

function renderJson(node: Json, v: HttpVars, secrets: Record<string, string>): Json {
  if (typeof node === "string") return render(node, v, secrets, (s) => s);
  if (Array.isArray(node)) return node.map((x) => renderJson(x, v, secrets));
  if (node && typeof node === "object") {
    return Object.fromEntries(Object.entries(node).map(([k, x]) => [k, renderJson(x, v, secrets)]));
  }
  return node;
}

/** Nomes de segredos usados pelo bloco (URL, cabeçalhos e corpo). */
export function secretNames(d: Record<string, Json>): string[] {
  const text = [d.url, d.body, ...((d.headers ?? []) as { value?: string }[]).map((h) => h?.value)].join("\n");
  return [...new Set([...text.matchAll(SECRET_RE)].map((m) => m[1]))].slice(0, 10);
}

/** Monta a requisição do bloco (sem rede). Exportado para teste. */
export function buildRequest(d: Record<string, Json>, v: HttpVars, secrets: Record<string, string>) {
  const method = ["GET", "POST", "PUT", "PATCH"].includes(d.method) ? d.method : "GET";
  const url = render(d.url, v, secrets, encodeURIComponent);
  const headers: Record<string, string> = { Accept: "application/json" };
  for (const h of ((d.headers ?? []) as { key?: string; value?: string }[]).slice(0, 20)) {
    const key = String(h?.key ?? "").trim();
    if (!/^[A-Za-z0-9-]{1,64}$/.test(key) || /^(host|content-length|connection|transfer-encoding)$/i.test(key)) continue;
    headers[key] = render(h?.value ?? "", v, secrets, (s) => s).replace(/[\r\n]/g, " ").slice(0, 2000);
  }
  let body: string | undefined;
  if (method !== "GET" && String(d.body ?? "").trim()) {
    body = JSON.stringify(renderJson(JSON.parse(d.body), v, secrets)); // lança se o modelo não é JSON
    headers["Content-Type"] = "application/json";
  }
  return { method, url, headers, body };
}

async function readCapped(res: Response): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > HTTP_MAX_BYTES) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.length; }
  return new TextDecoder().decode(all);
}

export interface HttpOutcome { ok: boolean; status?: number; ms: number; body?: Json; error?: string }

/** Executa a chamada com todas as proteções. Nunca lança. */
export async function callHttp(d: Record<string, Json>, v: HttpVars, secrets: Record<string, string>): Promise<HttpOutcome> {
  const t0 = Date.now();
  const fail = (error: string, status?: number): HttpOutcome => ({ ok: false, error, status, ms: Date.now() - t0 });
  try {
    const req = buildRequest(d, v, secrets);
    const { url, error } = checkUrl(req.url);
    if (!url) return fail(error ?? "URL recusada");
    const ips = await resolveAll(url.hostname.toLowerCase());
    if (!ips.length) return fail("domínio não encontrado");
    if (ips.some(isBlockedIp)) return fail("endereço interno");
    const res = await fetch(url, {
      method: req.method, headers: req.headers, body: req.body, redirect: "manual",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400) { await res.body?.cancel(); return fail("redirecionamento recusado", res.status); }
    if (!(res.headers.get("content-type") ?? "").includes("json")) { await res.body?.cancel(); return fail("resposta não é JSON", res.status); }
    const text = await readCapped(res);
    if (text === null) return fail("resposta maior que 256 KB", res.status);
    if (!res.ok) return fail(`HTTP ${res.status}`, res.status);
    return { ok: true, status: res.status, ms: Date.now() - t0, body: text ? JSON.parse(text) : null };
  } catch (e) {
    return fail(e instanceof Error ? e.name === "TimeoutError" ? "tempo esgotado" : e.message.slice(0, 200) : "falha");
  }
}
