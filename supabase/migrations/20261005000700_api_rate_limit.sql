-- =============================================================================
-- API aberta: limite de 60 chamadas por minuto por empresa (mesma tabela de uso da IA).
-- Idempotente.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.service_api_take(org uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE used integer;
BEGIN
  INSERT INTO public.org_rate_usage (organization_id, bucket, minute, n)
  VALUES (org, 'api', date_trunc('minute', now()), 1)
  ON CONFLICT (organization_id, bucket, minute) DO UPDATE SET n = public.org_rate_usage.n + 1
  RETURNING n INTO used;
  RETURN used <= 60;
END $$;
REVOKE ALL ON FUNCTION public.service_api_take(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_api_take(uuid) TO service_role;
