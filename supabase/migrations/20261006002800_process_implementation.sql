-- Implantação pelo organograma (desenho 07, fatia 9): cada processo aprovado vira o documento "Como funciona"
-- na base (o agente usa no atendimento) e a indicação do fluxo pronto mais adequado. A implantação guarda a versão
-- do desenho: se o processo mudar depois, a tela mostra "implantação desatualizada". Só processo aprovado e não
-- reprovado pelo Guardião; só o servidor grava. Idempotente.
ALTER TABLE public.process_designs ADD COLUMN IF NOT EXISTS implementation jsonb;
ALTER TABLE public.process_designs ADD COLUMN IF NOT EXISTS implemented_at timestamptz;

CREATE OR REPLACE FUNCTION public.service_process_implemented(org uuid, p_id uuid, p_impl jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.process_designs; g text;
BEGIN
  SELECT * INTO d FROM public.process_designs WHERE id = p_id AND organization_id = org FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'processo não encontrado nesta empresa' USING ERRCODE = '22023'; END IF;
  IF d.status <> 'aprovado' THEN RAISE EXCEPTION 'só processo aprovado pode ser implantado' USING ERRCODE = '22023'; END IF;
  SELECT status INTO g FROM public.guardian_reviews WHERE organization_id = org AND subject_type = 'processo' AND subject_id = p_id;
  IF g IS NULL OR g = 'reprovado' THEN RAISE EXCEPTION 'o Guardião precisa aprovar o processo antes da implantação' USING ERRCODE = '22023'; END IF;
  UPDATE public.process_designs
  SET implementation = coalesce(CASE WHEN jsonb_typeof(p_impl) = 'object' THEN p_impl END, '{}'::jsonb)
                       || jsonb_build_object('version', d.version, 'at', now()),
      implemented_at = now()
  WHERE id = p_id;
  PERFORM private.audit(org, 'process.implemented', p_id::text, jsonb_build_object('version', d.version), 'ai_agent', 'implementador');
END $$;
REVOKE ALL ON FUNCTION public.service_process_implemented(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_process_implemented(uuid, uuid, jsonb) TO service_role;
