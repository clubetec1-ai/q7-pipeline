-- Aviso de saúde da caixa de e-mail sem repetição (relato do dono, 07/10: 18 e-mails "usuário ou senha incorretos" em 24 h
-- com a caixa funcionando). A conexão às vezes cai no meio do login e a caixa oscilava entre "com problema" e "ok"; cada
-- piora gerava aviso. Agora: o sync-email só marca problema depois de 3 falhas seguidas (login_failures) e o aviso sai no
-- máximo 1 vez a cada 12 horas por caixa. Idempotente.
ALTER TABLE public.email_accounts ADD COLUMN IF NOT EXISTS login_failures int NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION private.notify_email_health()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'disabled' THEN RETURN NULL; END IF;
  IF private.health_rank(NEW.health_status) > private.health_rank(OLD.health_status)
     AND NOT EXISTS (SELECT 1 FROM public.notifications n
                     WHERE n.organization_id = NEW.organization_id AND n.kind = 'email_health'
                       AND n.ref ->> 'account_id' = NEW.id::text AND n.created_at > now() - interval '12 hours') THEN
    INSERT INTO public.notifications (organization_id, user_id, kind, ref)
    SELECT NEW.organization_id, m.user_id, 'email_health',
           jsonb_strip_nulls(jsonb_build_object('account_id', NEW.id, 'name', NEW.name,
             'health', NEW.health_status, 'error', left(NEW.health_error, 200)))
    FROM public.organization_members m
    WHERE m.organization_id = NEW.organization_id AND m.status = 'active' AND m.role IN ('owner', 'admin');
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.notify_email_health() FROM PUBLIC, anon, authenticated;
