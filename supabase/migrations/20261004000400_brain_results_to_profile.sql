-- =============================================================================
-- Cérebro, fatia 4 (docs/design/03-cerebro.md §2.4): o resultado volta ao Diagnóstico.
--  * link_improvement_process: liga a proposta a um processo do Diagnóstico (mesma empresa);
--  * gatilho: quando a proposta vai ao ar ou recebe resultado, o processo ganha
--    "implantacao" {melhoria_id, status, resultado, em} (não mexe em "implementar");
--  * com meta ligada, o resultado atualiza a linha de base da meta;
--  * o planejamento (interviewer → plan) passa a receber o que já foi feito e o resultado.
-- Idempotente.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.link_improvement_process(improvement uuid, process_name text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.improvements; nome text;
BEGIN
  SELECT * INTO i FROM public.improvements WHERE id = improvement FOR UPDATE;
  IF i.id IS NULL OR NOT private.has_permission(i.organization_id, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF process_name IS NOT NULL THEN
    SELECT x ->> 'nome' INTO nome FROM public.company_profiles p, jsonb_array_elements(coalesce(p.processes, '[]'::jsonb)) x
    WHERE p.organization_id = i.organization_id AND lower(btrim(x ->> 'nome')) = lower(btrim(process_name)) LIMIT 1;
    IF nome IS NULL THEN RAISE EXCEPTION 'processo não encontrado no Diagnóstico desta empresa' USING ERRCODE = '22023'; END IF;
  END IF;
  UPDATE public.improvements SET process_ref = left(nome, 120), updated_at = now() WHERE id = i.id;
  PERFORM private.audit(i.organization_id, 'improvement.process', i.id::text, jsonb_build_object('process', nome));
END $$;
REVOKE ALL ON FUNCTION public.link_improvement_process(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_improvement_process(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION private.improvement_to_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g public.area_goals;
BEGIN
  IF NEW.status NOT IN ('no_ar', 'resultado') OR (NEW.status = OLD.status AND NEW.result IS NOT DISTINCT FROM OLD.result) THEN
    RETURN NULL;
  END IF;
  IF NEW.process_ref IS NOT NULL THEN
    UPDATE public.company_profiles p SET processes = (
      SELECT jsonb_agg(CASE WHEN lower(btrim(x ->> 'nome')) = lower(btrim(NEW.process_ref))
        THEN x || jsonb_build_object('implantacao', jsonb_build_object(
               'melhoria_id', NEW.id, 'status', NEW.status, 'resultado', NEW.result, 'em', now()))
        ELSE x END ORDER BY o)
      FROM jsonb_array_elements(coalesce(p.processes, '[]'::jsonb)) WITH ORDINALITY AS t(x, o))
    WHERE p.organization_id = NEW.organization_id AND jsonb_typeof(p.processes) = 'array' AND jsonb_array_length(p.processes) > 0;
  END IF;
  IF NEW.status = 'resultado' AND NEW.goal_id IS NOT NULL THEN
    SELECT * INTO g FROM public.area_goals WHERE id = NEW.goal_id AND organization_id = NEW.organization_id;
    IF g.id IS NOT NULL THEN UPDATE public.area_goals SET baseline = private.goal_value(g), updated_at = now() WHERE id = g.id; END IF;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS improvements_to_profile ON public.improvements;
CREATE TRIGGER improvements_to_profile AFTER UPDATE OF status, result ON public.improvements
  FOR EACH ROW EXECUTE FUNCTION private.improvement_to_profile();
