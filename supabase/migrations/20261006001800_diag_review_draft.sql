-- =============================================================================
-- Diagnóstico: a conferência ("Confira e ajuste antes de aprovar") também é salva
-- sozinha. O texto organizado pela IA e os ajustes do dono ficam em steps[etapa].review
-- até ele aprovar (a aprovação grava a etapa sem o rascunho) ou cancelar (p_review NULL).
-- Atualizar a página ou trocar de etapa não perde mais a conferência.
-- Idempotente.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.save_step_review(org uuid, p_key text, p_review jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF p_key !~ '^([a-z_]{2,20}|proc:.{1,80})$' THEN RAISE EXCEPTION 'etapa inválida' USING ERRCODE = '22023'; END IF;
  IF p_review IS NOT NULL AND (jsonb_typeof(p_review) <> 'object' OR octet_length(p_review::text) > 80000) THEN
    RAISE EXCEPTION 'conferência inválida ou grande demais' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.company_profiles (organization_id) VALUES (org) ON CONFLICT (organization_id) DO NOTHING;
  UPDATE public.company_profiles
  SET steps = jsonb_set(coalesce(steps, '{}'::jsonb), ARRAY[p_key],
        CASE WHEN p_review IS NULL THEN coalesce(steps -> p_key, '{}'::jsonb) - 'review'
             ELSE coalesce(steps -> p_key, '{}'::jsonb) || jsonb_build_object('review', p_review, 'review_at', now()) END),
      last_page = p_key
  WHERE organization_id = org;
END $$;
REVOKE ALL ON FUNCTION public.save_step_review(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_step_review(uuid, text, jsonb) TO authenticated;
