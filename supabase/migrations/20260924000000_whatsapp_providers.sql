-- =============================================================================
-- ClubeCRM — provedores de WhatsApp (Uazapi e Meta Cloud API)
-- =============================================================================
-- Introduz a noção de "provedor" por instância, para que os dois convivam:
-- um número pode atender pela Uazapi e outro pela Cloud API ao mesmo tempo.
--
-- Design: docs/superpowers/specs/2026-09-23-whatsapp-cloud-api-design.md
--
-- É IDEMPOTENTE: pode ser executado mais de uma vez sem erro.
-- =============================================================================


-- =============================================================================
-- 1. Provedor por instância
-- =============================================================================
ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS provider        text NOT NULL DEFAULT 'uazapi',
  ADD COLUMN IF NOT EXISTS phone_number_id text,
  ADD COLUMN IF NOT EXISTS waba_id         text;

COMMENT ON COLUMN public.whatsapp_instances.provider IS
  'uazapi (API não oficial) ou cloud (Meta WhatsApp Cloud API).';
COMMENT ON COLUMN public.whatsapp_instances.instance_token IS
  'Segredo da instância: token da Uazapi, ou access token permanente na Cloud API.';
COMMENT ON COLUMN public.whatsapp_instances.server_url IS
  'Só Uazapi. Na Cloud API a URL é fixa (graph.facebook.com).';

DO $$ BEGIN
  ALTER TABLE public.whatsapp_instances
    ADD CONSTRAINT whatsapp_instances_provider_check
    CHECK (provider IN ('uazapi','cloud'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Dois números Cloud não podem colidir. Parcial: linhas Uazapi têm nulo e
-- não são afetadas.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_instances_phone_number_id_key
  ON public.whatsapp_instances (phone_number_id)
  WHERE phone_number_id IS NOT NULL;


-- =============================================================================
-- 2. Janela de atendimento de 24 horas (Cloud API)
-- =============================================================================
-- Coluna própria, e não reaproveitamento de last_message_at: aquela também sobe
-- quando a IA responde, e para a janela da Meta só conta quando o CLIENTE falou.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;

COMMENT ON COLUMN public.conversations.last_inbound_at IS
  'Horário da última mensagem recebida do contato. Base da janela de 24h da Cloud API.';

-- Backfill: a última mensagem de entrada que já existe no histórico.
UPDATE public.conversations c
SET last_inbound_at = m.ultima
FROM (
  SELECT conversation_id, max(created_at) AS ultima
  FROM public.messages
  WHERE direction = 'inbound'
  GROUP BY conversation_id
) m
WHERE m.conversation_id = c.id
  AND c.last_inbound_at IS NULL;


-- =============================================================================
-- 3. Uma conversa por número, não por contato
-- =============================================================================
-- Antes: UNIQUE (user_id, contact_phone) — o mesmo contato falando no número de
-- disparo e no de atendimento caía na mesma conversa, misturando históricos e
-- confundindo o agente. Agora a conversa é escopada pela instância.

-- Guarda: só prossegue se não houver conversa órfã, que impediria o NOT NULL.
DO $$
DECLARE orfas integer;
BEGIN
  SELECT count(*) INTO orfas FROM public.conversations WHERE instance_id IS NULL;
  IF orfas > 0 THEN
    RAISE EXCEPTION
      '[clubecrm] % conversa(s) sem instance_id. Associe-as a uma instância antes de aplicar esta migration.', orfas;
  END IF;
END $$;

ALTER TABLE public.conversations ALTER COLUMN instance_id SET NOT NULL;

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_user_id_contact_phone_key;

DO $$ BEGIN
  ALTER TABLE public.conversations
    ADD CONSTRAINT conversations_user_instance_phone_key
    UNIQUE (user_id, instance_id, contact_phone);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Com instance_id obrigatório, ON DELETE SET NULL passaria a violar o NOT NULL.
-- Vira CASCADE: apagar um número apaga as conversas dele. Para preservar
-- histórico, desative a instância em vez de apagá-la.
ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_instance_id_fkey;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_instance_id_fkey
  FOREIGN KEY (instance_id) REFERENCES public.whatsapp_instances(id)
  ON DELETE CASCADE;
