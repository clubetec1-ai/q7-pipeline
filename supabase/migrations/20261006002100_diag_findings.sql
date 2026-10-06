-- Revisão de área do Diagnóstico (desenho 07, fatia 2): o diretor da área (IA) confere a etapa
-- organizada contra as etapas aprovadas e aponta incoerências, riscos e lacunas críticas. Só o
-- servidor grava; o dono marca "Corrigi" (resolvida) ou "Está certo assim" (ignorada — a IA não
-- repete). Idempotente.
CREATE TABLE IF NOT EXISTS public.diag_findings (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  step_key text NOT NULL CHECK (step_key ~ '^([a-z_]{2,20}|proc:.{1,80})$'),
  reviewer text NOT NULL DEFAULT '' CHECK (length(reviewer) <= 120),
  items jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items) = 'array' AND octet_length(items::text) <= 20000),
  ignored jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(ignored) = 'array' AND octet_length(ignored::text) <= 20000),
  open_critical int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, step_key)
);
ALTER TABLE public.diag_findings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.diag_findings FROM anon, authenticated;
GRANT SELECT ON public.diag_findings TO authenticated;
DROP POLICY IF EXISTS "ler: dono/admin" ON public.diag_findings;
CREATE POLICY "ler: dono/admin" ON public.diag_findings FOR SELECT TO authenticated
  USING (private.has_permission(organization_id, 'org.settings'));

CREATE OR REPLACE FUNCTION private.findings_clean(p_items jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'n', s.k,
      'tipo', x ->> 'tipo',
      'gravidade', CASE WHEN x ->> 'gravidade' IN ('critica', 'media', 'baixa') THEN x ->> 'gravidade' ELSE 'media' END,
      'texto', left(x ->> 'texto', 400),
      'etapas', coalesce((SELECT jsonb_agg(e) FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(x -> 'etapas') = 'array' THEN x -> 'etapas' ELSE '[]'::jsonb END) e
                          WHERE e ~ '^([a-z_]{2,20}|proc:.{1,80})$'), '[]'::jsonb),
      'sugestao', left(coalesce(x ->> 'sugestao', ''), 300),
      'status', 'aberta') ORDER BY s.k), '[]'::jsonb)
  FROM (SELECT f.x, row_number() OVER () AS k
        FROM (SELECT x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_items) = 'array' THEN p_items ELSE '[]'::jsonb END) x
              WHERE x ->> 'tipo' IN ('incoerencia', 'risco', 'lacuna_critica') AND coalesce(trim(x ->> 'texto'), '') <> ''
              LIMIT 5) f) s
$$;

CREATE OR REPLACE FUNCTION private.findings_open_critical(p_items jsonb)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT count(*)::int FROM jsonb_array_elements(p_items) x WHERE x ->> 'gravidade' = 'critica' AND x ->> 'status' = 'aberta'
$$;

-- Servidor (ação format do entrevistador): grava a revisão nova; o que o dono já confirmou fica em "ignored".
CREATE OR REPLACE FUNCTION public.service_diag_findings_save(org uuid, p_key text, p_reviewer text, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb := private.findings_clean(p_items);
BEGIN
  IF p_key !~ '^([a-z_]{2,20}|proc:.{1,80})$' THEN RAISE EXCEPTION 'etapa inválida' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.diag_findings (organization_id, step_key, reviewer, items, open_critical, updated_at)
  VALUES (org, p_key, left(coalesce(p_reviewer, ''), 120), v, private.findings_open_critical(v), now())
  ON CONFLICT (organization_id, step_key) DO UPDATE
    SET reviewer = EXCLUDED.reviewer, items = EXCLUDED.items, open_critical = EXCLUDED.open_critical, updated_at = now();
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.service_diag_findings_save(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_diag_findings_save(uuid, text, text, jsonb) TO service_role;

-- Dono: "Corrigi" (resolvida), "Está certo assim" (ignorada) ou reabrir.
CREATE OR REPLACE FUNCTION public.set_finding_status(org uuid, p_key text, p_n int, p_status text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE cur public.diag_findings; upd jsonb; txt text;
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('aberta', 'resolvida', 'ignorada') THEN RAISE EXCEPTION 'situação inválida' USING ERRCODE = '22023'; END IF;
  SELECT * INTO cur FROM public.diag_findings WHERE organization_id = org AND step_key = p_key FOR UPDATE;
  IF cur.organization_id IS NULL THEN RAISE EXCEPTION 'etapa sem revisão' USING ERRCODE = '22023'; END IF;
  SELECT jsonb_agg(CASE WHEN (x ->> 'n')::int = p_n THEN x || jsonb_build_object('status', p_status) ELSE x END ORDER BY (x ->> 'n')::int),
         max(CASE WHEN (x ->> 'n')::int = p_n THEN x ->> 'texto' END)
  INTO upd, txt FROM jsonb_array_elements(cur.items) x;
  UPDATE public.diag_findings
  SET items = upd, open_critical = private.findings_open_critical(upd), updated_at = now(),
      ignored = CASE WHEN p_status = 'ignorada' AND txt IS NOT NULL AND NOT ignored ? txt
                     THEN (SELECT coalesce(jsonb_agg(e), '[]'::jsonb) FROM (SELECT e FROM jsonb_array_elements(ignored || to_jsonb(txt)) e OFFSET greatest(jsonb_array_length(ignored) + 1 - 30, 0)) z)
                     ELSE ignored END
  WHERE organization_id = org AND step_key = p_key;
  PERFORM private.audit(org, 'diag.finding_status', p_key, jsonb_build_object('n', p_n, 'status', p_status));
  RETURN upd;
END $$;
REVOKE ALL ON FUNCTION public.set_finding_status(uuid, text, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_finding_status(uuid, text, int, text) TO authenticated;

-- Recomeçar o Diagnóstico apaga a revisão junto.
CREATE OR REPLACE FUNCTION private.findings_on_profile_reset()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.steps = '{}'::jsonb THEN DELETE FROM public.diag_findings WHERE organization_id = NEW.organization_id; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS findings_on_profile_reset ON public.company_profiles;
CREATE TRIGGER findings_on_profile_reset AFTER UPDATE OF steps ON public.company_profiles
  FOR EACH ROW EXECUTE FUNCTION private.findings_on_profile_reset();
