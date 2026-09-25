-- =============================================================================
-- ClubeCRM — modelos prontos por segmento e cadastro.
-- Spec: docs/superpowers/specs/2026-09-24-multi-tenant-equipes-design.md §6.6, §7
-- Idempotente.
-- =============================================================================

INSERT INTO public.org_templates (key, name, description, payload) VALUES
('generico', 'Genérico', 'Funil comercial simples, para qualquer negócio.', $j${
  "version": 1,
  "pipeline_stages": [
    {"name": "Novo Lead", "color": "#3FB8BE"}, {"name": "Em atendimento", "color": "#6C8EF5"},
    {"name": "Proposta", "color": "#F5A623"}, {"name": "Fechado", "color": "#2EB67D"}],
  "departments": [{"name": "Comercial", "color": "#3FB8BE"}, {"name": "Suporte", "color": "#6C8EF5"}],
  "agent": {"model": "auto", "system_prompt": "Você é o assistente de atendimento da empresa pelo WhatsApp.\nSeja cordial, objetivo e responda em português do Brasil.\nEntenda o que o cliente precisa e, se ele pedir, chame um atendente humano.\nNunca invente preços, prazos ou condições que não foram informados."},
  "settings": {"agent_visibility": "own_and_queue"}
}$j$::jsonb),
('clinica', 'Clínica e saúde', 'Agendamento de consultas e retornos.', $j${
  "version": 1,
  "pipeline_stages": [
    {"name": "Novo contato", "color": "#3FB8BE"}, {"name": "Agendamento", "color": "#6C8EF5"},
    {"name": "Consulta marcada", "color": "#F5A623"}, {"name": "Retorno", "color": "#2EB67D"}],
  "departments": [{"name": "Recepção", "color": "#3FB8BE"}, {"name": "Agendamento", "color": "#6C8EF5"}],
  "agent": {"model": "auto", "system_prompt": "Você é a recepção virtual da clínica pelo WhatsApp.\nAjude a marcar, remarcar e confirmar consultas, com cordialidade.\nNão dê orientação médica nem interprete exames: encaminhe para um atendente humano.\nNão peça dados de saúde por aqui; peça só nome e melhor horário."},
  "settings": {"agent_visibility": "own_and_queue"}
}$j$::jsonb),
('imobiliaria', 'Imobiliária', 'Captação, visitas e propostas de imóveis.', $j${
  "version": 1,
  "pipeline_stages": [
    {"name": "Novo lead", "color": "#3FB8BE"}, {"name": "Qualificação", "color": "#6C8EF5"},
    {"name": "Visita agendada", "color": "#F5A623"}, {"name": "Proposta", "color": "#E8618C"},
    {"name": "Fechado", "color": "#2EB67D"}],
  "departments": [{"name": "Vendas", "color": "#3FB8BE"}, {"name": "Locação", "color": "#6C8EF5"}],
  "agent": {"model": "auto", "system_prompt": "Você é o atendimento da imobiliária pelo WhatsApp.\nDescubra se o cliente quer comprar ou alugar, a região, o tipo de imóvel e a faixa de valor.\nOfereça agendar uma visita com um corretor.\nNão confirme disponibilidade nem valores sem um corretor."},
  "settings": {"agent_visibility": "own_and_queue"}
}$j$::jsonb),
('loja', 'Loja e varejo', 'Orçamentos, pedidos e pós-venda.', $j${
  "version": 1,
  "pipeline_stages": [
    {"name": "Novo contato", "color": "#3FB8BE"}, {"name": "Orçamento", "color": "#6C8EF5"},
    {"name": "Pedido", "color": "#F5A623"}, {"name": "Entregue", "color": "#2EB67D"}],
  "departments": [{"name": "Vendas", "color": "#3FB8BE"}, {"name": "Pós-venda", "color": "#6C8EF5"}],
  "agent": {"model": "auto", "system_prompt": "Você é o atendimento da loja pelo WhatsApp.\nAjude o cliente a encontrar o produto, tire dúvidas e monte o pedido.\nPara troca, devolução ou problema com pedido, chame um atendente humano.\nNão invente estoque, preço ou prazo de entrega."},
  "settings": {"agent_visibility": "own_and_queue"}
}$j$::jsonb),
('servicos', 'Prestação de serviços', 'Diagnóstico, orçamento e execução.', $j${
  "version": 1,
  "pipeline_stages": [
    {"name": "Novo contato", "color": "#3FB8BE"}, {"name": "Diagnóstico", "color": "#6C8EF5"},
    {"name": "Orçamento", "color": "#F5A623"}, {"name": "Execução", "color": "#E8618C"},
    {"name": "Concluído", "color": "#2EB67D"}],
  "departments": [{"name": "Comercial", "color": "#3FB8BE"}, {"name": "Operação", "color": "#6C8EF5"}],
  "agent": {"model": "auto", "system_prompt": "Você é o atendimento da empresa de serviços pelo WhatsApp.\nEntenda o problema do cliente, o local e a urgência.\nColete as informações para o orçamento e ofereça falar com um técnico.\nNão feche preço nem prazo sem um atendente humano."},
  "settings": {"agent_visibility": "own_and_queue"}
}$j$::jsonb),
('educacao', 'Escola e cursos', 'Interessados, aula experimental e matrícula.', $j${
  "version": 1,
  "pipeline_stages": [
    {"name": "Interessado", "color": "#3FB8BE"}, {"name": "Aula experimental", "color": "#6C8EF5"},
    {"name": "Matrícula", "color": "#F5A623"}, {"name": "Aluno", "color": "#2EB67D"}],
  "departments": [{"name": "Secretaria", "color": "#3FB8BE"}, {"name": "Comercial", "color": "#6C8EF5"}],
  "agent": {"model": "auto", "system_prompt": "Você é o atendimento da escola pelo WhatsApp.\nApresente os cursos, horários e como funciona a matrícula.\nOfereça agendar uma aula experimental ou visita.\nPara questões financeiras ou de alunos já matriculados, chame a secretaria."},
  "settings": {"agent_visibility": "own_and_queue"}
}$j$::jsonb)
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, payload = EXCLUDED.payload;

-- Aplica um modelo numa organização recém-criada. Depois disso tudo é editável;
-- o modelo não fica vinculado. Chaves desconhecidas são ignoradas.
CREATE OR REPLACE FUNCTION private.apply_template(org uuid, template_key text, owner_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  p jsonb;
  s record;
BEGIN
  SELECT payload INTO p FROM public.org_templates WHERE key = template_key AND active;
  IF p IS NULL THEN
    RAISE EXCEPTION 'modelo inexistente ou inativo: %', template_key USING ERRCODE = '22023';
  END IF;

  FOR s IN SELECT value, ordinality FROM jsonb_array_elements(coalesce(p -> 'pipeline_stages', '[]')) WITH ORDINALITY LOOP
    INSERT INTO public.pipeline_stages (organization_id, user_id, name, color, position)
    VALUES (org, owner_id, s.value ->> 'name', s.value ->> 'color', s.ordinality - 1);
  END LOOP;

  INSERT INTO public.departments (organization_id, name, color)
  SELECT org, d ->> 'name', d ->> 'color'
  FROM jsonb_array_elements(coalesce(p -> 'departments', '[]')) AS d
  ON CONFLICT (organization_id, name) DO NOTHING;

  IF p ? 'agent' THEN
    INSERT INTO public.agent_configs (organization_id, user_id, groq_model, system_prompt, enabled)
    VALUES (org, owner_id, coalesce(p -> 'agent' ->> 'model', 'auto'), p -> 'agent' ->> 'system_prompt', false)
    ON CONFLICT (organization_id) DO NOTHING;
  END IF;

  UPDATE public.organizations
  SET settings = coalesce(p -> 'settings', '{}'::jsonb) || settings, template_key = apply_template.template_key
  WHERE id = org;
END $$;
REVOKE ALL ON FUNCTION private.apply_template(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.apply_template(uuid, text, uuid) TO service_role;

-- Cadastro: sempre cria o perfil. Na instalação vazia (sem operador e sem
-- organização), o primeiro usuário vira operador e owner de uma organização
-- com o modelo genérico. Fora disso, entrada em organização só por convite.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE org uuid;
BEGIN
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data ->> 'full_name');

  -- Dois primeiros cadastros simultâneos não podem criar duas "primeiras" orgs.
  PERFORM pg_advisory_xact_lock(hashtext('clubecrm:bootstrap'));
  IF NOT EXISTS (SELECT 1 FROM public.platform_operators)
     AND NOT EXISTS (SELECT 1 FROM public.organizations) THEN
    INSERT INTO public.organizations (name, slug, template_key, created_by)
    VALUES (coalesce(nullif(NEW.raw_user_meta_data ->> 'company', ''), 'Minha empresa'),
            'org-' || left(md5(NEW.id::text), 10), 'generico', NEW.id)
    RETURNING id INTO org;
    INSERT INTO public.organization_members (organization_id, user_id, role, status)
    VALUES (org, NEW.id, 'owner', 'active');
    INSERT INTO public.platform_operators (user_id) VALUES (NEW.id);
    PERFORM private.apply_template(org, 'generico', NEW.id);
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
