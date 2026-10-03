#!/usr/bin/env node
/**
 * Backup dos dados do banco (piloto, enquanto o Supabase é Free e não tem backup diário).
 *
 * Exporta todas as tabelas do schema public para JSON, um arquivo por tabela, numa
 * pasta FORA do repositório (padrão: %USERPROFILE%\Backups\deixa-com-a-ia\AAAA-MM-DD).
 * A estrutura do banco fica nas migrations (git); aqui vão só os dados.
 * Usa a CLI do Supabase já logada (`npx supabase db query --linked`); nenhuma senha
 * fica em arquivo. Guarda as últimas 8 cópias.
 *
 * ATENÇÃO: o backup tem dados pessoais (LGPD). Não envie a pasta para nuvem pública
 * nem para o git.
 *
 * Uso: node scripts/backup-dados.mjs [pasta-destino]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const REF = "ulmndwlralgjbwlebxmo";
const KEEP = 8;
const root = process.argv[2] ?? join(homedir(), "Backups", "deixa-com-a-ia");
const day = new Date().toISOString().slice(0, 10);
const dest = join(root, day);

const work = mkdtempSync(join(tmpdir(), "deixa-backup-"));
function query(sql) {
  // A consulta vai por arquivo: no Windows o shell quebraria o texto em vários argumentos.
  const file = join(work, "q.sql");
  writeFileSync(file, sql);
  const out = execFileSync("npx", ["supabase", "db", "query", "--linked", "--project-ref", REF, "-f", file], {
    encoding: "utf8", maxBuffer: 512 * 1024 * 1024, shell: process.platform === "win32", stdio: ["ignore", "pipe", "ignore"],
  });
  const start = out.indexOf("{");
  if (start < 0) throw new Error("resposta inesperada da CLI");
  const parsed = JSON.parse(out.slice(start, out.lastIndexOf("}") + 1));
  if (parsed.error) throw new Error(parsed.error.message ?? "erro na consulta");
  return parsed.rows ?? [];
}

const tables = query(
  "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1",
).map((r) => r.t);
if (!tables.length) throw new Error("nenhuma tabela encontrada");

mkdirSync(dest, { recursive: true });
let total = 0;
// Em lotes, para não estourar o tamanho de uma consulta.
for (let i = 0; i < tables.length; i += 10) {
  const batch = tables.slice(i, i + 10);
  const sql = batch
    .map((t) => `SELECT '${t}' AS t, coalesce(json_agg(x), '[]'::json) AS rows FROM public."${t.replace(/"/g, "")}" x`)
    .join(" UNION ALL ");
  for (const r of query(sql)) {
    const rows = Array.isArray(r.rows) ? r.rows : [];
    total += rows.length;
    writeFileSync(join(dest, `${r.t}.json`), JSON.stringify(rows));
  }
}
writeFileSync(join(dest, "_info.json"), JSON.stringify({ project: REF, created_at: new Date().toISOString(), tables: tables.length, rows: total }, null, 2));

// Mantém só as últimas cópias.
const old = readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().slice(0, -KEEP);
for (const d of old) rmSync(join(root, d), { recursive: true, force: true });

rmSync(work, { recursive: true, force: true });
console.log(`Backup ok: ${tables.length} tabelas, ${total} linhas em ${dest}`);
