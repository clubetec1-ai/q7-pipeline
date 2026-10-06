-- Achado da prova de ponta a ponta (fatia 10): o setor contado no Diagnóstico ("Certidões e pedidos a distância") nem
-- sempre tem o mesmo nome do setor cadastrado ("Certidões"). O processo ficava sem setor: sem coordenador, sem
-- atendente do setor e com o documento implantado valendo para a empresa toda. Regra: mesmo nome; senão o setor
-- cadastrado que começa o nome do Diagnóstico (ou o contrário), o de nome mais longo. Mesma regra do organograma.
-- Idempotente.
CREATE OR REPLACE FUNCTION private.dept_for_setor(org uuid, p_setor text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT id FROM public.departments d
  WHERE d.organization_id = org
    AND (lower(btrim(d.name)) = lower(btrim(p_setor))
         OR lower(btrim(p_setor)) LIKE lower(btrim(d.name)) || ' %'
         OR lower(btrim(d.name)) LIKE lower(btrim(p_setor)) || ' %')
  ORDER BY (lower(btrim(d.name)) = lower(btrim(p_setor))) DESC, char_length(d.name) DESC
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION private.dept_for_setor(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.service_process_design_save(org uuid, p_setor text, p_nome text, p_design jsonb)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE dept uuid; cur public.process_designs; rid uuid;
BEGIN
  IF jsonb_typeof(p_design) <> 'object' THEN RAISE EXCEPTION 'desenho inválido' USING ERRCODE = '22023'; END IF;
  dept := private.dept_for_setor(org, p_setor);
  SELECT * INTO cur FROM public.process_designs
  WHERE organization_id = org AND lower(setor) = lower(btrim(p_setor)) AND lower(nome) = lower(btrim(p_nome)) FOR UPDATE;
  IF cur.id IS NULL THEN
    INSERT INTO public.process_designs (organization_id, department_id, setor, nome, design)
    VALUES (org, dept, left(btrim(p_setor), 80), left(btrim(p_nome), 120), p_design) RETURNING id INTO rid;
  ELSE
    UPDATE public.process_designs
    SET design = p_design, department_id = dept, status = 'proposto', architect_note = NULL,
        version = CASE WHEN cur.status = 'aprovado' AND cur.design IS DISTINCT FROM p_design THEN cur.version + 1 ELSE cur.version END,
        approved_by = NULL, approved_at = NULL, proposed_at = now(), updated_at = now()
    WHERE id = cur.id RETURNING id INTO rid;
  END IF;
  PERFORM private.audit(org, 'process.designed', rid::text, jsonb_build_object('setor', p_setor, 'nome', p_nome), 'ai_agent', 'arquiteto');
  RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.service_process_design_save(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_process_design_save(uuid, text, text, jsonb) TO service_role;

-- Processos já desenhados sem setor ganham o setor pela mesma regra.
UPDATE public.process_designs p SET department_id = private.dept_for_setor(p.organization_id, p.setor)
WHERE p.department_id IS NULL AND private.dept_for_setor(p.organization_id, p.setor) IS NOT NULL;
