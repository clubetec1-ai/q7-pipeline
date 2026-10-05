-- =============================================================================
-- Cérebro: setor da fila sem nome reconhecido vira área de ATENDIMENTO (cada setor é
-- uma fila de atendimento; ex.: cartório "Escrituras e notas" mede fila e resposta).
-- Idempotente.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.seed_org_areas(org uuid)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d record; k text; n integer := 0; c integer;
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  FOR d IN SELECT id, name FROM public.departments WHERE organization_id = org LOOP
    k := CASE
      WHEN d.name ~* '(vend|comerc)' THEN 'vendas'
      WHEN d.name ~* '(financ|cobran|fatur)' THEN 'financeiro'
      WHEN d.name ~* '(market|divulga)' THEN 'marketing'
      WHEN d.name ~* '(rh|recursos humanos|pessoas)' THEN 'rh'
      WHEN d.name ~* '(admin|secret)' THEN 'administrativo'
      WHEN d.name ~* '(suporte|atendim|sac|recep)' THEN 'atendimento'
      WHEN d.name ~* '(p[oó]s.?venda|implant)' THEN 'pos_venda'
      WHEN d.name ~* '(opera|log[ií]st|produ)' THEN 'operacao'
      ELSE 'atendimento' END;
    INSERT INTO public.org_areas (organization_id, key, name, department_id, enabled)
    VALUES (org, k, d.name, d.id, false) ON CONFLICT (organization_id, name) DO NOTHING;
    GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
  END LOOP;
  -- Áreas de gestão que toda empresa tem, mesmo sem fila própria.
  FOR k IN SELECT unnest(ARRAY['vendas', 'atendimento', 'financeiro', 'marketing', 'administrativo']) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.org_areas WHERE organization_id = org AND key = k) THEN
      INSERT INTO public.org_areas (organization_id, key, name, enabled)
      VALUES (org, k, CASE k WHEN 'vendas' THEN 'Vendas' WHEN 'atendimento' THEN 'Atendimento' WHEN 'financeiro' THEN 'Financeiro'
                             WHEN 'marketing' THEN 'Marketing' ELSE 'Administrativo' END, false)
      ON CONFLICT (organization_id, name) DO NOTHING;
      GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
    END IF;
  END LOOP;
  PERFORM private.audit(org, 'area.seeded', 'org_areas', jsonb_build_object('added', n));
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.seed_org_areas(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_org_areas(uuid) TO authenticated;
