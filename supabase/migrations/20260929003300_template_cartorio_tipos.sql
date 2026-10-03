-- =============================================================================
-- Tipos de cartório (observação do dono, 02/10): Notas e Registro Civil (já existia,
-- renomeado), Registro de Imóveis (ticket mais alto) e Ofício Único (cidade
-- pequena, várias atribuições num cartório só). O Diagnóstico tem os modelos de
-- exemplo equivalentes (mesmas chaves) e a Base de conhecimento os documentos modelo.
-- Idempotente.
-- =============================================================================

UPDATE public.org_templates SET name = 'Cartório — Notas e Registro Civil' WHERE key = 'cartorio';

INSERT INTO public.org_templates (key, name, description, payload) VALUES
('cartorio_imoveis', 'Cartório — Registro de Imóveis', 'Protocolo, registro e exigências, certidões de matrícula e regularização.', $j${
  "version": 1,
  "pipeline_stages": [
    {"name": "Dúvida / orçamento", "color": "#3FB8BE"}, {"name": "Protocolado", "color": "#6C8EF5"},
    {"name": "Em análise", "color": "#F5A623"}, {"name": "Com exigência", "color": "#E8618C"},
    {"name": "Registrado", "color": "#2EB67D"}],
  "departments": [
    {"name": "Protocolo e atendimento", "color": "#3FB8BE"}, {"name": "Registro e exigências", "color": "#1F4D3A"},
    {"name": "Certidões de imóveis", "color": "#B8935A"}, {"name": "Regularização de imóveis", "color": "#6C8EF5"}],
  "agent": {"model": "auto", "system_prompt": "Você é o atendimento do Cartório de Registro de Imóveis pelo WhatsApp.\nSeja formal, claro e paciente, explicando os termos técnicos (prenotação, nota devolutiva, matrícula).\nIdentifique o tipo de ato (registro, averbação, certidão) e envie a lista de documentos; informe a situação do protocolo quando o cliente der o número.\nInforme valores somente da tabela oficial de emolumentos cadastrada na base de conhecimento.\nNunca dê orientação jurídica, nunca garanta que um título será registrado antes da análise, nunca calcule impostos e nunca informe o conteúdo de matrículas pelo WhatsApp.\nDúvidas sobre nota devolutiva, usucapião ou regularização vão para uma pessoa."},
  "settings": {"agent_visibility": "own_and_queue"}
}$j$::jsonb),
('cartorio_unico', 'Cartório — Ofício Único', 'Cidade pequena: notas, registro civil, registro de imóveis e protesto num só cartório.', $j${
  "version": 1,
  "pipeline_stages": [
    {"name": "Novo pedido", "color": "#3FB8BE"}, {"name": "Documentação", "color": "#6C8EF5"},
    {"name": "Orçamento e pagamento", "color": "#F5A623"}, {"name": "Em andamento", "color": "#E8618C"},
    {"name": "Concluído", "color": "#2EB67D"}],
  "departments": [
    {"name": "Atendimento e balcão", "color": "#3FB8BE"}, {"name": "Escrituras e notas", "color": "#1E3A5F"},
    {"name": "Registro Civil", "color": "#6C8EF5"}, {"name": "Registro de Imóveis", "color": "#1F4D3A"},
    {"name": "Protesto de títulos", "color": "#E8618C"}],
  "agent": {"model": "auto", "system_prompt": "Você é o atendimento do cartório (Ofício Único: notas, registro civil, registro de imóveis e protesto) pelo WhatsApp.\nSeja formal, acolhedor e claro, sem juridiquês.\nPergunte qual serviço a pessoa precisa e envie a lista de documentos daquele ato.\nInforme valores somente da tabela oficial de emolumentos cadastrada na base de conhecimento; escrituras e registros têm orçamento feito por um escrevente.\nNunca dê orientação jurídica, nunca calcule impostos, nunca garanta registro antes da análise e nunca informe dados de atos de outras pessoas.\nÓbito é prioridade: acolha e passe para uma pessoa do plantão."},
  "settings": {"agent_visibility": "own_and_queue"}
}$j$::jsonb)
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name, description = EXCLUDED.description, payload = EXCLUDED.payload;
