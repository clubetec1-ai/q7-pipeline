-- =============================================================================
-- Teste de ponta a ponta (02/10), E7 e E8:
-- - todo modelo de empresa traz o horário de atendimento padrão (empresa nova não
--   começa "fechada" para o bloco Horário); cartório 9h–17h, os demais 8h–18h, seg–sex;
-- - modelo "Software e suporte técnico" também na Plataforma (mesma chave do
--   modelo do Diagnóstico, que passa a abrir sozinho no modelo da empresa);
-- - empresas já criadas com modelo e sem horário recebem o horário do modelo.
-- Idempotente.
-- =============================================================================

INSERT INTO public.org_templates (key, name, description, payload) VALUES
('software', 'Software e suporte técnico', 'Vendas, implantação, suporte e sucesso do cliente de empresas de software e TI.', $j${
  "version": 1,
  "pipeline_stages": [
    {"name": "Novo lead", "color": "#3FB8BE"}, {"name": "Diagnóstico", "color": "#6C8EF5"},
    {"name": "Demonstração", "color": "#F5A623"}, {"name": "Proposta", "color": "#E8618C"},
    {"name": "Teste grátis", "color": "#8B5CF6"}, {"name": "Cliente", "color": "#2EB67D"}],
  "departments": [
    {"name": "Vendas", "color": "#3FB8BE"}, {"name": "Suporte técnico", "color": "#6C8EF5"},
    {"name": "Implantação e treinamento", "color": "#F5A623"}, {"name": "Financeiro e administrativo", "color": "#2EB67D"}],
  "agent": {"model": "auto", "system_prompt": "Você é o atendimento da empresa de software pelo WhatsApp.\nPara quem ainda não é cliente: entenda o tipo de empresa, quantos atendentes e o principal problema, e ofereça o diagnóstico gratuito ou uma demonstração.\nPara clientes: identifique o problema e oriente o passo a passo com a base de conhecimento; se não resolver em 2 tentativas, abra o chamado e passe para o suporte.\nNunca dê desconto, nunca prometa funcionalidade ou prazo e nunca peça senha ou código de verificação."},
  "settings": {"agent_visibility": "own_and_queue"}
}$j$::jsonb)
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, payload = EXCLUDED.payload;

-- Horário padrão em todos os modelos.
UPDATE public.org_templates
SET payload = jsonb_set(payload, '{settings,business_hours}',
  CASE WHEN key = 'cartorio'
    THEN '{"1":[{"start":"09:00","end":"17:00"}],"2":[{"start":"09:00","end":"17:00"}],"3":[{"start":"09:00","end":"17:00"}],"4":[{"start":"09:00","end":"17:00"}],"5":[{"start":"09:00","end":"17:00"}]}'::jsonb
    ELSE '{"1":[{"start":"08:00","end":"18:00"}],"2":[{"start":"08:00","end":"18:00"}],"3":[{"start":"08:00","end":"18:00"}],"4":[{"start":"08:00","end":"18:00"}],"5":[{"start":"08:00","end":"18:00"}]}'::jsonb
  END, true)
WHERE payload ? 'settings';

-- Empresas já criadas com modelo e ainda sem horário.
UPDATE public.organizations o
SET settings = coalesce(o.settings, '{}'::jsonb) || jsonb_build_object('business_hours', t.payload -> 'settings' -> 'business_hours')
FROM public.org_templates t
WHERE t.key = o.template_key AND NOT (coalesce(o.settings, '{}'::jsonb) ? 'business_hours')
  AND t.payload -> 'settings' ? 'business_hours';
