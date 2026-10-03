-- =============================================================================
-- Aparência por empresa (pedido em 03/10): logo do cliente nas telas e cores
-- principal e secundária da marca. Fica em company_profiles.brand.theme
-- ({primary, secondary, logo}); use_in_theme continua ligando/desligando as cores.
-- Todo membro da empresa vê o logo escolhido para as telas (só ele; o resto do
-- kit da marca segue restrito). Idempotente.
-- =============================================================================

-- Caminho do logo das telas da empresa (sempre dentro da pasta da própria empresa;
-- só responde a quem é membro dela). Usada pela política de leitura do bucket.
CREATE OR REPLACE FUNCTION private.theme_logo_path(org uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN l LIKE org::text || '/%' THEN l END
  FROM (SELECT brand -> 'theme' ->> 'logo' AS l FROM public.company_profiles
        WHERE organization_id = org AND private.is_member(org)) x
$$;
REVOKE ALL ON FUNCTION private.theme_logo_path(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.theme_logo_path(uuid) TO authenticated;

DROP POLICY IF EXISTS "brand: logo das telas" ON storage.objects;
CREATE POLICY "brand: logo das telas" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'brand' AND private.is_member(private.brand_path_org(name))
         AND name = private.theme_logo_path(private.brand_path_org(name)));

-- Tema da empresa para as telas: cores (se ligadas) e logo (se escolhido).
CREATE OR REPLACE FUNCTION public.org_theme(org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE b jsonb; p text; s text; logo text;
BEGIN
  IF NOT private.is_member(org) THEN RETURN NULL; END IF;
  SELECT brand INTO b FROM public.company_profiles WHERE organization_id = org;
  IF b IS NULL THEN RETURN NULL; END IF;
  logo := private.theme_logo_path(org);
  IF coalesce((b ->> 'use_in_theme')::boolean, false) THEN
    p := coalesce(b -> 'theme' ->> 'primary', b -> 'colors' -> 0 ->> 'hex');
    s := coalesce(b -> 'theme' ->> 'secondary', b -> 'colors' -> 1 ->> 'hex');
    IF p !~ '^#[0-9A-Fa-f]{6}$' THEN p := NULL; END IF;
    IF s !~ '^#[0-9A-Fa-f]{6}$' THEN s := NULL; END IF;
  END IF;
  IF p IS NULL AND s IS NULL AND logo IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object('primary', p, 'secondary', s, 'logo', logo));
END $$;
REVOKE ALL ON FUNCTION public.org_theme(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_theme(uuid) TO authenticated;
