-- O navegador precisa saber SE um segredo está configurado (aviso de
-- configuração pendente, "configurada ✓"), nunca o valor. Membros da
-- organização recebem só booleanos.
CREATE OR REPLACE FUNCTION public.org_setup_status(org uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN private.is_member(org) THEN jsonb_build_object(
    'groq_api_key', EXISTS (SELECT 1 FROM public.org_secrets
                            WHERE organization_id = org AND name = 'groq_api_key'))
  END
$$;
REVOKE ALL ON FUNCTION public.org_setup_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_setup_status(uuid) TO authenticated;
