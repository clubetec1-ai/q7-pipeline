-- =============================================================================
-- 1) IA da Clubetec: cada posição guarda quando funcionou por último (teste ou uso
--    real), para a tela mostrar verde (funcionando) ou vermelho (com falha).
-- 2) Monitor de saúde da empresa (pedido em 03/10, agente do dia 1): uma lista do
--    que precisa de atenção — números, e-mails, IA, fila parada, fluxos com erro,
--    ramais — com o caminho da tela para corrigir. Só dono/admin (org.settings).
-- Idempotente.
-- =============================================================================

ALTER TABLE public.platform_ai_slots ADD COLUMN IF NOT EXISTS last_ok_at timestamptz;

CREATE OR REPLACE FUNCTION public.service_ai_slot_ok(slot_name text)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.platform_ai_slots SET last_ok_at = now()
  WHERE slot = slot_name AND (last_ok_at IS NULL OR last_ok_at < now() - interval '10 minutes'
                              OR (last_error_at IS NOT NULL AND last_error_at > last_ok_at))
$$;
REVOKE ALL ON FUNCTION public.service_ai_slot_ok(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_ai_slot_ok(text) TO service_role;

CREATE OR REPLACE FUNCTION public.platform_ai_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'apenas operadores da plataforma' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'slot', s.slot, 'provider', s.provider, 'model', s.model,
      'has_key', EXISTS (SELECT 1 FROM vault.secrets v WHERE v.name = 'platform:ai:' || s.slot),
      'last_error', s.last_error, 'last_error_at', s.last_error_at, 'last_ok_at', s.last_ok_at, 'updated_at', s.updated_at)
    ORDER BY array_position(ARRAY['principal', 'reserva1', 'reserva2'], s.slot))
    FROM public.platform_ai_slots s), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.platform_ai_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_ai_status() TO authenticated;

-- Saúde da empresa: cada item com ok, detalhe e a tela para corrigir.
CREATE OR REPLACE FUNCTION public.org_health(org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  n_num int; n_mail int; n_queue int; n_flow int; n_ext int;
  agent_on boolean; own_key boolean; plat boolean;
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO n_num FROM public.whatsapp_instances WHERE organization_id = org AND health_status = 'critical';
  SELECT count(*) INTO n_mail FROM public.email_accounts WHERE organization_id = org AND status = 'active' AND health_status = 'critical';
  SELECT count(*) INTO n_queue FROM public.tickets
    WHERE organization_id = org AND status = 'queued' AND assigned_to IS NULL
      AND coalesce(queued_at, created_at) < now() - interval '30 minutes';
  SELECT count(*) INTO n_flow FROM public.flow_runs
    WHERE organization_id = org AND state = 'error' AND started_at > now() - interval '24 hours';
  SELECT count(*) INTO n_ext FROM public.pbx_extensions WHERE organization_id = org AND reg_state = 'error';
  SELECT coalesce(bool_or(enabled), false) INTO agent_on FROM public.agent_configs WHERE organization_id = org;
  own_key := EXISTS (SELECT 1 FROM vault.secrets WHERE name LIKE 'org:' || org || ':%_api_key');
  plat := coalesce((SELECT (settings->>'ai_platform')::boolean FROM public.organizations WHERE id = org), true)
          AND (EXISTS (SELECT 1 FROM public.platform_ai_slots s JOIN vault.secrets v ON v.name = 'platform:ai:' || s.slot)
               OR EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'platform:groq_api_key'));
  RETURN jsonb_build_array(
    jsonb_build_object('key', 'whatsapp', 'label', 'Números de WhatsApp', 'ok', n_num = 0, 'path', '/numeros',
      'detail', CASE WHEN n_num = 0 THEN 'Todos funcionando' ELSE n_num || ' número(s) com problema (desconectado ou token inválido)' END),
    jsonb_build_object('key', 'email', 'label', 'Caixas de e-mail', 'ok', n_mail = 0, 'path', '/numeros',
      'detail', CASE WHEN n_mail = 0 THEN 'Todas funcionando' ELSE n_mail || ' caixa(s) sem conseguir ler ou enviar' END),
    jsonb_build_object('key', 'ia', 'label', 'Inteligência artificial', 'ok', NOT agent_on OR own_key OR plat, 'path', '/configuracoes/ia',
      'detail', CASE WHEN NOT agent_on THEN 'Agente desligado' WHEN own_key OR plat THEN 'IA disponível' ELSE 'Agente ligado, mas sem IA configurada' END),
    jsonb_build_object('key', 'fila', 'label', 'Fila de atendimento', 'ok', n_queue = 0, 'path', '/supervisor',
      'detail', CASE WHEN n_queue = 0 THEN 'Ninguém esperando há mais de 30 min' ELSE n_queue || ' cliente(s) esperando há mais de 30 min' END),
    jsonb_build_object('key', 'fluxos', 'label', 'Fluxos', 'ok', n_flow = 0, 'path', '/fluxos',
      'detail', CASE WHEN n_flow = 0 THEN 'Sem erros nas últimas 24 h' ELSE n_flow || ' execução(ões) com erro nas últimas 24 h' END),
    jsonb_build_object('key', 'ramais', 'label', 'Ramais', 'ok', n_ext = 0, 'path', '/equipe?tab=ramais',
      'detail', CASE WHEN n_ext = 0 THEN 'Sem erro de registro' ELSE n_ext || ' ramal(is) com erro de registro na central' END)
  );
END $$;
REVOKE ALL ON FUNCTION public.org_health(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_health(uuid) TO authenticated;
