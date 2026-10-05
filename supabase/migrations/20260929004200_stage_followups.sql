-- =============================================================================
-- Funil de vendas, 2ª parte (03/10): retorno automático por etapa.
-- Cada etapa pode ter retornos após N dias sem resposta (ex.: "Proposta enviada"
-- com 2, 5 e 10 dias), com uma orientação para a IA e, para número oficial da
-- Meta, o modelo aprovado usado fora da janela de 24h.
--  * mudou de etapa → cancela os retornos da etapa anterior e agenda os da nova;
--  * cliente respondeu → recomeça a contagem a partir da resposta;
--  * quem pediu para não receber (opt-out) nunca recebe (checado também no envio).
-- O envio é do run-followups (kind = 'auto_stage'). Idempotente.
-- =============================================================================

ALTER TABLE public.pipeline_stages ADD COLUMN IF NOT EXISTS followup_days integer[] NOT NULL DEFAULT '{}';
ALTER TABLE public.pipeline_stages ADD COLUMN IF NOT EXISTS followup_hint text;
ALTER TABLE public.pipeline_stages ADD COLUMN IF NOT EXISTS followup_template text;
ALTER TABLE public.pipeline_stages ADD COLUMN IF NOT EXISTS followup_template_lang text NOT NULL DEFAULT 'pt_BR';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_stages_followup_ck') THEN
    ALTER TABLE public.pipeline_stages ADD CONSTRAINT pipeline_stages_followup_ck CHECK (
      cardinality(followup_days) <= 5
      AND 1 <= ALL (followup_days) AND 60 >= ALL (followup_days)
      AND (followup_hint IS NULL OR char_length(followup_hint) <= 400)
      AND (followup_template IS NULL OR followup_template ~ '^[a-z0-9_]{1,100}$')
      AND followup_template_lang ~ '^[a-z]{2}(_[A-Z]{2})?$');
  END IF;
END $$;

ALTER TABLE public.followups ADD COLUMN IF NOT EXISTS stage_id uuid;
CREATE INDEX IF NOT EXISTS followups_conv_stage_pending_idx ON public.followups (conversation_id) WHERE status = 'pending' AND kind = 'auto_stage';

-- Agenda os retornos da etapa atual da conversa, contando a partir de "desde".
CREATE OR REPLACE FUNCTION private.schedule_stage_followups(conv uuid, since timestamptz)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; s record; d integer; n integer := 0;
BEGIN
  UPDATE public.followups SET status = 'cancelled', error = 'etapa mudou ou cliente respondeu', updated_at = now()
  WHERE conversation_id = conv AND kind = 'auto_stage' AND status = 'pending';

  SELECT cv.id, cv.organization_id, cv.stage_id, cv.contact_id, cv.channel INTO c FROM public.conversations cv WHERE cv.id = conv;
  IF c.id IS NULL OR c.stage_id IS NULL OR coalesce(c.channel, 'whatsapp') <> 'whatsapp' THEN RETURN 0; END IF;
  IF c.contact_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.contacts WHERE id = c.contact_id AND opted_out_at IS NOT NULL) THEN
    RETURN 0;
  END IF;
  SELECT followup_days INTO s FROM public.pipeline_stages WHERE id = c.stage_id AND organization_id = c.organization_id;
  IF s.followup_days IS NULL THEN RETURN 0; END IF;
  FOREACH d IN ARRAY s.followup_days LOOP
    INSERT INTO public.followups (organization_id, conversation_id, send_at, status, kind, stage_id)
    VALUES (c.organization_id, conv, since + make_interval(days => d), 'pending', 'auto_stage', c.stage_id);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION private.schedule_stage_followups(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.on_conversation_stage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    PERFORM private.schedule_stage_followups(NEW.id, now());
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS conversations_stage_followups ON public.conversations;
CREATE TRIGGER conversations_stage_followups AFTER INSERT OR UPDATE OF stage_id ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION private.on_conversation_stage();

-- Cliente respondeu: recomeça a contagem (só se havia retorno pendente da etapa).
CREATE OR REPLACE FUNCTION private.on_inbound_restart_stage_followups()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.direction = 'inbound' AND EXISTS (
    SELECT 1 FROM public.followups WHERE conversation_id = NEW.conversation_id AND kind = 'auto_stage' AND status = 'pending') THEN
    PERFORM private.schedule_stage_followups(NEW.conversation_id, now());
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS messages_inbound_stage_followups ON public.messages;
CREATE TRIGGER messages_inbound_stage_followups AFTER INSERT ON public.messages
  FOR EACH ROW WHEN (NEW.direction = 'inbound') EXECUTE FUNCTION private.on_inbound_restart_stage_followups();

-- Funil pronto: "Proposta enviada" já vem com retornos de 2, 5 e 10 dias (só se a etapa ainda não tiver).
CREATE OR REPLACE FUNCTION private.sales_funnel_followup_defaults(org uuid)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.pipeline_stages
  SET followup_days = '{2,5,10}',
      followup_hint = 'Retomar a proposta enviada: perguntar com gentileza se ficou alguma dúvida e oferecer uma conversa rápida. Sem pressão, sem desconto e sem inventar condições.'
  WHERE organization_id = org AND lower(name) = 'proposta enviada' AND cardinality(followup_days) = 0
$$;
REVOKE ALL ON FUNCTION private.sales_funnel_followup_defaults(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.service_install_sales_funnel(org uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb;
BEGIN
  r := private.install_sales_funnel(org);
  PERFORM private.sales_funnel_followup_defaults(org);
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.service_install_sales_funnel(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_install_sales_funnel(uuid) TO service_role;
