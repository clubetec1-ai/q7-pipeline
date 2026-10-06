-- Organograma de IA (desenho 07, fatia 4): o time de agentes da empresa (cérebro → diretores →
-- coordenadores → especialistas → executores, mais a equipe de apoio). O servidor monta por regra
-- (_shared/orgchart.ts); o banco confere o crachá de cada agente contra o catálogo da plataforma:
-- só o executor vê a conversa e fala com o cliente; cargo sempre com "(IA)"; ninguém executa sozinho
-- antes da prova (fatia 6). Dono aprova, pausa, dá apelido e ajusta a autonomia. Toda mudança gera
-- versão. Idempotente.
CREATE OR REPLACE FUNCTION private.cracha_ok(p_level text, p_cracha jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_typeof(p_cracha) = 'object'
    AND jsonb_typeof(coalesce(p_cracha -> 'dados', '[]'::jsonb)) = 'array'
    AND jsonb_typeof(coalesce(p_cracha -> 'acoes', '[]'::jsonb)) = 'array'
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(p_cracha -> 'dados', '[]'::jsonb)) d
      WHERE d NOT IN ('numeros_agregados', 'diagnostico', 'processos', 'base_conhecimento', 'avaliacoes_anonimas', 'conversa_em_andamento'))
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(p_cracha -> 'acoes', '[]'::jsonb)) a
      WHERE a NOT IN ('delegar', 'cobrar', 'revisar', 'propor_melhoria', 'pedir_informacao', 'preparar_rascunho',
                      'responder_cliente', 'passar_para_pessoa', 'enviar_modelo', 'agendar'))
    AND (p_level = 'executor' OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(coalesce(p_cracha -> 'dados', '[]'::jsonb) || coalesce(p_cracha -> 'acoes', '[]'::jsonb)) x
      WHERE x IN ('conversa_em_andamento', 'responder_cliente', 'passar_para_pessoa', 'enviar_modelo', 'agendar')))
$$;

CREATE TABLE IF NOT EXISTS public.ai_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key ~ '^[a-z_]{2,20}(:[A-Za-z0-9_-]{1,60})?$'),
  level text NOT NULL CHECK (level IN ('cerebro', 'diretor', 'coordenador', 'especialista', 'executor', 'apoio')),
  parent_id uuid,
  papel text NOT NULL CHECK (char_length(papel) <= 120 AND papel LIKE '%(IA)'),
  apelido text CHECK (apelido IS NULL OR char_length(apelido) BETWEEN 1 AND 40),
  department_id uuid,
  process_id uuid,
  area_key text CHECK (area_key IS NULL OR area_key ~ '^[a-z_]{2,20}$'),
  cracha jsonb NOT NULL DEFAULT '{"dados":[],"acoes":[]}'::jsonb,
  autonomia text NOT NULL DEFAULT 'A1' CHECK (autonomia IN ('A0', 'A1', 'A2', 'A3', 'A4')),
  status text NOT NULL DEFAULT 'proposto' CHECK (status IN ('proposto', 'ativo', 'pausado')),
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_agents_key_uq UNIQUE (organization_id, key),
  CONSTRAINT ai_agents_id_org UNIQUE (id, organization_id),
  CONSTRAINT ai_agents_cracha_ok CHECK (private.cracha_ok(level, cracha)),
  CONSTRAINT ai_agents_a4_executor CHECK (autonomia <> 'A4' OR level = 'executor'),
  CONSTRAINT ai_agents_parent_fk FOREIGN KEY (parent_id, organization_id) REFERENCES public.ai_agents (id, organization_id) ON DELETE SET NULL (parent_id),
  CONSTRAINT ai_agents_department_fk FOREIGN KEY (department_id, organization_id) REFERENCES public.departments (id, organization_id) ON DELETE SET NULL (department_id),
  CONSTRAINT ai_agents_process_fk FOREIGN KEY (process_id, organization_id) REFERENCES public.process_designs (id, organization_id) ON DELETE CASCADE
);
ALTER TABLE public.ai_agents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_agents FROM anon, authenticated;
GRANT SELECT ON public.ai_agents TO authenticated;
DROP POLICY IF EXISTS "ler: dono ou responsavel do setor" ON public.ai_agents;
CREATE POLICY "ler: dono ou responsavel do setor" ON public.ai_agents FOR SELECT TO authenticated
  USING (private.has_permission(organization_id, 'org.settings')
         OR (department_id IS NOT NULL AND private.can_approve_process(organization_id, department_id)));

CREATE TABLE IF NOT EXISTS public.agent_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL,
  version int NOT NULL,
  snapshot jsonb NOT NULL,
  changed_by uuid,
  at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_versions_agent_fk FOREIGN KEY (agent_id, organization_id) REFERENCES public.ai_agents (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS agent_versions_agent_idx ON public.agent_versions (agent_id, version DESC);
ALTER TABLE public.agent_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_versions FROM anon, authenticated;
GRANT SELECT ON public.agent_versions TO authenticated;
DROP POLICY IF EXISTS "ler: dono" ON public.agent_versions;
CREATE POLICY "ler: dono" ON public.agent_versions FOR SELECT TO authenticated
  USING (private.has_permission(organization_id, 'org.settings'));

-- Toda mudança de cargo, crachá, autonomia, situação ou apelido vira uma versão (imutável).
CREATE OR REPLACE FUNCTION private.agent_version_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.papel, NEW.cracha, NEW.autonomia, NEW.status, NEW.apelido, NEW.parent_id)
       IS NOT DISTINCT FROM (OLD.papel, OLD.cracha, OLD.autonomia, OLD.status, OLD.apelido, OLD.parent_id) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN NEW.version := OLD.version + 1; NEW.updated_at := now(); END IF;
  INSERT INTO public.agent_versions (organization_id, agent_id, version, snapshot, changed_by)
  VALUES (NEW.organization_id, NEW.id, NEW.version,
          jsonb_build_object('papel', NEW.papel, 'apelido', NEW.apelido, 'cracha', NEW.cracha, 'autonomia', NEW.autonomia,
                             'status', NEW.status, 'parent_id', NEW.parent_id), auth.uid());
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS agent_version_snapshot_ins ON public.ai_agents;
CREATE TRIGGER agent_version_snapshot_ins AFTER INSERT ON public.ai_agents FOR EACH ROW EXECUTE FUNCTION private.agent_version_snapshot();
DROP TRIGGER IF EXISTS agent_version_snapshot_upd ON public.ai_agents;
CREATE TRIGGER agent_version_snapshot_upd BEFORE UPDATE ON public.ai_agents FOR EACH ROW EXECUTE FUNCTION private.agent_version_snapshot();

-- Servidor (cérebro, por regra): grava o time proposto. Novo nasce "proposto"; quem já existe mantém situação,
-- apelido e autonomia; o que saiu do desenho e estava em uso fica "pausado" (nunca some sem o dono ver).
CREATE OR REPLACE FUNCTION public.service_org_chart_save(org uuid, p_agents jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE it jsonb; keys text[] := '{}';
BEGIN
  IF jsonb_typeof(p_agents) <> 'array' OR jsonb_array_length(p_agents) > 300 THEN RAISE EXCEPTION 'time inválido' USING ERRCODE = '22023'; END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_agents) LOOP
    keys := keys || (it ->> 'key');
    INSERT INTO public.ai_agents (organization_id, key, level, papel, department_id, process_id, area_key, cracha, autonomia)
    VALUES (org, it ->> 'key', it ->> 'level', it ->> 'papel', nullif(it ->> 'department_id', '')::uuid, nullif(it ->> 'process_id', '')::uuid,
            nullif(it ->> 'area_key', ''), coalesce(it -> 'cracha', '{"dados":[],"acoes":[]}'::jsonb),
            CASE WHEN it ->> 'autonomia' IN ('A0', 'A1', 'A2') THEN it ->> 'autonomia' ELSE 'A1' END)
    ON CONFLICT (organization_id, key) DO UPDATE
      SET level = EXCLUDED.level, papel = EXCLUDED.papel, department_id = EXCLUDED.department_id,
          process_id = EXCLUDED.process_id, area_key = EXCLUDED.area_key, cracha = EXCLUDED.cracha;
  END LOOP;
  -- Hierarquia pela chave.
  UPDATE public.ai_agents a SET parent_id = p.id
  FROM jsonb_array_elements(p_agents) j(v) LEFT JOIN public.ai_agents p ON p.organization_id = org AND p.key = j.v ->> 'parent'
  WHERE a.organization_id = org AND a.key = j.v ->> 'key' AND a.parent_id IS DISTINCT FROM p.id;
  -- Saiu do desenho: proposto some; em uso fica pausado.
  DELETE FROM public.ai_agents WHERE organization_id = org AND status = 'proposto' AND NOT (key = ANY (keys));
  UPDATE public.ai_agents SET status = 'pausado' WHERE organization_id = org AND status = 'ativo' AND NOT (key = ANY (keys));
  PERFORM private.audit(org, 'orgchart.proposed', NULL, jsonb_build_object('agents', array_length(keys, 1)), 'ai_agent', 'cerebro');
  RETURN jsonb_build_object('agents', array_length(keys, 1),
    'propostos', (SELECT count(*) FROM public.ai_agents WHERE organization_id = org AND status = 'proposto'));
END $$;
REVOKE ALL ON FUNCTION public.service_org_chart_save(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_org_chart_save(uuid, jsonb) TO service_role;

-- Dono: aprovar o time proposto.
CREATE OR REPLACE FUNCTION public.approve_org_chart(org uuid)
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE n int;
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  UPDATE public.ai_agents SET status = 'ativo' WHERE organization_id = org AND status = 'proposto';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM private.audit(org, 'orgchart.approved', NULL, jsonb_build_object('agents', n));
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.approve_org_chart(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_org_chart(uuid) TO authenticated;

-- Dono: ligar ou pausar um agente.
CREATE OR REPLACE FUNCTION public.set_agent_status(p_id uuid, p_status text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.ai_agents;
BEGIN
  SELECT * INTO a FROM public.ai_agents WHERE id = p_id FOR UPDATE;
  IF a.id IS NULL OR NOT private.has_permission(a.organization_id, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('ativo', 'pausado') THEN RAISE EXCEPTION 'situação inválida' USING ERRCODE = '22023'; END IF;
  UPDATE public.ai_agents SET status = p_status WHERE id = p_id;
  PERFORM private.audit(a.organization_id, 'agent.status', a.key, jsonb_build_object('status', p_status));
END $$;
REVOKE ALL ON FUNCTION public.set_agent_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_agent_status(uuid, text) TO authenticated;

-- Dono: apelido opcional (o cargo com "(IA)" continua aparecendo junto).
CREATE OR REPLACE FUNCTION public.set_agent_label(p_id uuid, p_apelido text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.ai_agents; v text := nullif(btrim(coalesce(p_apelido, '')), '');
BEGIN
  SELECT * INTO a FROM public.ai_agents WHERE id = p_id FOR UPDATE;
  IF a.id IS NULL OR NOT private.has_permission(a.organization_id, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF char_length(coalesce(v, '')) > 40 THEN RAISE EXCEPTION 'apelido com até 40 letras' USING ERRCODE = '22023'; END IF;
  UPDATE public.ai_agents SET apelido = v WHERE id = p_id;
  PERFORM private.audit(a.organization_id, 'agent.label', a.key, '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.set_agent_label(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_agent_label(uuid, text) TO authenticated;

-- Dono: autonomia. Por enquanto só até A2 (prepara rascunho): executar exige a prova (fatia 6) e os degraus (fatia 7).
CREATE OR REPLACE FUNCTION public.set_agent_autonomy(p_id uuid, p_autonomia text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.ai_agents;
BEGIN
  SELECT * INTO a FROM public.ai_agents WHERE id = p_id FOR UPDATE;
  IF a.id IS NULL OR NOT private.has_permission(a.organization_id, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  IF p_autonomia NOT IN ('A0', 'A1', 'A2') THEN
    RAISE EXCEPTION 'executar (A3/A4) só depois que o agente passar na prova dos cenários de teste' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ai_agents SET autonomia = p_autonomia WHERE id = p_id;
  PERFORM private.audit(a.organization_id, 'agent.autonomy', a.key, jsonb_build_object('autonomia', p_autonomia));
END $$;
REVOKE ALL ON FUNCTION public.set_agent_autonomy(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_agent_autonomy(uuid, text) TO authenticated;
