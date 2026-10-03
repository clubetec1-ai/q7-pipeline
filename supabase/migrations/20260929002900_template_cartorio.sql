-- =============================================================================
-- Modelo "Cartório" (pedido em 02/10): nicho de ticket maior, para a Clubetec
-- criar a empresa já com funil, setores e agente de atendimento do cartório.
-- O Diagnóstico tem o modelo de exemplos equivalente (src/pages/diagnostico/templates.ts).
-- Idempotente.
-- =============================================================================

INSERT INTO public.org_templates (key, name, description, payload) VALUES
('cartorio', 'Cartório', 'Notas, registro civil, certidões e pedidos a distância.', $j${
  "version": 1,
  "pipeline_stages": [
    {"name": "Novo pedido", "color": "#3FB8BE"}, {"name": "Documentação", "color": "#6C8EF5"},
    {"name": "Orçamento e pagamento", "color": "#F5A623"}, {"name": "Assinatura agendada", "color": "#E8618C"},
    {"name": "Ato concluído", "color": "#2EB67D"}],
  "departments": [
    {"name": "Atendimento e balcão", "color": "#3FB8BE"}, {"name": "Escrituras e notas", "color": "#1E3A5F"},
    {"name": "Registro Civil", "color": "#6C8EF5"}, {"name": "Certidões", "color": "#B8935A"}],
  "agent": {"model": "auto", "system_prompt": "Você é o atendimento do cartório pelo WhatsApp.\nSeja formal, acolhedor e claro, sem juridiquês.\nPergunte qual serviço a pessoa precisa e envie a lista de documentos daquele ato.\nInforme valores somente da tabela oficial de emolumentos cadastrada na base de conhecimento; escrituras, inventários, divórcios e testamentos têm orçamento feito por um escrevente.\nNunca dê orientação jurídica, nunca calcule impostos (ITBI/ITCMD) e nunca informe dados de atos de outras pessoas.\nÓbito é prioridade: acolha e passe para uma pessoa do plantão."},
  "settings": {"agent_visibility": "own_and_queue"}
}$j$::jsonb)
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, payload = EXCLUDED.payload;
