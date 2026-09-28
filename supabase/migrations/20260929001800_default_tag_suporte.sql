-- =============================================================================
-- Etiqueta padrão "Não incomodar" trocada por "Suporte" (pedido em 29/09).
-- Nas empresas atuais, renomeia a padrão (se ainda não houver "Suporte").
-- Idempotente.
-- =============================================================================

-- Etiquetas padrão.
CREATE OR REPLACE FUNCTION private.seed_default_tags(org uuid)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer;
BEGIN
  INSERT INTO public.tags (organization_id, name, color, icon, is_default)
  SELECT org, d.name, d.color, d.icon, true FROM (VALUES
    ('VIP', '#F59E0B', 'crown'),
    ('Novo cliente', '#3FB8BE', 'star'),
    ('Retornar contato', '#6C8EF5', 'clock'),
    ('Urgente', '#EF4444', 'alert-triangle'),
    ('Reclamação', '#EC4899', 'flag'),
    ('Orçamento enviado', '#8B5CF6', 'briefcase'),
    ('Aguardando pagamento', '#F59E0B', 'dollar-sign'),
    ('Pedido em andamento', '#10B981', 'truck'),
    ('Suporte', '#64748B', 'wrench')
  ) AS d(name, color, icon)
  ON CONFLICT (organization_id, name) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
UPDATE public.tags t SET name = 'Suporte', color = '#64748B', icon = 'wrench'
WHERE t.is_default AND t.name = 'Não incomodar'
  AND NOT EXISTS (SELECT 1 FROM public.tags s WHERE s.organization_id = t.organization_id AND s.name = 'Suporte');
-- Onde "Suporte" já existia (criada à mão): a padrão "Não incomodar" sai se ninguém a usa.
DELETE FROM public.tags t
WHERE t.is_default AND t.name = 'Não incomodar'
  AND NOT EXISTS (SELECT 1 FROM public.contact_tags ct WHERE ct.tag_id = t.id);
