-- Guardião de segurança e LGPD (desenho 07, fatia 5): revisão obrigatória dos desenhos de processo e dos
-- agentes do time antes de aprovar. Só regra fixa bloqueia (as regras ficam em _shared/guardian.ts); o
-- status é recalculado aqui a partir das gravidades — quem chama não escolhe. Mudou o desenho ou o time:
-- a revisão antiga é descartada. Idempotente.
CREATE TABLE IF NOT EXISTS public.guardian_reviews (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  subject_type text NOT NULL CHECK (subject_type IN ('processo', 'agente')),
  subject_id uuid NOT NULL,
  subject_version int NOT NULL DEFAULT 1,
  department_id uuid,
  status text NOT NULL CHECK (status IN ('aprovado', 'atencao', 'reprovado')),
  findings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(findings) = 'array' AND octet_length(findings::text) <= 20000),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, subject_type, subject_id)
);
ALTER TABLE public.guardian_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guardian_reviews FROM anon, authenticated;
GRANT SELECT ON public.guardian_reviews TO authenticated;
DROP POLICY IF EXISTS "ler: dono ou responsavel do setor" ON public.guardian_reviews;
CREATE POLICY "ler: dono ou responsavel do setor" ON public.guardian_reviews FOR SELECT TO authenticated
  USING (private.has_permission(organization_id, 'org.settings')
         OR (department_id IS NOT NULL AND private.can_approve_process(organization_id, department_id)));

-- Servidor: grava a revisão. O item tem que ser desta empresa; o status sai das gravidades.
CREATE OR REPLACE FUNCTION public.service_guardian_save(org uuid, p_type text, p_id uuid, p_version int, p_findings jsonb)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE dept uuid; ok boolean; clean jsonb; st text;
BEGIN
  IF p_type = 'processo' THEN
    SELECT true, department_id INTO ok, dept FROM public.process_designs WHERE id = p_id AND organization_id = org;
  ELSIF p_type = 'agente' THEN
    SELECT true, department_id INTO ok, dept FROM public.ai_agents WHERE id = p_id AND organization_id = org;
  END IF;
  IF ok IS NOT TRUE THEN RAISE EXCEPTION 'item não encontrado nesta empresa' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'regra', left(coalesce(f ->> 'regra', ''), 60),
           'gravidade', CASE WHEN f ->> 'gravidade' = 'bloqueia' THEN 'bloqueia' ELSE 'atencao' END,
           'texto', left(coalesce(f ->> 'texto', ''), 400),
           'onde', left(coalesce(f ->> 'onde', ''), 80))), '[]'::jsonb)
  INTO clean
  FROM (SELECT f FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_findings) = 'array' THEN p_findings ELSE '[]'::jsonb END) f LIMIT 30) s;
  st := CASE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(clean) f WHERE f ->> 'gravidade' = 'bloqueia') THEN 'reprovado'
             WHEN jsonb_array_length(clean) > 0 THEN 'atencao' ELSE 'aprovado' END;
  INSERT INTO public.guardian_reviews (organization_id, subject_type, subject_id, subject_version, department_id, status, findings, reviewed_at)
  VALUES (org, p_type, p_id, coalesce(p_version, 1), dept, st, clean, now())
  ON CONFLICT (organization_id, subject_type, subject_id) DO UPDATE
    SET subject_version = EXCLUDED.subject_version, department_id = EXCLUDED.department_id, status = EXCLUDED.status,
        findings = EXCLUDED.findings, reviewed_at = now();
  PERFORM private.audit(org, 'guardian.review', p_type || ':' || p_id::text, jsonb_build_object('status', st), 'ai_agent', 'guardiao');
  RETURN st;
END $$;
REVOKE ALL ON FUNCTION public.service_guardian_save(uuid, text, uuid, int, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_guardian_save(uuid, text, uuid, int, jsonb) TO service_role;

-- Desenho de processo regravado: a revisão antiga não vale mais.
CREATE OR REPLACE FUNCTION private.guardian_drop_process_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.design IS DISTINCT FROM OLD.design THEN
    DELETE FROM public.guardian_reviews WHERE organization_id = NEW.organization_id AND subject_type = 'processo' AND subject_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guardian_drop_process_review ON public.process_designs;
CREATE TRIGGER guardian_drop_process_review AFTER UPDATE OF design ON public.process_designs
  FOR EACH ROW EXECUTE FUNCTION private.guardian_drop_process_review();

-- Agente com cargo, crachá ou nível alterado: a revisão antiga não vale mais.
CREATE OR REPLACE FUNCTION private.guardian_drop_agent_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (NEW.papel, NEW.cracha, NEW.level) IS DISTINCT FROM (OLD.papel, OLD.cracha, OLD.level) THEN
    DELETE FROM public.guardian_reviews WHERE organization_id = NEW.organization_id AND subject_type = 'agente' AND subject_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guardian_drop_agent_review ON public.ai_agents;
CREATE TRIGGER guardian_drop_agent_review AFTER UPDATE OF papel, cracha, level ON public.ai_agents
  FOR EACH ROW EXECUTE FUNCTION private.guardian_drop_agent_review();

-- Aprovar processo: precisa da revisão do Guardião e não pode estar reprovado.
CREATE OR REPLACE FUNCTION public.approve_process_design(p_id uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.process_designs; g text;
BEGIN
  SELECT * INTO d FROM public.process_designs WHERE id = p_id FOR UPDATE;
  IF d.id IS NULL OR NOT private.can_approve_process(d.organization_id, d.department_id) THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  IF d.status <> 'proposto' THEN RAISE EXCEPTION 'só desenho proposto pode ser aprovado' USING ERRCODE = '22023'; END IF;
  SELECT status INTO g FROM public.guardian_reviews WHERE organization_id = d.organization_id AND subject_type = 'processo' AND subject_id = p_id;
  IF g IS NULL THEN RAISE EXCEPTION 'aguardando a revisão do Guardião de segurança' USING ERRCODE = '22023'; END IF;
  IF g = 'reprovado' THEN RAISE EXCEPTION 'o Guardião de segurança reprovou este desenho: corrija os pontos e peça o desenho de novo' USING ERRCODE = '22023'; END IF;
  UPDATE public.process_designs SET status = 'aprovado', approved_by = auth.uid(), approved_at = now(), updated_at = now() WHERE id = p_id;
  PERFORM private.audit(d.organization_id, 'process.approved', p_id::text, jsonb_build_object('version', d.version, 'guardiao', g));
END $$;
REVOKE ALL ON FUNCTION public.approve_process_design(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_process_design(uuid) TO authenticated;

-- Aprovar o time: todo agente proposto precisa da revisão do Guardião e nenhum pode estar reprovado.
CREATE OR REPLACE FUNCTION public.approve_org_chart(org uuid)
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE n int;
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.ai_agents a
             LEFT JOIN public.guardian_reviews g ON g.organization_id = a.organization_id AND g.subject_type = 'agente' AND g.subject_id = a.id
             WHERE a.organization_id = org AND a.status = 'proposto' AND (g.status IS NULL OR g.status = 'reprovado')) THEN
    RAISE EXCEPTION 'há agentes sem revisão ou reprovados pelo Guardião de segurança: atualize o time' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ai_agents SET status = 'ativo' WHERE organization_id = org AND status = 'proposto';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM private.audit(org, 'orgchart.approved', NULL, jsonb_build_object('agents', n));
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.approve_org_chart(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_org_chart(uuid) TO authenticated;
