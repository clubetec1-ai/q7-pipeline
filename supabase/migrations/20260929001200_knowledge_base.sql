-- =============================================================================
-- Base de conhecimento da empresa (pedido em 29/09)
--  * knowledge_docs: contratos, orçamentos, planilhas, manuais... por setor
--    (department_id; NULL = empresa toda). Arquivo original no bucket privado
--    "knowledge" ({org}/{doc}/{arquivo}); só o backend lê e grava.
--  * knowledge_chunks: texto em trechos com busca em português (full-text do
--    Postgres, sem custo de IA). Só o backend lê (agentes); o navegador vê docs.
--  * visibility: interno (só agentes internos: diagnóstico, implementador,
--    melhorias) | atendimento (IA que fala com o cliente também usa) |
--    enviavel (além disso pode ser enviado como arquivo).
--  * Quem gerencia: dono/admin (org.settings) ou supervisor (library.manage) nos
--    setores dele. Tudo pela função knowledge (upload, apagar, testar).
-- Idempotente.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('knowledge', 'knowledge', false, 10485760)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760;

CREATE TABLE IF NOT EXISTS public.knowledge_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  department_id uuid,
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 160),
  kind text NOT NULL DEFAULT 'outro' CHECK (kind IN ('contrato', 'orcamento', 'planilha', 'manual', 'politica', 'script', 'preco', 'outro')),
  visibility text NOT NULL DEFAULT 'interno' CHECK (visibility IN ('interno', 'atendimento', 'enviavel')),
  file_path text,
  file_name text CHECK (file_name IS NULL OR char_length(file_name) <= 200),
  mime text,
  size bigint,
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed')),
  error text,
  chunks integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  CONSTRAINT knowledge_docs_department_fk FOREIGN KEY (department_id, organization_id)
    REFERENCES public.departments (id, organization_id) ON DELETE SET NULL (department_id)
);
CREATE INDEX IF NOT EXISTS knowledge_docs_org_idx ON public.knowledge_docs (organization_id, department_id);

CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL,
  doc_id uuid NOT NULL,
  ord integer NOT NULL,
  content text NOT NULL CHECK (char_length(content) <= 2400),
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', content)) STORED,
  FOREIGN KEY (doc_id, organization_id) REFERENCES public.knowledge_docs (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS knowledge_chunks_tsv_idx ON public.knowledge_chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS knowledge_chunks_doc_idx ON public.knowledge_chunks (doc_id, ord);

ALTER TABLE public.knowledge_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.knowledge_docs, public.knowledge_chunks FROM anon, authenticated;
GRANT SELECT ON public.knowledge_docs TO authenticated;
DROP POLICY IF EXISTS "org: ver" ON public.knowledge_docs;
CREATE POLICY "org: ver" ON public.knowledge_docs FOR SELECT TO authenticated USING (
  private.has_permission(organization_id, 'org.settings')
  OR (private.has_permission(organization_id, 'library.manage')
      AND (department_id IS NULL OR private.in_department(department_id))));

-- Pode gerenciar documentos deste setor (NULL = empresa toda: só dono/admin).
CREATE OR REPLACE FUNCTION public.can_manage_knowledge(org uuid, dept uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.has_permission(org, 'org.settings')
      OR (dept IS NOT NULL AND private.has_permission(org, 'library.manage') AND private.in_department(dept))
$$;
REVOKE ALL ON FUNCTION public.can_manage_knowledge(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_knowledge(uuid, uuid) TO authenticated;

-- Busca para os agentes (backend). scope: 'cliente' = só atendimento/enviável; 'interno' = tudo.
-- depts: setores permitidos (NULL = todos); documentos da empresa toda sempre entram.
CREATE OR REPLACE FUNCTION public.service_search_knowledge(org uuid, q text, scope text, depts uuid[] DEFAULT NULL, lim integer DEFAULT 5)
RETURNS TABLE (title text, kind text, content text, rank real)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH query AS (
    SELECT to_tsquery('portuguese', string_agg(quote_literal(w) || ':*', ' | ')) AS tq
    FROM (SELECT DISTINCT w FROM regexp_split_to_table(lower(coalesce(q, '')), '[^a-zà-ú0-9]+') w WHERE length(w) >= 3 LIMIT 12) x
  )
  SELECT d.title, d.kind, c.content, ts_rank(c.tsv, query.tq) AS rank
  FROM query, public.knowledge_chunks c
  JOIN public.knowledge_docs d ON d.id = c.doc_id AND d.organization_id = org AND d.status = 'ready'
  WHERE c.organization_id = org AND query.tq IS NOT NULL AND c.tsv @@ query.tq
    AND (scope = 'interno' OR d.visibility IN ('atendimento', 'enviavel'))
    AND (depts IS NULL OR d.department_id IS NULL OR d.department_id = ANY (depts))
  ORDER BY rank DESC
  LIMIT least(greatest(coalesce(lim, 5), 1), 10)
$$;
REVOKE ALL ON FUNCTION public.service_search_knowledge(uuid, text, text, uuid[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_search_knowledge(uuid, text, text, uuid[], integer) TO service_role;
