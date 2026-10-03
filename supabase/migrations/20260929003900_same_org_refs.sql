-- =============================================================================
-- Varredura de segurança (03/10): referências que o navegador grava passam a
-- exigir, no próprio banco, que o registro apontado seja da MESMA organização
-- (mesmo padrão de conversations_department_fk). Antes, uma conversa podia
-- apontar para a etapa do funil, o número, a nota ou o protocolo de outra empresa
-- da qual a pessoa também participa. Os FKs simples continuam (regras de exclusão).
-- Idempotente.
-- =============================================================================

DO $$
DECLARE
  t text;
  refs text[][] := ARRAY[
    -- tabela, coluna, tabela apontada, ação ao apagar
    ARRAY['conversations',  'stage_id',        'pipeline_stages',    'SET NULL (stage_id)'],
    ARRAY['conversations',  'instance_id',     'whatsapp_instances', 'SET NULL (instance_id)'],
    ARRAY['campaigns',      'instance_id',     'whatsapp_instances', 'SET NULL (instance_id)'],
    ARRAY['followups',      'conversation_id', 'conversations',      'CASCADE'],
    ARRAY['internal_notes', 'conversation_id', 'conversations',      'CASCADE'],
    ARRAY['internal_notes', 'ticket_id',       'tickets',            'SET NULL (ticket_id)'],
    ARRAY['messages',       'conversation_id', 'conversations',      'CASCADE'],
    ARRAY['messages',       'ticket_id',       'tickets',            'SET NULL (ticket_id)'],
    ARRAY['team_messages',  'conversation_id', 'conversations',      'SET NULL (conversation_id)']
  ];
  r text[];
  fk text;
BEGIN
  -- Chave (id, organization_id) nas tabelas apontadas.
  FOREACH t IN ARRAY ARRAY['pipeline_stages', 'whatsapp_instances', 'conversations', 'tickets'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_id_org_key') THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (id, organization_id)', t, t || '_id_org_key');
    END IF;
  END LOOP;

  FOREACH r SLICE 1 IN ARRAY refs LOOP
    fk := r[1] || '_' || r[2] || '_same_org';
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I, organization_id) REFERENCES public.%I (id, organization_id) ON DELETE %s NOT VALID',
        r[1], fk, r[2], r[3], r[4]);
      EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', r[1], fk);
    END IF;
  END LOOP;
END $$;
