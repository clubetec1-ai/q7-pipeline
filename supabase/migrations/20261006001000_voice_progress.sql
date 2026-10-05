-- =============================================================================
-- Entrevista por voz: cada resposta é salva na hora (company_profiles.steps[etapa].voice),
-- para continuar de onde parou se a página fechar ou recarregar. Só dono/admin.
-- Idempotente.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.save_voice_progress(org uuid, p_key text, p_qa jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE keep jsonb;
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF p_key !~ '^([a-z_]{2,20}|proc:.{1,80})$' THEN RAISE EXCEPTION 'etapa inválida' USING ERRCODE = '22023'; END IF;
  IF p_qa IS NOT NULL AND (jsonb_typeof(p_qa) <> 'array' OR jsonb_array_length(p_qa) > 20 OR octet_length(p_qa::text) > 40000) THEN
    RAISE EXCEPTION 'entrevista grande demais' USING ERRCODE = '22023';
  END IF;
  -- Só pergunta e resposta em texto (nada de áudio).
  keep := (SELECT coalesce(jsonb_agg(jsonb_build_object('q', left(x ->> 'q', 500), 'a', left(x ->> 'a', 3000))), '[]'::jsonb)
           FROM jsonb_array_elements(coalesce(p_qa, '[]'::jsonb)) x WHERE coalesce(x ->> 'a', '') <> '');
  INSERT INTO public.company_profiles (organization_id) VALUES (org) ON CONFLICT (organization_id) DO NOTHING;
  UPDATE public.company_profiles
  SET steps = CASE WHEN jsonb_array_length(keep) = 0
      THEN jsonb_set(coalesce(steps, '{}'::jsonb), ARRAY[p_key], coalesce(steps -> p_key, '{}'::jsonb) - 'voice')
      ELSE jsonb_set(coalesce(steps, '{}'::jsonb), ARRAY[p_key],
             coalesce(steps -> p_key, '{}'::jsonb) || jsonb_build_object('voice', jsonb_build_object('qa', keep, 'at', now()))) END
  WHERE organization_id = org;
END $$;
REVOKE ALL ON FUNCTION public.save_voice_progress(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_voice_progress(uuid, text, jsonb) TO authenticated;
