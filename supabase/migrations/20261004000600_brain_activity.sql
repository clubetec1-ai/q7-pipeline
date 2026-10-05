-- =============================================================================
-- Cérebro, fatia 7 (docs/design/03-cerebro.md §2.5): "o que cada área fez".
-- Linha do tempo de uma área a partir da auditoria (propostas, aprovações, no ar,
-- resultados, cobranças, metas e mudanças da área). Só ação, data, título e o nome de
-- exibição de quem fez — nada de conteúdo de conversa. Dono vê qualquer área; o
-- responsável, só as suas. Idempotente.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.area_activity(org uuid, area uuid, since timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.org_areas a WHERE a.id = area AND a.organization_id = org) THEN
    RAISE EXCEPTION 'área não encontrada' USING ERRCODE = '42501';
  END IF;
  IF NOT (private.has_permission(org, 'org.settings') OR private.is_area_approver(area)) THEN
    RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(x ORDER BY (x ->> 'at') DESC) FROM (
    SELECT jsonb_build_object(
      'action', l.action, 'at', l.created_at,
      'title', left(coalesce(i.title, g.title, a.name, ''), 160),
      'who', CASE WHEN l.actor_type = 'ai_agent' THEN 'Cérebro' WHEN l.actor_type = 'system' THEN 'Sistema'
                  ELSE coalesce(nullif(m.display_name, ''), 'Equipe') END) AS x
    FROM public.audit_log l
    LEFT JOIN public.improvements i ON i.organization_id = org AND i.id::text = l.target
    LEFT JOIN public.area_goals g ON g.organization_id = org AND g.id::text = l.target
    LEFT JOIN public.org_areas a ON a.organization_id = org AND a.id::text = l.target
    LEFT JOIN public.organization_members m ON m.organization_id = org AND m.user_id = l.actor_id
    WHERE l.organization_id = org AND l.created_at >= coalesce(since, now() - interval '60 days')
      AND (l.action LIKE 'improvement.%' OR l.action LIKE 'brain.%' OR l.action LIKE 'goal.%' OR l.action LIKE 'area.%')
      AND (i.area_id = area OR g.area_id = area OR a.id = area)
    ORDER BY l.created_at DESC LIMIT 100) t), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.area_activity(uuid, uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.area_activity(uuid, uuid, timestamptz) TO authenticated;
