-- =============================================================================
-- White label da rede: o tema da empresa passa a trazer o nome do produto e o logo
-- da rede (definidos pela Clubetec) e, quando a empresa não tem cores próprias,
-- as cores da rede. O logo da rede (no bucket brand da matriz) pode ser lido só por
-- quem é da rede. Idempotente.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.org_theme(org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE b jsonb; p text; s text; logo text; nb jsonb;
BEGIN
  IF NOT private.is_member(org) THEN RETURN NULL; END IF;
  SELECT brand INTO b FROM public.company_profiles WHERE organization_id = org;
  logo := private.theme_logo_path(org);
  IF coalesce((b ->> 'use_in_theme')::boolean, false) THEN
    p := coalesce(b -> 'theme' ->> 'primary', b -> 'colors' -> 0 ->> 'hex');
    s := coalesce(b -> 'theme' ->> 'secondary', b -> 'colors' -> 1 ->> 'hex');
    IF p !~ '^#[0-9A-Fa-f]{6}$' THEN p := NULL; END IF;
    IF s !~ '^#[0-9A-Fa-f]{6}$' THEN s := NULL; END IF;
  END IF;
  SELECT n.brand INTO nb FROM public.networks n
  WHERE n.hq_org_id = org OR n.id = (SELECT network_id FROM public.network_units WHERE organization_id = org) LIMIT 1;
  IF nb IS NOT NULL AND nb <> '{}'::jsonb THEN
    p := coalesce(p, nb ->> 'primary');
    s := coalesce(s, nb ->> 'secondary');
  END IF;
  IF p IS NULL AND s IS NULL AND logo IS NULL AND coalesce(nb, '{}'::jsonb) = '{}'::jsonb THEN RETURN NULL; END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object('primary', p, 'secondary', s, 'logo', logo,
    'app_name', nb ->> 'app_name', 'network_logo', nb ->> 'logo'));
END $$;

DROP POLICY IF EXISTS "rede: logo" ON storage.objects;
CREATE POLICY "rede: logo" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'brand' AND EXISTS (SELECT 1 FROM public.networks n WHERE n.brand ->> 'logo' = storage.objects.name AND private.in_network(n.id)));

-- Para o painel da Clubetec: redes com matriz, unidades e marca.
CREATE OR REPLACE FUNCTION public.platform_networks()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'só a Clubetec' USING ERRCODE = '42501'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name, 'hq_org_id', n.hq_org_id, 'hq', o.name, 'brand', n.brand,
            'unidades', (SELECT count(*) FROM public.network_units u WHERE u.network_id = n.id),
            'logo_matriz', (SELECT CASE WHEN l LIKE n.hq_org_id::text || '/%' THEN l END
              FROM (SELECT brand -> 'theme' ->> 'logo' AS l FROM public.company_profiles WHERE organization_id = n.hq_org_id) x)) ORDER BY n.name), '[]'::jsonb)
          FROM public.networks n JOIN public.organizations o ON o.id = n.hq_org_id);
END $$;
REVOKE ALL ON FUNCTION public.platform_networks() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_networks() TO authenticated;
