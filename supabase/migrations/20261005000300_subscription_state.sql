-- =============================================================================
-- Venda autoatendida: situação da assinatura para QUALQUER membro (só o necessário
-- para a tela: status e fim do teste — sem valores nem dados de cobrança).
-- Empresa sem assinatura (contrato direto com a Clubetec) volta 'sem_assinatura'.
-- Idempotente.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.org_access_state(org uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN NOT private.is_member(org) THEN NULL
    ELSE coalesce((SELECT jsonb_build_object('status', s.status, 'trial_ends_at', s.trial_ends_at)
                   FROM public.subscriptions s WHERE s.organization_id = org), jsonb_build_object('status', 'sem_assinatura')) END
$$;
REVOKE ALL ON FUNCTION public.org_access_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_access_state(uuid) TO authenticated;
