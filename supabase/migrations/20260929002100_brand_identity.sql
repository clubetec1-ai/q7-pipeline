-- =============================================================================
-- Identidade da marca no Diagnóstico (pedido em 30/09)
--  * company_profiles.brand: cores (nome + código), fontes e a lista de arquivos
--    (logos e o manual da marca). Tom de voz e identidade visual em texto ficam
--    nas seções marca_voz / marca_visual (mesmo fluxo de escrever/falar + IA).
--  * Arquivos no bucket privado "brand", caminho {org}/{arquivo}; só quem cuida
--    da empresa (org.settings) ou de campanhas (campaigns.manage) lê e envia.
--  * A IA de atendimento e a de campanhas usam o tom de voz (lado do servidor).
-- Idempotente.
-- =============================================================================

ALTER TABLE public.company_profiles ADD COLUMN IF NOT EXISTS brand jsonb NOT NULL DEFAULT '{}'::jsonb;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_profiles_brand_check') THEN
    ALTER TABLE public.company_profiles ADD CONSTRAINT company_profiles_brand_check
      CHECK (jsonb_typeof(brand) = 'object' AND pg_column_size(brand) < 20000);
  END IF;
END $$;
GRANT UPDATE (brand) ON public.company_profiles TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('brand', 'brand', false, 10485760, ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

-- Empresa dona do arquivo pelo caminho {org}/{arquivo}; nome fora do padrão = ninguém.
CREATE OR REPLACE FUNCTION private.brand_path_org(path text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE parts text[] := string_to_array(path, '/');
BEGIN
  IF array_length(parts, 1) <> 2 OR parts[1] !~ '^[0-9a-f-]{36}$' OR parts[2] !~ '^[A-Za-z0-9._() -]{1,160}$' THEN RETURN NULL; END IF;
  RETURN parts[1]::uuid;
END $$;
REVOKE ALL ON FUNCTION private.brand_path_org(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.brand_path_org(text) TO authenticated;

CREATE OR REPLACE FUNCTION private.can_use_brand(org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT org IS NOT NULL AND (private.has_permission(org, 'org.settings') OR private.has_permission(org, 'campaigns.manage'))
$$;
REVOKE ALL ON FUNCTION private.can_use_brand(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_use_brand(uuid) TO authenticated;

DROP POLICY IF EXISTS "brand: ler" ON storage.objects;
DROP POLICY IF EXISTS "brand: enviar" ON storage.objects;
DROP POLICY IF EXISTS "brand: apagar" ON storage.objects;
CREATE POLICY "brand: ler" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'brand' AND private.can_use_brand(private.brand_path_org(name)));
CREATE POLICY "brand: enviar" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'brand' AND private.has_permission(private.brand_path_org(name), 'org.settings'));
CREATE POLICY "brand: apagar" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'brand' AND private.has_permission(private.brand_path_org(name), 'org.settings'));

-- Campanhas (campaigns.manage) leem a marca sem abrir o resto do diagnóstico.
CREATE OR REPLACE FUNCTION public.brand_kit(org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.company_profiles;
BEGIN
  IF NOT private.can_use_brand(org) THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.company_profiles WHERE organization_id = org;
  RETURN jsonb_build_object('brand', coalesce(p.brand, '{}'::jsonb),
    'voz', coalesce(p.sections->>'marca_voz', ''), 'visual', coalesce(p.sections->>'marca_visual', ''));
END $$;
REVOKE ALL ON FUNCTION public.brand_kit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_kit(uuid) TO authenticated;
