-- =============================================================================
-- Diagnóstico: as etapas da 2ª parte (posvenda, sistemas, publicar) entram na lista de
-- company_profiles.stage. Sem isso, aprovar "Clientes e jornada" (próxima: Pós-venda) ou
-- "Hoje e números de partida" (próxima: Sistemas e dados) era recusado
-- ("violates check constraint company_profiles_stage_check").
-- A lista acompanha STEPS em src/pages/Diagnostico.tsx. Idempotente.
-- =============================================================================
ALTER TABLE public.company_profiles DROP CONSTRAINT IF EXISTS company_profiles_stage_check;
ALTER TABLE public.company_profiles ADD CONSTRAINT company_profiles_stage_check CHECK (
  stage IN ('empresa', 'clientes', 'posvenda', 'marca', 'cultura', 'situacao', 'sistemas', 'objetivos', 'setores',
            'processos', 'regras', 'publicar', 'plano')
  AND pg_column_size(public_research) < 50000 AND pg_column_size(plan) < 200000
);
