# A empresa completa com IA — Plano de implementação

> **Para quem for executar:** use superpowers:executing-plans (ou subagent-driven-development). Os passos usam caixas
> (`- [ ]`) para acompanhar. **Prioridade máxima do dono desde 06/10/2026**: ao retomar qualquer sessão, continue a
> próxima fatia não concluída deste plano.

**Objetivo:** construir a arquitetura aprovada em `docs/design/07-empresa-com-ia.md` (organograma de agentes com o cérebro no
topo, portões de qualidade, prova antes de ir ao ar e segurança como pilar), provando cada fatia na Clubetec do zero.

**Arquitetura:** cada fatia é uma migration nova e idempotente (tabelas com `organization_id`, RLS, escrita só por RPC
`SECURITY DEFINER SET search_path=''`), funções Deno em `supabase/functions` com regras puras em `_shared/*.ts` testadas, e
telas React que seguem o padrão de autoatendimento guiado (guia + demonstração + Ajuda). A IA só propõe; o servidor valida
toda saída da IA contra listas fechadas.

**Tecnologia:** Supabase (Postgres, RLS, pg_cron, Edge Functions Deno 2), React 18 + TypeScript + shadcn/ui, OpenAI como IA
principal (Groq reserva) via `_shared/ai-chat.ts`.

**Desenho (spec):** `docs/design/07-empresa-com-ia.md` (decisões do dono no §11).

## Restrições globais
- Isolamento total entre empresas: toda tabela nova com `organization_id`, FKs compostas `(id, organization_id)`, RLS; teste no `supabase/tests/isolation.sql` (grupo novo por fatia, a partir do 98).
- Navegador nunca grava direto o que a IA ou o servidor decide; escrita do servidor por `service_*` (só `service_role`).
- Nada de `service_role` no frontend; segredos só no cofre (`org_secrets`/vault).
- Migrations novas e idempotentes (`CREATE … IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY IF EXISTS`).
- Saída da IA é dado: validada por função pura com teste Deno; números nunca vêm da IA.
- Textos da tela e da IA em português do Brasil, simples, com exemplo; cargos de agente sempre com "(IA)".
- Toda tela nova ou mexida: guia em `src/guides/registry.tsx` com demonstração, "Como funciona", Ajuda, `MicTextarea` em caixa grande, salvar sozinho.
- Ao fim de cada fatia: `npx tsc --noEmit -p tsconfig.app.json`, `npm run build`, `deno check` das funções, testes Deno, bateria de isolamento, deploy, merge na `main` (`git merge --no-ff feat/fase3`), ROADMAP atualizado.

## Comandos de verificação (usados em todas as fatias)
```bash
# tipos do site
npx tsc --noEmit -p tsconfig.app.json
# funções
cd supabase/functions && DENO_DIR="$TMP/denochk" npx -y deno@2 check --node-modules-dir=none <funcao>/index.ts
cd supabase/functions && DENO_DIR="$TMP/denochk" npx -y deno@2 test --node-modules-dir=none --no-check -A _shared/<arquivo>_test.ts
# migration
npx supabase db query --linked -f supabase/migrations/<arquivo>.sql
# isolamento (sucesso = erro "CHEGOU AO FIM")
sed "s/RAISE NOTICE 'ISOLATION OK';/RAISE EXCEPTION 'CHEGOU AO FIM';/" supabase/tests/isolation.sql > "$TMP/iso.sql" && npx supabase db query --linked -f "$TMP/iso.sql"
# publicar função
npx supabase functions deploy <funcao> --project-ref ulmndwlralgjbwlebxmo
```

## Foco de revisão (o que mais pode dar errado com quem usa)
1. A IA devolve a cobertura com itens a mais, a menos ou fora de ordem → o servidor ignora o que não estiver na lista do especialista e marca o resto como "faltando" (teste em `coverage_test.ts`).
2. O dono marca "não temos isso" e depois clica em Organizar de novo → a marca do dono não pode ser apagada pela IA (teste no grupo 98).
3. Etapa de Processos com nome de setor com acento ou espaço (`proc:Pós-venda`) → a chave precisa funcionar ponta a ponta (teste no grupo 98).
4. Recomeçar o Diagnóstico ("Começar do zero") → a cobertura antiga some junto (teste no grupo 98).
5. Pessoa sem permissão (atendente) ou outra empresa tentando ler ou marcar a cobertura → recusado (teste no grupo 98).

---

## Mapa das 10 fatias (ordem obrigatória)

| # | Fatia | Pronto quando | Plano detalhado |
|---|---|---|---|
| 1 ✅ | Cobertura do Diagnóstico | Cada etapa mostra "Informação completa: X de Y", a lista com o porquê, "Não temos isso" e o aviso ao aprovar incompleta; tudo gravado só pelo servidor | **Abaixo (Tarefas 1–5)** |
| 2 | Revisores de área | Ao organizar uma etapa, um revisor da área aponta incoerências com as etapas aprovadas e lacunas; o dono aceita/corrige; portão F2 | Escrever ao começar |
| 3 | Processos como dado + Arquiteto | Tabela `processes` no formato do §3 do desenho, migração dos atuais, matriz de automação por passo, aprovação por processo (dono ou responsável da área) | Escrever ao começar |
| 4 | Organograma de IA | `ai_agents` + `agent_versions`, crachás do catálogo, cérebro propõe a partir de setores e processos (juntando níveis em empresa pequena), tela com cargo + "(IA)" e apelido, Pausar | Escrever ao começar |
| 5 | Guardião de segurança e LGPD | Revisão obrigatória de propostas, agentes e fluxos antes da prova, com motivos; nada reprovado segue | Escrever ao começar |
| 6 | Prova (cenários) | 7 cenários obrigatórios por executor, modo teste sem enviar a cliente, regressão a cada mudança, tela Prova | Escrever ao começar |
| 7 | Degraus + disjuntor + vigia de custo | Sombra → assistido → automático por executor; volta sozinho se errar; botão Parar; aviso de gasto fora do normal com o motivo | Escrever ao começar |
| 8 | A rede de agentes | `agent_tasks` (pedir informação, revisar, propor, alertar, escalar), profundidade ≤ 3, orçamento, expiração, perguntas voltando ao Diagnóstico | Escrever ao começar |
| 9 | Implantação pelo organograma | Implementador monta rascunhos por especialista/executor a partir dos processos aprovados | Escrever ao começar |
| 10 | Acabamento e prova final | Guias e vídeos, revisão de segurança completa (agente revisor), isolamento, Clubetec do zero ponta a ponta, medição de chamados | Escrever ao começar |

Cada fatia, antes do código, ganha aqui uma seção "Fatia N — tarefas" no mesmo formato da Fatia 1.

---

## Fatia 1 — Cobertura do Diagnóstico

**Arquivos:**
- Criar: `supabase/migrations/20261006002000_diag_coverage.sql` — tabela, RPCs, limpeza no recomeço.
- Criar: `supabase/functions/_shared/coverage.ts` e `coverage_test.ts` — validação da cobertura devolvida pela IA.
- Modificar: `supabase/functions/interviewer/index.ts` (ação `format`) — pede e grava a cobertura.
- Criar: `src/pages/diagnostico/CoverageBar.tsx` — barra, lista e "Não temos isso".
- Modificar: `src/pages/Diagnostico.tsx` e `src/pages/DiagnosticoSetor.tsx` — mostra a barra e avisa ao aprovar incompleta.
- Modificar: `src/guides/registry.tsx` e `src/guides/mocks/DiagMock.tsx` — passo novo no guia do Diagnóstico.
- Modificar: `supabase/tests/isolation.sql` — grupo 98.
- Modificar: `src/integrations/supabase/types.ts` (gerado).

### Tarefa 1: Tabela e RPCs da cobertura (banco)

**Interfaces:**
- Produz: tabela `public.diag_coverage(organization_id, step_key, items jsonb, complete int, total int, updated_at)`;
  `public.service_diag_coverage_save(org uuid, p_key text, p_items jsonb) RETURNS jsonb` (só service_role; preserva
  marcas do dono); `public.set_coverage_item(org uuid, p_key text, p_n int, p_nao_tem boolean) RETURNS jsonb`
  (org.settings). Item: `{n int, item text, porque text, status 'completo'|'incompleto'|'faltando'|'nao_tem', nota text, por 'ia'|'dono'}`.

- [x] **Passo 1: escrever o teste (grupo 98) no `isolation.sql`, antes do `-- 97.`**

```sql
  -- 98. Cobertura do Diagnostico: so dono/admin ve; so o servidor grava; marca do dono vale.
  PERFORM public.service_diag_coverage_save(A, 'marca', '[{"n":1,"item":"cores","porque":"p","status":"completo","nota":""},{"n":2,"item":"logo","porque":"p","status":"faltando","nota":""}]');
  PERFORM pg_temp.expect(pg_temp.q(owner_a, 'SELECT complete FROM public.diag_coverage WHERE step_key = ''marca''') = 1, 'dono ve a cobertura');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.diag_coverage') = 0, 'outra org nao ve');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT count(*) FROM public.diag_coverage') = 0, 'atendente nao ve');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('INSERT INTO public.diag_coverage (organization_id, step_key) VALUES (%L, %L)', A, 'x')) LIKE 'err:%', 'navegador nao grava direto');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.service_diag_coverage_save(%L, %L, %L)', A, 'marca', '[]'), 'navegador nao usa a funcao do servidor');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.set_coverage_item(%L, %L, 2, true)', A, 'marca'), 'outra org nao marca');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.set_coverage_item(%L, %L, 2, true)', A, 'marca'), 'atendente nao marca');
  PERFORM pg_temp.run(owner_a, format('SELECT public.set_coverage_item(%L, %L, 2, true)', A, 'marca'));
  PERFORM pg_temp.expect((SELECT complete FROM public.diag_coverage WHERE organization_id = A AND step_key = 'marca') = 2, 'nao temos isso conta como resolvido');
  PERFORM public.service_diag_coverage_save(A, 'marca', '[{"n":1,"item":"cores","porque":"p","status":"completo","nota":""},{"n":2,"item":"logo","porque":"p","status":"faltando","nota":""}]');
  PERFORM pg_temp.expect((SELECT items -> 1 ->> 'status' FROM public.diag_coverage WHERE organization_id = A AND step_key = 'marca') = 'nao_tem', 'IA nao apaga a marca do dono');
  PERFORM public.service_diag_coverage_save(A, 'proc:Pós-venda', '[{"n":1,"item":"a","porque":"p","status":"incompleto","nota":""}]');
  PERFORM pg_temp.expect(pg_temp.q(owner_a, 'SELECT total FROM public.diag_coverage WHERE step_key = ''proc:Pós-venda''') = 1, 'etapa de setor com acento funciona');
  PERFORM pg_temp.run(owner_a, format('SELECT public.reset_company_profile(%L)', A));
  PERFORM pg_temp.expect(NOT EXISTS (SELECT 1 FROM public.diag_coverage WHERE organization_id = A), 'recomecar o Diagnostico apaga a cobertura');
```

- [x] **Passo 2: rodar a bateria e ver falhar** (função `service_diag_coverage_save` não existe).

- [x] **Passo 3: escrever a migration `20261006002000_diag_coverage.sql`**

```sql
-- Cobertura do Diagnóstico (desenho 07, fatia 1): por etapa, o status de cada item que os agentes
-- precisam saber (lista do especialista). Só o servidor grava o que a IA avaliou; o dono só marca
-- "não temos isso". Idempotente.
CREATE TABLE IF NOT EXISTS public.diag_coverage (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  step_key text NOT NULL CHECK (step_key ~ '^([a-z_]{2,20}|proc:.{1,80})$'),
  items jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items) = 'array' AND octet_length(items::text) <= 20000),
  complete int NOT NULL DEFAULT 0,
  total int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, step_key)
);
ALTER TABLE public.diag_coverage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.diag_coverage FROM anon, authenticated;
GRANT SELECT ON public.diag_coverage TO authenticated;
DROP POLICY IF EXISTS "ler: dono/admin" ON public.diag_coverage;
CREATE POLICY "ler: dono/admin" ON public.diag_coverage FOR SELECT TO authenticated
  USING (private.has_permission(organization_id, 'org.settings'));

-- Itens válidos e contagem (completo ou "não tem" contam como resolvidos).
CREATE OR REPLACE FUNCTION private.coverage_clean(p_items jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'n', (x ->> 'n')::int,
      'item', left(coalesce(x ->> 'item', ''), 200),
      'porque', left(coalesce(x ->> 'porque', ''), 300),
      'status', CASE WHEN x ->> 'status' IN ('completo', 'incompleto', 'faltando', 'nao_tem') THEN x ->> 'status' ELSE 'faltando' END,
      'nota', left(coalesce(x ->> 'nota', ''), 300),
      'por', CASE WHEN x ->> 'por' = 'dono' THEN 'dono' ELSE 'ia' END) ORDER BY (x ->> 'n')::int), '[]'::jsonb)
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_items) = 'array' THEN p_items ELSE '[]'::jsonb END) x
  WHERE (x ->> 'n') ~ '^[0-9]{1,2}$'
$$;

CREATE OR REPLACE FUNCTION private.coverage_write(org uuid, p_key text, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb := private.coverage_clean(p_items);
BEGIN
  IF p_key !~ '^([a-z_]{2,20}|proc:.{1,80})$' THEN RAISE EXCEPTION 'etapa inválida' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.diag_coverage (organization_id, step_key, items, complete, total, updated_at)
  VALUES (org, p_key, v,
    (SELECT count(*) FROM jsonb_array_elements(v) x WHERE x ->> 'status' IN ('completo', 'nao_tem')),
    jsonb_array_length(v), now())
  ON CONFLICT (organization_id, step_key) DO UPDATE
    SET items = EXCLUDED.items, complete = EXCLUDED.complete, total = EXCLUDED.total, updated_at = now();
  RETURN v;
END $$;

-- Servidor (ação format do entrevistador): grava o que a IA avaliou, mantendo as marcas do dono.
CREATE OR REPLACE FUNCTION public.service_diag_coverage_save(org uuid, p_key text, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE old jsonb; merged jsonb;
BEGIN
  SELECT items INTO old FROM public.diag_coverage WHERE organization_id = org AND step_key = p_key;
  SELECT coalesce(jsonb_agg(CASE WHEN o.x IS NOT NULL THEN n.x || jsonb_build_object('status', o.x ->> 'status', 'por', 'dono') ELSE n.x END
           ORDER BY (n.x ->> 'n')::int), '[]'::jsonb)
  INTO merged
  FROM jsonb_array_elements(private.coverage_clean(p_items)) n(x)
  LEFT JOIN jsonb_array_elements(coalesce(old, '[]'::jsonb)) o(x)
    ON (o.x ->> 'n') = (n.x ->> 'n') AND o.x ->> 'por' = 'dono';
  RETURN private.coverage_write(org, p_key, merged);
END $$;
REVOKE ALL ON FUNCTION public.service_diag_coverage_save(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_diag_coverage_save(uuid, text, jsonb) TO service_role;

-- Dono: "não temos isso" (ou desfaz, voltando a "faltando" até a próxima avaliação).
CREATE OR REPLACE FUNCTION public.set_coverage_item(org uuid, p_key text, p_n int, p_nao_tem boolean)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE cur jsonb; upd jsonb;
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  SELECT items INTO cur FROM public.diag_coverage WHERE organization_id = org AND step_key = p_key;
  IF cur IS NULL THEN RAISE EXCEPTION 'etapa sem avaliação' USING ERRCODE = '22023'; END IF;
  SELECT jsonb_agg(CASE WHEN (x ->> 'n')::int = p_n
           THEN x || jsonb_build_object('status', CASE WHEN p_nao_tem THEN 'nao_tem' ELSE 'faltando' END, 'por', CASE WHEN p_nao_tem THEN 'dono' ELSE 'ia' END)
           ELSE x END ORDER BY (x ->> 'n')::int)
  INTO upd FROM jsonb_array_elements(cur) x;
  PERFORM private.audit(org, 'diag.coverage_item', p_key, jsonb_build_object('n', p_n, 'nao_tem', p_nao_tem));
  RETURN private.coverage_write(org, p_key, upd);
END $$;
REVOKE ALL ON FUNCTION public.set_coverage_item(uuid, text, int, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_coverage_item(uuid, text, int, boolean) TO authenticated;

-- Recomeçar o Diagnóstico apaga a cobertura junto (o perfil volta vazio).
CREATE OR REPLACE FUNCTION private.coverage_on_profile_reset()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.steps = '{}'::jsonb THEN
    DELETE FROM public.diag_coverage WHERE organization_id = NEW.organization_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS coverage_on_profile_reset ON public.company_profiles;
CREATE TRIGGER coverage_on_profile_reset AFTER UPDATE OF steps ON public.company_profiles
  FOR EACH ROW EXECUTE FUNCTION private.coverage_on_profile_reset();
```

(Conferir antes a assinatura de `private.audit` e o corpo de `reset_company_profile` — se o reset não zera `steps`, o
gatilho troca a condição para o que o reset faz.)

- [x] **Passo 4: aplicar a migration e rodar a bateria** — esperado: "CHEGOU AO FIM".
- [x] **Passo 5: gerar os tipos e fazer commit.**

### Tarefa 2: Validação da cobertura vinda da IA (regra pura)

**Interfaces:**
- Consome: `Specialist`, `Need` de `_shared/specialists.ts`.
- Produz: `parseCoverage(raw: unknown, spec: Specialist): CoverageItem[]` em `_shared/coverage.ts`;
  `CoverageItem = { n: number; item: string; porque: string; status: "completo"|"incompleto"|"faltando"; nota: string }`.

- [x] **Passo 1: teste `coverage_test.ts`**

```ts
import { assertEquals } from "jsr:@std/assert@1";
import { parseCoverage } from "./coverage.ts";
import { specialistFor } from "./specialists.ts";

const spec = specialistFor("posvenda")!;

Deno.test("item fora da lista é ignorado; o que a IA não avaliou fica faltando; ordem e textos vêm da lista", () => {
  const out = parseCoverage([
    { n: 2, status: "completo", nota: "reclamação vai para o suporte em 24 h" },
    { n: 99, status: "completo" },
    { n: 1, status: "talvez" },
  ], spec);
  assertEquals(out.length, spec.precisa.length);
  assertEquals(out.map((x) => x.n), spec.precisa.map((_, i) => i + 1));
  assertEquals(out[0].status, "faltando");
  assertEquals(out[1].status, "completo");
  assertEquals(out[1].item, spec.precisa[1].item);
  assertEquals(out[1].porque, spec.precisa[1].porque);
  assertEquals(out[2].status, "faltando");
});

Deno.test("resposta sem lista vira tudo faltando (nunca quebra)", () => {
  assertEquals(parseCoverage("lixo", spec).every((x) => x.status === "faltando"), true);
});
```

- [x] **Passo 2: rodar e ver falhar** (módulo não existe).
- [x] **Passo 3: `_shared/coverage.ts`**

```ts
import type { Specialist } from "./specialists.ts";

export type CoverageStatus = "completo" | "incompleto" | "faltando";
export interface CoverageItem { n: number; item: string; porque: string; status: CoverageStatus; nota: string }

const STATUS = new Set<CoverageStatus>(["completo", "incompleto", "faltando"]);

/** Cobertura devolvida pela IA → lista fechada do especialista (item e porquê sempre da lista, nunca da IA). */
export function parseCoverage(raw: unknown, spec: Specialist): CoverageItem[] {
  const got = new Map<number, { status: CoverageStatus; nota: string }>();
  for (const x of Array.isArray(raw) ? raw : []) {
    const o = (x ?? {}) as Record<string, unknown>;
    const n = Number(o.n);
    const st = String(o.status ?? "") as CoverageStatus;
    if (Number.isInteger(n) && n >= 1 && n <= spec.precisa.length && STATUS.has(st)) {
      got.set(n, { status: st, nota: String(o.nota ?? "").trim().slice(0, 300) });
    }
  }
  return spec.precisa.map((need, i) => ({
    n: i + 1, item: need.item, porque: need.porque,
    status: got.get(i + 1)?.status ?? "faltando", nota: got.get(i + 1)?.nota ?? "",
  }));
}
```

- [x] **Passo 4: rodar e ver passar; commit.**

### Tarefa 3: O entrevistador avalia e grava a cobertura ao organizar

**Interfaces:**
- Consome: `parseCoverage` (Tarefa 2), `service_diag_coverage_save` (Tarefa 1), `fspec` já existente na ação `format`.
- Produz: a resposta de `format` ganha `cobertura: { items, complete, total }`.

- [x] **Passo 1:** no `faltandoRule` (com `fspec`), acrescentar ao pedido: `Em cobertura, para CADA item numerado da lista,
  {n, status: completo|incompleto|faltando, nota: o que já tem ou o que falta, em poucas palavras}, considerando texto,
  respostas da entrevista, anexos e kit.` e incluir `"cobertura":[{"n":1,"status":"","nota":""}]` nos dois modelos de JSON
  da ação `format`.
- [x] **Passo 2:** depois de `out`, gravar:

```ts
const covKey = stepKey === "processos" ? `proc:${clip(body?.setor, 80)}` : stepKey;
const cobertura = fspec
  ? await admin.rpc("service_diag_coverage_save", { org: orgId, p_key: covKey, p_items: parseCoverage(out.cobertura, fspec) })
      .then((r) => (r.error ? null : r.data))
  : null;
```
  e devolver `cobertura` junto do `json({...})` das duas saídas (processos e demais).
- [x] **Passo 3:** `deno check interviewer/index.ts`, publicar `interviewer`, commit.

### Tarefa 4: Barra "Informação completa" e aviso ao aprovar

**Interfaces:**
- Consome: tabela `diag_coverage` (leitura), RPC `set_coverage_item`.
- Produz: `<CoverageBar orgId stepKey refresh onLoad? />` em `src/pages/diagnostico/CoverageBar.tsx`;
  `type Coverage = { items: CoverageItem[]; complete: number; total: number }`.

- [x] **Passo 1:** componente lê `diag_coverage` (org + step), mostra a barra (`complete/total`), a lista com ícone por
  status (✓ completo, ◐ incompleto, ○ faltando, — não temos), a nota, o porquê ("Por que importa") e o botão
  "Não temos isso" / "Desfazer" (chama `set_coverage_item`). Sem avaliação: texto "Clique em Organizar com IA para ver o que
  já está completo".
- [x] **Passo 2:** `Diagnostico.tsx` e `DiagnosticoSetor.tsx`: mostrar `CoverageBar` acima da conferência, recarregar
  depois de `organize`; em `approve`, se houver item `faltando` ou `incompleto`, `window.confirm` com a lista ("Ficou
  faltando: … Sem isso o agente pode não resolver esses casos. Aprovar mesmo assim? Você pode completar depois.").
- [x] **Passo 3:** guia do Diagnóstico: passo novo "Veja o que ainda falta" com `Pointer` da barra e cena `cobertura` no
  `DiagMock`.
- [x] **Passo 4:** `tsc`, `build`, commit.

### Tarefa 5: Prova na Clubetec e entrega
- [x] Rodar a bateria completa de isolamento (98 incluso) e os testes Deno.
- [x] Publicar, merge na `main`, conferir no site: organizar uma etapa da Clubetec, ver a barra, marcar "Não temos isso",
  organizar de novo (a marca continua), aprovar incompleta (aviso aparece).
- [x] ROADMAP: fatia 1 ✅; memória sem mudança (a prioridade segue para a fatia 2).
