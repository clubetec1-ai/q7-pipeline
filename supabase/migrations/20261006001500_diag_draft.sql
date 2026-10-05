-- =============================================================================
-- Diagnóstico: rascunho salvo sozinho. O texto da caixa e os anexos de cada etapa são
-- gravados enquanto o dono escreve (antes só ao aprovar), e a página onde ele estava
-- (last_page) volta quando ele abre o Diagnóstico de novo (inclusive após atualizar).
-- Idempotente.
-- =============================================================================
ALTER TABLE public.company_profiles ADD COLUMN IF NOT EXISTS last_page text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'company_profiles_last_page_check') THEN
    ALTER TABLE public.company_profiles ADD CONSTRAINT company_profiles_last_page_check
      CHECK (last_page IS NULL OR char_length(last_page) <= 100);
  END IF;
END $$;

-- p_raw NULL = só lembra a página (sem mexer no texto).
CREATE OR REPLACE FUNCTION public.save_step_draft(org uuid, p_key text, p_raw text, p_attachments jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE att jsonb;
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF p_key !~ '^([a-z_]{2,20}|proc:.{1,80})$' THEN RAISE EXCEPTION 'etapa inválida' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.company_profiles (organization_id) VALUES (org) ON CONFLICT (organization_id) DO NOTHING;
  IF p_raw IS NULL THEN
    UPDATE public.company_profiles SET last_page = p_key WHERE organization_id = org;
    RETURN;
  END IF;
  IF char_length(p_raw) > 12000 THEN RAISE EXCEPTION 'texto longo demais' USING ERRCODE = '22023'; END IF;
  IF p_attachments IS NOT NULL AND (jsonb_typeof(p_attachments) <> 'array' OR jsonb_array_length(p_attachments) > 20) THEN
    RAISE EXCEPTION 'anexos inválidos' USING ERRCODE = '22023';
  END IF;
  -- Só anexos que são desta empresa (id da base de conhecimento) e o nome do arquivo.
  att := (SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', left(x ->> 'name', 200))), '[]'::jsonb)
          FROM jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) x
          JOIN public.knowledge_docs d ON d.id::text = x ->> 'id' AND d.organization_id = org);
  UPDATE public.company_profiles
  SET steps = jsonb_set(coalesce(steps, '{}'::jsonb), ARRAY[p_key],
        coalesce(steps -> p_key, '{}'::jsonb) || jsonb_build_object('raw', p_raw, 'attachments', att, 'draft_at', now())),
      last_page = p_key
  WHERE organization_id = org;
END $$;
REVOKE ALL ON FUNCTION public.save_step_draft(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_step_draft(uuid, text, text, jsonb) TO authenticated;
