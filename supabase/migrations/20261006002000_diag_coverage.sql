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
