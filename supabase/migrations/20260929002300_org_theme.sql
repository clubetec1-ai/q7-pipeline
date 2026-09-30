-- =============================================================================
-- Cor da marca no tema do ClubeCRM (pedido em 30/09, fase 2 do visual)
-- O dono liga "usar a cor da marca no sistema" no kit da marca (brand.use_in_theme)
-- e a primeira cor vira a cor principal das telas da empresa. Qualquer pessoa da
-- empresa lê só essa cor (nada do resto do diagnóstico); outra empresa, nada.
-- Idempotente.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.org_theme(org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE b jsonb; c text;
BEGIN
  IF NOT private.is_member(org) THEN RETURN NULL; END IF;
  SELECT brand INTO b FROM public.company_profiles WHERE organization_id = org;
  IF coalesce((b->>'use_in_theme')::boolean, false) IS NOT TRUE THEN RETURN NULL; END IF;
  c := b->'colors'->0->>'hex';
  IF c IS NULL OR c !~ '^#[0-9A-Fa-f]{6}$' THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('primary', c);
END $$;
REVOKE ALL ON FUNCTION public.org_theme(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_theme(uuid) TO authenticated;
