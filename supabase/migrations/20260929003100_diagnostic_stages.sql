-- =============================================================================
-- Correção (teste de ponta a ponta com o Cartório Teste, 02/10): as etapas novas
-- do Diagnóstico 3.0 (clientes, marca, regras) não estavam na lista permitida de
-- company_profiles.stage. Aprovar a etapa Empresa (que leva para "clientes")
-- era recusado pelo banco (erro 400) e nenhuma empresa nova passava do 1º passo.
-- Mesmas regras de tamanho de antes. Idempotente.
-- =============================================================================

ALTER TABLE public.company_profiles DROP CONSTRAINT IF EXISTS company_profiles_stage_check;
ALTER TABLE public.company_profiles ADD CONSTRAINT company_profiles_stage_check CHECK (
  stage IN ('empresa', 'clientes', 'marca', 'cultura', 'situacao', 'objetivos', 'setores', 'processos', 'regras', 'plano')
  AND pg_column_size(public_research) < 50000 AND pg_column_size(plan) < 200000
);
