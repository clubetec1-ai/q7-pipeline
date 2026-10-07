-- =============================================================================
-- Q7 Pipeline — agendamento dos follow-ups automáticos
-- =============================================================================
-- A cada minuto, o banco confere se há retorno vencido e só então chama a edge function `run-followups`.
-- Bônus: mantém o projeto Free "ativo" (projetos Free pausam após 7 dias parados).
--
-- ANTES DE EXECUTAR, substitua o placeholder:
--   <PROJECT_REF>  → o ref do seu projeto Supabase (ex.: abcdwxyz1234)
--
-- A função só aceita chamadas com o cabeçalho x-cron-secret, lido do Vault
-- (segredo platform:cron_secret, criado pela migration 20260926000100). Nenhuma
-- chave fica escrita no texto do job.
--
-- Pré-requisito: extensões pg_cron e pg_net habilitadas
-- (Database > Extensions no painel do Supabase).
--
-- É idempotente: pode rodar de novo que ele reagenda em vez de duplicar.
-- =============================================================================

-- Remove um agendamento anterior, se existir (evita jobs duplicados)
DO $$
BEGIN
  PERFORM cron.unschedule('run-followups-every-minute');
EXCEPTION WHEN OTHERS THEN
  NULL; -- não existia ainda, tudo bem
END $$;

-- Endereço das funções (as rotinas do banco leem daqui).
INSERT INTO public.app_settings (key, value)
VALUES ('functions_base_url', 'https://<PROJECT_REF>.supabase.co/functions/v1')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- A rotina só chama a função quando há retorno vencido (private.run_followups_tick, migration 20261006003300):
-- não gasta a cota de chamadas das funções à toa.
SELECT cron.schedule('run-followups-every-minute', '* * * * *', 'SELECT private.run_followups_tick()');

-- Conferir se ficou ativo (esperado: 1 linha, schedule '* * * * *', active = true):
--   SELECT jobid, jobname, schedule, active FROM cron.job;
--
-- Ver as últimas execuções:
--   SELECT status, return_message, start_time
--   FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
--
-- Para remover depois:
--   SELECT cron.unschedule('run-followups-every-minute');
