-- =============================================================================
-- Teste de ponta a ponta (02/10), E7 e E8:
-- - horário de atendimento sai do Diagnóstico (etapa Empresa), não do modelo;
-- - modelo "Software e suporte técnico" também na Plataforma (mesma chave do
--   modelo do Diagnóstico, que passa a abrir sozinho no modelo da empresa);
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

-- Horário de atendimento NÃO vem fixo do modelo (decisão do dono, 02/10): é
-- sugerido a partir do que o dono conta na etapa Empresa do Diagnóstico, e ele só
-- confere e ativa. Garante que nenhum modelo traga horário pronto.
UPDATE public.org_templates SET payload = payload #- '{settings,business_hours}'
WHERE payload -> 'settings' ? 'business_hours';
