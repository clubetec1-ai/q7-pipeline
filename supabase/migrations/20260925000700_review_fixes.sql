-- =============================================================================
-- ClubeCRM — correções da revisão de segurança da etapa 1B.
-- Idempotente.
-- =============================================================================

-- Operador da plataforma não lê dados de organizações só por ser operador
-- (spec §5.1): precisa de acesso de suporte, que is_member já considera.
-- A listagem da tela Plataforma sai pela Edge Function platform-orgs (1C).
DROP POLICY IF EXISTS "org: ver" ON public.organizations;
CREATE POLICY "org: ver" ON public.organizations FOR SELECT TO authenticated
  USING (private.is_member(id));

-- O segredo do webhook da Uazapi vai para o Vault (instance:<id>:webhook),
-- não para uma coluna que todo membro da organização consegue ler. A coluna
-- foi criada vazia nesta etapa e ainda não era usada.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'whatsapp_instances'
               AND column_name = 'webhook_secret') THEN
    IF EXISTS (SELECT 1 FROM public.whatsapp_instances WHERE webhook_secret IS NOT NULL) THEN
      RAISE EXCEPTION 'webhook_secret tem valores: migrar para o Vault antes de remover a coluna';
    END IF;
    ALTER TABLE public.whatsapp_instances DROP COLUMN webhook_secret;
  END IF;
END $$;

-- Um usuário pode ser owner de mais de uma organização: a configuração da IA
-- é única por organização (chave primária), não por usuário.
ALTER TABLE public.agent_configs DROP CONSTRAINT IF EXISTS agent_configs_user_id_key;
