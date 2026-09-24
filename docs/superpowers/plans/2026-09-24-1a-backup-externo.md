# 1A — Backup externo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backup diário do banco, dos segredos do Vault e do Storage do ClubeCRM para o Backblaze B2, cifrado e imutável, com teste de restauração mensal automático e runbook de desastre.

**Architecture:** Dois workflows do GitHub Actions (fora do Supabase) chamam scripts bash em `scripts/backup/`. O dump segue o procedimento oficial da Supabase (roles/schema/data), é empacotado e cifrado com `age` para dois destinatários (chave offline + chave de teste) e enviado ao B2 com `rclone`. Mídia vai por `rclone sync` para um remoto `crypt`. A restauração de teste sobe a stack local da Supabase no runner, restaura e compara a contagem de linhas.

**Tech Stack:** GitHub Actions (`ubuntu-24.04`), Supabase CLI 2.117.0, `age`, `rclone`, `psql` (postgresql-client), `jq`, Backblaze B2 (object lock), healthchecks.io.

**Spec:** `docs/superpowers/specs/2026-09-24-multi-tenant-equipes-design.md` §15 e §16.4 item 16, §16.5 itens 17–18.

## Global Constraints

- Projeto Supabase: ref `ulmndwlralgjbwlebxmo`, região `sa-east-1`, Postgres **17**.
- Repositório: `clubetec1-ai/q7-pipeline` (privado). Workflows agendados só rodam a partir da `main`.
- Buckets B2 (nomes exatos): `clubecrm-backup-daily` (lock 35 d), `clubecrm-backup-monthly` (lock 365 d), `clubecrm-backup-media` (lock 35 d). Modo **compliance**.
- Horário: diário às 06:00 UTC (03:00 Brasília); teste de restauração dia 2, 09:00 UTC.
- **Nenhum conteúdo em claro** (dump, segredos) é gravado no disco do runner fora de `mktemp -d` com `umask 077`; segredos do Vault só em pipe. Scripts nunca usam `set -x`.
- Nomes de arquivo no B2: `db/db-<AAAA-MM-DDTHHMMZ>.tar.gz.age`, `secrets/secrets-<AAAA-MM-DDTHHMMZ>.json.age`.
- Chave privada offline **nunca** entra no repositório nem no GitHub. A chave de teste fica só no segredo `AGE_TEST_KEY`.
- Tarefas marcadas **[USUÁRIO]** envolvem criar contas, gerar ou colar credenciais: o agente não executa, só orienta e espera confirmação.
- Mensagens de commit em português, no estilo do repositório, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `scripts/backup/recipients.txt` | chaves **públicas** age (offline + teste), uma por linha |
| `scripts/backup/rclone-env.sh` | exporta a configuração do rclone a partir de variáveis de ambiente (sem arquivo de config) |
| `scripts/backup/row-counts.sh` | imprime `schema.tabela<TAB>linhas` para as tabelas de `public`, `auth.users`, `storage.objects` |
| `scripts/backup/backup.sh` | dump + manifesto + cifragem + upload + mídia + pulso do monitor |
| `scripts/backup/restore-test.sh` | baixa o último backup, decifra, restaura na stack local, compara contagens |
| `scripts/backup/restore-secrets.sh` | recria os segredos do Vault num projeto novo a partir do JSON decifrado |
| `.github/workflows/backup.yml` | agenda e executa `backup.sh` |
| `.github/workflows/restore-test.yml` | agenda e executa `restore-test.sh` |
| `supabase/config.toml` | + `[db] major_version = 17` (a stack local precisa casar com o projeto) |
| `docs/runbook-desastre.md` | passo a passo de recuperação e de incidente de dados |
| `public/privacidade.html` | + Backblaze como suboperador |

---

### Task 0: Branch de trabalho

- [ ] **Step 1: Criar a branch a partir de `feat/multi-tenant`** (que contém os specs)

```bash
git checkout feat/multi-tenant
git checkout -b feat/backup-externo
```

Esta branch vira PR para a `main` ao final do plano — o agendamento só vale depois do merge.

---

### Task 1: Contas, chaves e segredos [USUÁRIO]

O agente apresenta este checklist ao usuário, **um bloco por vez**, e espera a confirmação de cada um. Nenhum valor de segredo deve ser colado no chat.

**1.1 Backblaze B2** — https://www.backblaze.com/sign-up/cloud-storage

- [ ] Criar a conta (com 2FA ligado em *My Settings*).
- [ ] *Buckets → Create a Bucket*, três vezes, cada um **Private** e com **Object Lock: Enable** (só dá para ligar na criação):
  - `clubecrm-backup-daily` → Default retention: **Compliance, 35 days**
  - `clubecrm-backup-monthly` → **Compliance, 365 days**
  - `clubecrm-backup-media` → **Compliance, 35 days**
- [ ] *Lifecycle Settings* de cada bucket → *Use custom lifecycle rules*, prefixo vazio:
  - daily: `daysFromUploadingToHiding = 36`, `daysFromHidingToDeleting = 1`
  - monthly: `daysFromUploadingToHiding = 366`, `daysFromHidingToDeleting = 1`
  - media: `daysFromUploadingToHiding` vazio, `daysFromHidingToDeleting = 365`
- [ ] *Application Keys → Add a New Application Key*, duas chaves com acesso a **todos os buckets**:
  - `clubecrm-backup-writer`: capabilities `listBuckets`, `listFiles`, `writeFiles` (**sem** `deleteFiles`, **sem** `readFiles`).
  - `clubecrm-backup-reader`: `listBuckets`, `listFiles`, `readFiles`.
  Anotar `keyID` e `applicationKey` de cada uma (a applicationKey só aparece uma vez).

**1.2 Chaves age** — no PowerShell do Windows:

```powershell
winget install FiloSottile.age
age-keygen -o "$HOME\Documents\clubecrm-backup-OFFLINE.txt"
age-keygen -o "$env:TEMP\clubecrm-backup-TESTE.txt"
```

- [ ] Cada comando imprime `Public key: age1...`. Passar **só as duas chaves públicas** ao agente (são públicas; podem ir no chat).
- [ ] Guardar `clubecrm-backup-OFFLINE.txt` num cofre de senhas **e** num pendrive guardado fora do escritório; depois apagar do computador. Sem esse arquivo, os backups não podem ser lidos numa emergência.
- [ ] O conteúdo de `clubecrm-backup-TESTE.txt` vai para o segredo `AGE_TEST_KEY` (1.5); depois apagar o arquivo.

**1.3 Supabase**

- [ ] *Project Settings → Database → Connection string → Session pooler* → copiar a URI (porta 5432) e trocar `[YOUR-PASSWORD]` pela senha do banco. Vai para `SUPABASE_DB_URL`.
- [ ] *Storage → Settings → S3 Connection*: ligar o protocolo S3; anotar **Endpoint** (`https://ulmndwlralgjbwlebxmo.supabase.co/storage/v1/s3`) e **Region** (`sa-east-1`); *New access key* → anotar Access key ID e Secret.

**1.4 Monitor** — https://healthchecks.io

- [ ] Criar conta, *Add Check* `clubecrm-backup`, **Period 1 day, Grace 2 hours**, notificação por e-mail. Copiar a *Ping URL*.

**1.5 GitHub** — https://github.com/clubetec1-ai/q7-pipeline/settings/secrets/actions

- [ ] Conferir 2FA em todas as contas com acesso ao repositório.
- [ ] Gerar duas senhas longas aleatórias para o `rclone crypt` (ex.: gerenciador de senhas, 40+ caracteres) e guardá-las também no cofre offline.
- [ ] Criar os *Repository secrets*:

| Nome | Valor |
|---|---|
| `SUPABASE_DB_URL` | 1.3 |
| `SUPA_S3_ENDPOINT` | 1.3 |
| `SUPA_S3_REGION` | `sa-east-1` |
| `SUPA_S3_KEY_ID` / `SUPA_S3_SECRET` | 1.3 |
| `B2_KEY_ID` / `B2_APP_KEY` | chave *writer* (1.1) |
| `B2_RO_KEY_ID` / `B2_RO_APP_KEY` | chave *reader* (1.1) |
| `RCLONE_CRYPT_PASSWORD` / `RCLONE_CRYPT_SALT` | as duas senhas geradas |
| `AGE_TEST_KEY` | conteúdo completo de `clubecrm-backup-TESTE.txt` |
| `HC_PING_URL` | 1.4 |

- [ ] **Step final:** usuário confirma "segredos criados". Agente não prossegue para a Task 3 sem essa confirmação.

---

### Task 2: Scripts auxiliares (destinatários, rclone, contagem)

**Files:**
- Create: `scripts/backup/recipients.txt`
- Create: `scripts/backup/rclone-env.sh`
- Create: `scripts/backup/row-counts.sh`
- Modify: `supabase/config.toml`

**Interfaces:**
- Produces: `source scripts/backup/rclone-env.sh` define os remotos `b2:` (usa `B2_KEY_ID`/`B2_APP_KEY`), `supa:` (S3 da Supabase, opcional) e `media:` (crypt sobre `b2:clubecrm-backup-media`, opcional).
- Produces: `scripts/backup/row-counts.sh <DB_URL>` → stdout `schema.tabela\tN`, ordenado.

- [ ] **Step 1: `recipients.txt`** com as duas chaves públicas recebidas na Task 1.2:

```
# Chaves PUBLICAS do age. Linha 1: chave offline (cofre). Linha 2: chave do teste de restauracao.
age1<CHAVE_PUBLICA_OFFLINE_FORNECIDA_PELO_USUARIO>
age1<CHAVE_PUBLICA_TESTE_FORNECIDA_PELO_USUARIO>
```

(O agente substitui pelos valores reais que o usuário informar. Não commitar enquanto houver `<...>` no arquivo.)

- [ ] **Step 2: `rclone-env.sh`**

```bash
#!/usr/bin/env bash
# Configura os remotos do rclone por variaveis de ambiente, sem arquivo de
# configuracao em disco. Uso: source scripts/backup/rclone-env.sh
# Spec: docs/superpowers/specs/2026-09-24-multi-tenant-equipes-design.md §15

: "${B2_KEY_ID:?B2_KEY_ID nao definido}" "${B2_APP_KEY:?B2_APP_KEY nao definido}"

export RCLONE_CONFIG_B2_TYPE=b2
export RCLONE_CONFIG_B2_ACCOUNT="$B2_KEY_ID"
export RCLONE_CONFIG_B2_KEY="$B2_APP_KEY"
# No B2, "apagar" oculta a versao; o object lock impede a remocao real.
export RCLONE_CONFIG_B2_HARD_DELETE=false

if [ -n "${SUPA_S3_KEY_ID:-}" ]; then
  export RCLONE_CONFIG_SUPA_TYPE=s3
  export RCLONE_CONFIG_SUPA_PROVIDER=Other
  export RCLONE_CONFIG_SUPA_ENDPOINT="${SUPA_S3_ENDPOINT:?}"
  export RCLONE_CONFIG_SUPA_REGION="${SUPA_S3_REGION:?}"
  export RCLONE_CONFIG_SUPA_ACCESS_KEY_ID="$SUPA_S3_KEY_ID"
  export RCLONE_CONFIG_SUPA_SECRET_ACCESS_KEY="${SUPA_S3_SECRET:?}"
  export RCLONE_CONFIG_SUPA_FORCE_PATH_STYLE=true
fi

if [ -n "${RCLONE_CRYPT_PASSWORD:-}" ]; then
  export RCLONE_CONFIG_MEDIA_TYPE=crypt
  export RCLONE_CONFIG_MEDIA_REMOTE="b2:${MEDIA_BUCKET:-clubecrm-backup-media}"
  RCLONE_CONFIG_MEDIA_PASSWORD="$(rclone obscure "$RCLONE_CRYPT_PASSWORD")"
  RCLONE_CONFIG_MEDIA_PASSWORD2="$(rclone obscure "${RCLONE_CRYPT_SALT:?}")"
  export RCLONE_CONFIG_MEDIA_PASSWORD RCLONE_CONFIG_MEDIA_PASSWORD2
fi
```

- [ ] **Step 3: `row-counts.sh`**

```bash
#!/usr/bin/env bash
# Imprime "schema.tabela<TAB>linhas" de cada tabela de public, mais auth.users e
# storage.objects. Usado no manifesto do backup e na conferencia da restauracao.
set -euo pipefail
DB_URL="${1:?uso: row-counts.sh <DB_URL>}"

psql "$DB_URL" -X -At -v ON_ERROR_STOP=1 <<'SQL' | sort
SELECT format('SELECT %L || E''\t'' || count(*) FROM %I.%I', table_schema || '.' || table_name, table_schema, table_name)
FROM information_schema.tables
WHERE table_type = 'BASE TABLE'
  AND (table_schema = 'public'
       OR (table_schema, table_name) IN (('auth', 'users'), ('storage', 'objects')))
ORDER BY 1
\gexec
SQL
```

- [ ] **Step 4: Testar `row-counts.sh` contra o projeto real**

O usuário roda no Git Bash, com a URI da Task 1.3 (a senha fica só no terminal dele; precisa do `psql` — `winget install PostgreSQL.PostgreSQL.17` instala o cliente):

```bash
bash scripts/backup/row-counts.sh "<URI_DO_SESSION_POOLER_DA_TASK_1.3>"
```

Expected: linhas como `auth.users\t1`, `public.conversations\t<n>`, `public.messages\t<n>` — 9 tabelas de `public` + as 2 extras, sem erro. Conferir `public.messages` contra `SELECT count(*) FROM public.messages` via MCP `execute_sql`.

- [ ] **Step 5: Fixar a versão do Postgres local** — em `supabase/config.toml`, após o bloco de comentário inicial e `project_id`:

```toml
[db]
# Tem que casar com o projeto (Postgres 17), senao a restauracao de teste falha.
major_version = 17
```

- [ ] **Step 6: Lint**

Run: `shellcheck scripts/backup/rclone-env.sh scripts/backup/row-counts.sh` (no runner; localmente, se o shellcheck não existir, pular — o workflow roda na Task 3).
Expected: sem avisos.

- [ ] **Step 7: Commit**

```bash
git add scripts/backup/recipients.txt scripts/backup/rclone-env.sh scripts/backup/row-counts.sh supabase/config.toml
git commit -m "Scripts auxiliares do backup externo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Backup diário

**Files:**
- Create: `scripts/backup/backup.sh`
- Create: `.github/workflows/backup.yml`

**Interfaces:**
- Consumes: `scripts/backup/rclone-env.sh`, `scripts/backup/row-counts.sh`, `scripts/backup/recipients.txt` (Task 2).
- Produces: no B2, `clubecrm-backup-daily/db/db-<STAMP>.tar.gz.age` (tar com `db/roles.sql`, `db/schema.sql`, `db/data.sql`, `db/manifest.tsv`) e `clubecrm-backup-daily/secrets/secrets-<STAMP>.json.age` (JSON `[{name, description, secret}]`); no dia 1, cópias em `clubecrm-backup-monthly/` nos mesmos caminhos; espelho cifrado do Storage em `clubecrm-backup-media`.

- [ ] **Step 1: `backup.sh`**

```bash
#!/usr/bin/env bash
# Backup diario do ClubeCRM para o Backblaze B2: banco, segredos do Vault e
# Storage. Tudo cifrado antes de sair do runner.
# Spec: docs/superpowers/specs/2026-09-24-multi-tenant-equipes-design.md §15
set -euo pipefail
umask 077

: "${SUPABASE_DB_URL:?}" "${RCLONE_CRYPT_PASSWORD:?}" "${SUPA_S3_KEY_ID:?}"
DAILY_BUCKET="${DAILY_BUCKET:-clubecrm-backup-daily}"
MONTHLY_BUCKET="${MONTHLY_BUCKET:-clubecrm-backup-monthly}"
HC_PING_URL="${HC_PING_URL:-}"

DIR="$(cd "$(dirname "$0")" && pwd)"
RECIPIENTS="$DIR/recipients.txt"
STAMP="$(date -u +%Y-%m-%dT%H%MZ)"
WORK="$(mktemp -d)"

ping_hc() {
  [ -n "$HC_PING_URL" ] || return 0
  curl -fsS -m 10 --retry 3 "${HC_PING_URL}$1" >/dev/null || true
}
trap 'rm -rf "$WORK"' EXIT
trap 'ping_hc /fail' ERR

if grep -q '<' "$RECIPIENTS"; then
  echo "recipients.txt ainda tem placeholder" >&2
  exit 1
fi

# shellcheck source=scripts/backup/rclone-env.sh
source "$DIR/rclone-env.sh"
ping_hc /start

echo "== 1/4 banco"
mkdir "$WORK/db"
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$WORK/db/roles.sql" --role-only
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$WORK/db/schema.sql"
supabase db dump --db-url "$SUPABASE_DB_URL" -f "$WORK/db/data.sql" --use-copy --data-only \
  -x "storage.buckets_vectors" -x "storage.vector_indexes" -x "vault.secrets"
"$DIR/row-counts.sh" "$SUPABASE_DB_URL" > "$WORK/db/manifest.tsv"
tar -C "$WORK" -czf - db | age -R "$RECIPIENTS" -o "$WORK/db-$STAMP.tar.gz.age"
rm -rf "$WORK/db"

echo "== 2/4 segredos do Vault (em claro so no pipe)"
psql "$SUPABASE_DB_URL" -X -At -v ON_ERROR_STOP=1 -c \
  "SELECT coalesce(json_agg(json_build_object('name', name, 'description', description, 'secret', decrypted_secret) ORDER BY name), '[]'::json) FROM vault.decrypted_secrets" \
  | age -R "$RECIPIENTS" -o "$WORK/secrets-$STAMP.json.age"

echo "== 3/4 envio"
rclone copyto "$WORK/db-$STAMP.tar.gz.age" "b2:$DAILY_BUCKET/db/db-$STAMP.tar.gz.age"
rclone copyto "$WORK/secrets-$STAMP.json.age" "b2:$DAILY_BUCKET/secrets/secrets-$STAMP.json.age"
if [ "$(date -u +%d)" = "01" ]; then
  rclone copyto "$WORK/db-$STAMP.tar.gz.age" "b2:$MONTHLY_BUCKET/db/db-$STAMP.tar.gz.age"
  rclone copyto "$WORK/secrets-$STAMP.json.age" "b2:$MONTHLY_BUCKET/secrets/secrets-$STAMP.json.age"
fi

echo "== 4/4 Storage (espelho cifrado)"
rclone sync supa: media: --fast-list --transfers 8

ping_hc ""
echo "backup $STAMP concluido"
```

- [ ] **Step 2: `backup.yml`**

```yaml
name: Backup diario

on:
  schedule:
    - cron: "0 6 * * *"   # 03:00 em Brasilia
  workflow_dispatch:

concurrency:
  group: backup
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  backup:
    runs-on: ubuntu-24.04
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4

      - uses: supabase/setup-cli@v1
        with:
          version: 2.117.0

      - name: Ferramentas
        run: |
          sudo apt-get update -qq
          sudo apt-get install -y -qq age rclone postgresql-client

      - name: Lint dos scripts
        run: shellcheck -x scripts/backup/*.sh

      - name: Backup
        run: bash scripts/backup/backup.sh
        env:
          SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}
          SUPA_S3_ENDPOINT: ${{ secrets.SUPA_S3_ENDPOINT }}
          SUPA_S3_REGION: ${{ secrets.SUPA_S3_REGION }}
          SUPA_S3_KEY_ID: ${{ secrets.SUPA_S3_KEY_ID }}
          SUPA_S3_SECRET: ${{ secrets.SUPA_S3_SECRET }}
          B2_KEY_ID: ${{ secrets.B2_KEY_ID }}
          B2_APP_KEY: ${{ secrets.B2_APP_KEY }}
          RCLONE_CRYPT_PASSWORD: ${{ secrets.RCLONE_CRYPT_PASSWORD }}
          RCLONE_CRYPT_SALT: ${{ secrets.RCLONE_CRYPT_SALT }}
          HC_PING_URL: ${{ secrets.HC_PING_URL }}
```

- [ ] **Step 3: Commit e push da branch**

```bash
git add scripts/backup/backup.sh .github/workflows/backup.yml
git commit -m "Backup diario cifrado para o Backblaze B2

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/backup-externo
```

- [ ] **Step 4: Primeira execução (gatilho temporário na branch)**

O botão *Run workflow* só existe para workflows que já estão na `main`. Para testar antes do merge, acrescentar **temporariamente** em `backup.yml`, dentro de `on:`:

```yaml
  push:
    branches: [feat/backup-externo]   # TEMPORARIO: remover na Task 6 antes do PR
```

Commit + push; o workflow roda sozinho. Acompanhar em *Actions* (o usuário abre a aba e informa o resultado, ou cola o link do run).

Expected:
- Job verde; log com `== 1/4` a `== 4/4` e `backup <STAMP> concluido`; nenhum segredo no log (o GitHub mascara, e o script não imprime valores).
- No B2 (*Browse Files*): `clubecrm-backup-daily/db/db-<STAMP>.tar.gz.age` e `secrets/secrets-<STAMP>.json.age`; `clubecrm-backup-media` com nomes cifrados (se já houver arquivos no Storage).
- healthchecks.io: check `clubecrm-backup` verde, com ping recente.

- [ ] **Step 5: Conferir a imutabilidade [USUÁRIO]**

No B2 web, tentar *Delete* do arquivo `db-<STAMP>.tar.gz.age`.
Expected: recusado por object lock (a interface mostra que o arquivo está retido até a data de retenção).

- [ ] **Step 6: Conferir que a chave offline abre o backup [USUÁRIO]**

Baixar `db-<STAMP>.tar.gz.age` pela web do B2 e, no PowerShell:

```powershell
age -d -i <caminho-da-chave-OFFLINE> db-<STAMP>.tar.gz.age > teste.tar.gz
tar -tzf teste.tar.gz
Remove-Item teste.tar.gz, db-<STAMP>.tar.gz.age
```

Expected: lista `db/roles.sql`, `db/schema.sql`, `db/data.sql`, `db/manifest.tsv`.

---

### Task 4: Teste de restauração mensal

**Files:**
- Create: `scripts/backup/restore-test.sh`
- Create: `.github/workflows/restore-test.yml`

**Interfaces:**
- Consumes: `rclone-env.sh`, `row-counts.sh` (Task 2); arquivos no B2 (Task 3). Variáveis: `B2_KEY_ID`/`B2_APP_KEY` recebem a chave **reader**; `AGE_TEST_KEY`.
- Produces: saída 0 se o último backup tem menos de 26 h, decifra, restaura e as contagens batem; saída ≠ 0 caso contrário.

- [ ] **Step 1: `restore-test.sh`**

```bash
#!/usr/bin/env bash
# Teste de restauracao: baixa o backup mais recente, decifra com a chave de
# teste, restaura na stack local da Supabase e compara a contagem de linhas
# com o manifesto gravado no dia do backup.
# Spec: docs/superpowers/specs/2026-09-24-multi-tenant-equipes-design.md §15.6
set -euo pipefail
umask 077

: "${AGE_TEST_KEY:?}"
DAILY_BUCKET="${DAILY_BUCKET:-clubecrm-backup-daily}"
LOCAL_DB="${LOCAL_DB:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-26}"

DIR="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# shellcheck source=scripts/backup/rclone-env.sh
source "$DIR/rclone-env.sh"
printf '%s\n' "$AGE_TEST_KEY" > "$WORK/key.txt"

echo "== 1/5 backup mais recente"
LATEST="$(rclone lsf "b2:$DAILY_BUCKET/db/" | grep '^db-.*\.tar\.gz\.age$' | sort | tail -n 1)"
[ -n "$LATEST" ] || { echo "nenhum backup encontrado" >&2; exit 1; }
STAMP="${LATEST#db-}"; STAMP="${STAMP%.tar.gz.age}"          # 2026-09-25T0600Z
ISO="${STAMP:0:13}:${STAMP:13:2}:00Z"                        # 2026-09-25T06:00:00Z
AGE_H=$(( ( $(date -u +%s) - $(date -u -d "$ISO" +%s) ) / 3600 ))
echo "ultimo backup: $LATEST (${AGE_H}h atras)"
if [ "$AGE_H" -gt "$MAX_AGE_HOURS" ]; then
  echo "backup mais recente tem ${AGE_H}h (> ${MAX_AGE_HOURS}h)" >&2
  exit 1
fi

echo "== 2/5 download e decifragem"
rclone copyto "b2:$DAILY_BUCKET/db/$LATEST" "$WORK/$LATEST"
age -d -i "$WORK/key.txt" "$WORK/$LATEST" | tar -C "$WORK" -xzf -
rclone copyto "b2:$DAILY_BUCKET/secrets/secrets-$STAMP.json.age" "$WORK/secrets.age"
age -d -i "$WORK/key.txt" "$WORK/secrets.age" | jq -e 'type == "array"' > /dev/null
echo "segredos: arquivo decifrado e valido (conteudo nao exibido)"

echo "== 3/5 restauracao"
# Os papeis padrao ja existem na stack local; conflitos aqui sao esperados.
psql "$LOCAL_DB" -X -q -f "$WORK/db/roles.sql" > /dev/null 2>&1 || echo "aviso: roles.sql com conflitos (esperado na stack local)"
psql "$LOCAL_DB" -X -q \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "$WORK/db/schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$WORK/db/data.sql"

echo "== 4/5 contagem de linhas"
"$DIR/row-counts.sh" "$LOCAL_DB" > "$WORK/restored.tsv"
if ! diff "$WORK/db/manifest.tsv" "$WORK/restored.tsv"; then
  echo "contagens divergem entre o backup e a restauracao" >&2
  exit 1
fi

echo "== 5/5 testes de isolamento"
if [ -f supabase/tests/isolation.sql ]; then
  psql "$LOCAL_DB" -X -v ON_ERROR_STOP=1 -f supabase/tests/isolation.sql
else
  echo "supabase/tests/isolation.sql ainda nao existe (plano 1B); pulando"
fi

echo "restauracao de $LATEST OK"
```

- [ ] **Step 2: `restore-test.yml`**

```yaml
name: Teste de restauracao

on:
  schedule:
    - cron: "0 9 2 * *"   # dia 2 de cada mes
  workflow_dispatch:

permissions:
  contents: read

jobs:
  restore:
    runs-on: ubuntu-24.04
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4

      - uses: supabase/setup-cli@v1
        with:
          version: 2.117.0

      - name: Ferramentas
        run: |
          sudo apt-get update -qq
          sudo apt-get install -y -qq age rclone postgresql-client jq

      - name: Stack local vazia (sem as migrations do repositorio)
        run: |
          mv supabase/migrations "$RUNNER_TEMP/migrations"
          supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,realtime,postgres-meta,mailpit

      - name: Restaurar e conferir
        run: MAX_AGE_HOURS=${{ github.event_name == 'schedule' && '26' || '48' }} bash scripts/backup/restore-test.sh
        env:
          B2_KEY_ID: ${{ secrets.B2_RO_KEY_ID }}
          B2_APP_KEY: ${{ secrets.B2_RO_APP_KEY }}
          AGE_TEST_KEY: ${{ secrets.AGE_TEST_KEY }}
```

- [ ] **Step 3: Commit e push**

```bash
git add scripts/backup/restore-test.sh .github/workflows/restore-test.yml
git commit -m "Teste de restauracao mensal do backup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

- [ ] **Step 4: Primeira execução (gatilho temporário na branch)** — acrescentar em `restore-test.yml`, dentro de `on:`, o mesmo bloco `push: branches: [feat/backup-externo]` com o comentário `# TEMPORARIO`, commit + push, e acompanhar em *Actions*. Como o evento não é `schedule`, o limite de idade do backup fica em 48 h.

Expected: job verde; log termina com `restauracao de db-<STAMP>.tar.gz.age OK`; o `diff` não imprime nada.

Se falhar no Step 3 do script (`schema.sql`) por objeto já existente na stack local (ex.: extensão ou schema criado pelos serviços), anotar o objeto do erro e acrescentar, antes do `psql` estrito, um `DROP ... IF EXISTS` **somente** para esse objeto na stack local descartável, com comentário explicando o motivo; re-executar até verde. Se falhar no `diff`, comparar as linhas divergentes: `auth.users` divergente indica que o dump de dados não inclui o schema `auth` — nesse caso, acrescentar ao `backup.sh` um dump explícito com `pg_dump --data-only --schema=auth` e restaurá-lo após `data.sql`, e repetir Tasks 3–4.

- [ ] **Step 5: Teste negativo do alerta**

Rodar o workflow com um segredo quebrado de propósito não é seguro para os demais; em vez disso, verificar o caminho de falha localmente lendo o script: `set -euo pipefail` + `exit 1` explícitos nos três pontos de divergência (sem backup, backup velho, contagem). O GitHub envia e-mail de falha de workflow ao dono do repositório por padrão — o usuário confirma em *Settings → Notifications → Actions* que "Send notifications for failed workflows only" está marcado.

---

### Task 5: Restauração dos segredos e runbook

**Files:**
- Create: `scripts/backup/restore-secrets.sh`
- Create: `docs/runbook-desastre.md`

**Interfaces:**
- Consumes: formato `[{name, description, secret}]` gerado pela Task 3.
- Produces: `age -d -i <chave> secrets.json.age | scripts/backup/restore-secrets.sh <DB_URL_NOVO>` recria cada segredo no Vault do projeto novo com o mesmo **nome** (referências são por nome — spec §6.3).

- [ ] **Step 1: `restore-secrets.sh`**

```bash
#!/usr/bin/env bash
# Recria os segredos do Vault num projeto novo. Le o JSON decifrado da entrada
# padrao (nunca de arquivo) e usa vault.create_secret, preservando os nomes.
# Uso: age -d -i CHAVE secrets-<STAMP>.json.age | restore-secrets.sh <DB_URL>
set -euo pipefail
DB_URL="${1:?uso: restore-secrets.sh <DB_URL>}"
JSON="$(cat)"
echo "$JSON" | jq -e 'type == "array"' > /dev/null

psql "$DB_URL" -X -At -v ON_ERROR_STOP=1 -v j="$JSON" <<'SQL'
SELECT count(vault.create_secret(x->>'secret', x->>'name', coalesce(x->>'description', '')))
FROM json_array_elements(:'j'::json) AS x
WHERE NOT EXISTS (SELECT 1 FROM vault.secrets s WHERE s.name = x->>'name');
SQL
```

A saída é só o número de segredos criados. Segredos com nome já existente são mantidos (reexecução segura).

- [ ] **Step 2: Testar `restore-secrets.sh` sem tocar em produção**

Na stack local descartável do runner não há como rodar sem Docker localmente; testar com o projeto de **homologação** quando existir (plano 1B, Task de homologação). Até lá, validar a sintaxe:

Run: `shellcheck scripts/backup/restore-secrets.sh` (pelo workflow de backup, que roda `shellcheck -x scripts/backup/*.sh`).
Expected: sem avisos.

- [ ] **Step 3: `docs/runbook-desastre.md`**

```markdown
# Runbook de desastre — ClubeCRM

Metas: **RTO 4 h** (sistema de volta), **RPO 24 h** (perda máxima de dados).
Spec: `docs/superpowers/specs/2026-09-24-multi-tenant-equipes-design.md` §15.

## O que você precisa em mãos

- Chave offline do age (`clubecrm-backup-OFFLINE.txt`, no cofre/pendrive).
- Senhas do `rclone crypt` (cofre).
- Acesso ao Backblaze B2, Supabase, Vercel, GitHub, Meta (developers.facebook.com) e ao painel da Uazapi.
- Computador com `age`, `rclone`, `psql`, `jq` e a Supabase CLI (`npm i -g supabase`).

## Cenário A — Supabase fora do ar (incidente da plataforma)

1. Conferir https://status.supabase.com. Se a previsão de volta for menor que 2 h, **aguardar** e avisar os clientes.
2. Se for maior, seguir o Cenário B a partir do passo 2, sem trocar credenciais.

## Cenário B — conta comprometida ou projeto perdido

1. **Conter:** trocar a senha e revogar sessões/tokens de Supabase, GitHub, Vercel, Meta, B2; revogar as chaves de acesso S3 do Storage; revogar o token de acesso pessoal do Supabase.
2. **Novo projeto:** https://supabase.com → New project, região **São Paulo (sa-east-1)**, Postgres 17. Habilitar `pg_cron`, `pg_net` e `vault` em *Database → Extensions*.
3. **Baixar o backup:** no B2, o arquivo mais recente de `clubecrm-backup-daily/db/` e o `secrets/` do mesmo horário (ou do `monthly/`, se o incidente for antigo).
4. **Decifrar e restaurar o banco:**
   ```bash
   age -d -i clubecrm-backup-OFFLINE.txt db-<STAMP>.tar.gz.age | tar -xzf -
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file db/roles.sql --file db/schema.sql \
     --command 'SET session_replication_role = replica' \
     --file db/data.sql --dbname "<URL_DO_NOVO_PROJETO>"
   ```
5. **Conferir:** `bash scripts/backup/row-counts.sh "<URL_DO_NOVO_PROJETO>" | diff db/manifest.tsv -` não deve imprimir nada.
6. **Segredos:**
   ```bash
   age -d -i clubecrm-backup-OFFLINE.txt secrets-<STAMP>.json.age | bash scripts/backup/restore-secrets.sh "<URL_DO_NOVO_PROJETO>"
   ```
   Se o incidente foi **comprometimento**, os segredos restaurados podem ter vazado: gerar novos na Meta (token e App Secret), na Uazapi e na Groq, e gravá-los pela interface do ClubeCRM depois do passo 9.
7. **Storage:** criar os mesmos buckets no projeto novo; configurar o remoto `supa:` apontando para o S3 do projeto novo (novas chaves S3) e rodar `rclone copy media: supa:` com as variáveis de `scripts/backup/rclone-env.sh`.
8. **Edge Functions:** `supabase link --project-ref <NOVO_REF>` e os comandos de deploy do `CLAUDE.md` (Etapa 4).
9. **Cron:** `supabase/setup/cron.sql` com o novo ref e a anon key.
10. **Vercel:** trocar `VITE_SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID`, `VITE_SUPABASE_PUBLISHABLE_KEY` e fazer **Redeploy**.
11. **Webhooks:** Meta → app → WhatsApp → Configuração → URL do webhook `https://<NOVO_REF>.supabase.co/functions/v1/whatsapp-webhook`; Uazapi → reconfigurar pela tela Números do ClubeCRM.
12. **Backup:** atualizar os segredos do GitHub (`SUPABASE_DB_URL`, `SUPA_S3_*`) e rodar o workflow de backup manualmente.
13. `npm run check` e o teste de ponta a ponta do `CLAUDE.md` (Etapa 11).

## Cenário C — erro de dados de um cliente

Restauração de **uma** organização sem afetar as demais: `scripts/export-org.mjs` (plano 1B). Até existir, restaurar o backup num projeto de homologação e copiar manualmente as linhas afetadas, com revisão de um segundo operador.

## Incidente de vazamento de dados (LGPD)

1. **Conter** (Cenário B, passo 1) e preservar evidências: `audit_log`, logs das Edge Functions e do Supabase Auth, com data e hora.
2. **Avaliar:** quais organizações, quais titulares, quais dados, desde quando.
3. **Comunicar** os clientes afetados (controladores) imediatamente, com o que se sabe.
4. **ANPD:** a comunicação ao titular e à ANPD cabe ao controlador; a Clubetec, como operadora, entrega aos clientes as informações necessárias em prazo compatível com o exigido pela ANPD (Resolução CD/ANPD nº 15/2024: 3 dias úteis para o controlador). Registrar tudo.
5. Corrigir a causa, rodar `supabase/tests/isolation.sql` e `get_advisors`, e registrar o pós-incidente.

## Treino

Executar o Cenário B inteiro em homologação **antes** de considerar este runbook pronto, e a cada 6 meses.
```

- [ ] **Step 4: Commit**

```bash
git add scripts/backup/restore-secrets.sh docs/runbook-desastre.md
git commit -m "Runbook de desastre e restauracao dos segredos do Vault

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Política de privacidade e PR

**Files:**
- Modify: `public/privacidade.html:108-120` (seção "4. Com quem compartilhamos")

- [ ] **Step 1: Incluir o Backblaze** — após a linha do Vercel (`public/privacidade.html:114`), trocar o ponto final do item do Vercel por ponto e vírgula e acrescentar:

```html
        <li><strong>Backblaze</strong> — cópias de segurança cifradas, guardadas nos Estados Unidos, que expiram em até 12 meses.</li>
```

E, se a seção não mencionar transferência internacional, acrescentar depois da lista:

```html
      <p>Alguns desses fornecedores processam dados fora do Brasil (Estados Unidos), com as salvaguardas contratuais previstas no art. 33 da LGPD. O banco de dados principal fica no Brasil (São Paulo).</p>
```

- [ ] **Step 2: Verificar no navegador**

Run: `npm run dev` e abrir `http://localhost:8080/privacidade.html`.
Expected: a lista mostra Supabase, Groq, Vercel e Backblaze; o parágrafo de transferência aparece.

- [ ] **Step 3: Remover os gatilhos temporários, commit, push e PR**

Apagar de `backup.yml` e `restore-test.yml` os blocos marcados `# TEMPORARIO` (Task 3 Step 4, Task 4 Step 4).

Run: `grep -rn TEMPORARIO .github/workflows/`
Expected: nenhuma saída.

```bash
git add public/privacidade.html .github/workflows/
git commit -m "Inclui o Backblaze na politica de privacidade

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

Abrir o PR `feat/backup-externo → main` pela web (o `gh` não está instalado): título "Backup externo cifrado e imutável (subprojeto 1A)"; descrição com o resumo das Tasks, o resultado das execuções manuais (Tasks 3 e 4) e o rodapé `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. **Não** fazer merge sem o usuário pedir.

- [ ] **Step 4: Após o merge [USUÁRIO]** — no dia seguinte, conferir no healthchecks.io que o ping das 03:00 chegou e, no B2, o arquivo novo.

---

## Critério de pronto

- Backup diário rodando pela `main`, verde, com ping no monitor.
- Arquivo no B2 **não** pode ser apagado (object lock conferido).
- Chave offline abre o backup (Task 3 Step 6).
- Teste de restauração verde, com contagens idênticas.
- Runbook e política de privacidade atualizados.
