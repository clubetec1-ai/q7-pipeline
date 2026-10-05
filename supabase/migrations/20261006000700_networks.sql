-- =============================================================================
-- Rede de franquias, white label e implantação como pacote (Fase 3, item 17).
-- Desenho: docs/design/06-franquias-white-label.md.
--  * Unidade = empresa separada (isolamento como sempre); entra por código (consentimento).
--  * Matriz vê só números somados por unidade; publica o padrão (configuração, nunca dados).
--  * White label: marca da rede (definida pela Clubetec) para todos da rede.
--  * Implantação: números de partida guardados para o "antes × depois".
-- Idempotente.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.networks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 80),
  hq_org_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  brand jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.network_units (
  network_id uuid NOT NULL REFERENCES public.networks(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  applied_version integer NOT NULL DEFAULT 0,
  PRIMARY KEY (network_id, organization_id)
);
CREATE TABLE IF NOT EXISTS public.network_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network_id uuid NOT NULL REFERENCES public.networks(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  hint text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  used_at timestamptz,
  used_by_org uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.network_standards (
  network_id uuid NOT NULL REFERENCES public.networks(id) ON DELETE CASCADE,
  version integer NOT NULL,
  payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 200000),
  mandatory boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (network_id, version)
);

-- Quem é da matriz (gestão) / quem é da rede.
CREATE OR REPLACE FUNCTION private.is_network_hq(net uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.networks n WHERE n.id = net AND private.has_permission(n.hq_org_id, 'org.settings'))
$$;
CREATE OR REPLACE FUNCTION private.in_network(net uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.networks n WHERE n.id = net AND private.is_member(n.hq_org_id))
      OR EXISTS (SELECT 1 FROM public.network_units u WHERE u.network_id = net AND private.is_member(u.organization_id))
$$;
REVOKE ALL ON FUNCTION private.is_network_hq(uuid), private.in_network(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_network_hq(uuid), private.in_network(uuid) TO authenticated;

ALTER TABLE public.networks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.network_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.network_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.network_standards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.networks, public.network_units, public.network_invites, public.network_standards FROM anon, authenticated;
GRANT SELECT ON public.networks, public.network_units, public.network_standards TO authenticated;
GRANT SELECT (id, network_id, hint, expires_at, used_at, used_by_org, created_at) ON public.network_invites TO authenticated;
GRANT ALL ON public.networks, public.network_units, public.network_invites, public.network_standards TO service_role;
DROP POLICY IF EXISTS "rede: ver" ON public.networks;
CREATE POLICY "rede: ver" ON public.networks FOR SELECT TO authenticated USING (private.in_network(id) OR private.is_platform_operator());
DROP POLICY IF EXISTS "rede: unidades" ON public.network_units;
CREATE POLICY "rede: unidades" ON public.network_units FOR SELECT TO authenticated
  USING (private.is_network_hq(network_id) OR private.is_member(organization_id) OR private.is_platform_operator());
DROP POLICY IF EXISTS "rede: convites" ON public.network_invites;
CREATE POLICY "rede: convites" ON public.network_invites FOR SELECT TO authenticated USING (private.is_network_hq(network_id));
DROP POLICY IF EXISTS "rede: padrao" ON public.network_standards;
CREATE POLICY "rede: padrao" ON public.network_standards FOR SELECT TO authenticated USING (
  private.is_network_hq(network_id)
  OR EXISTS (SELECT 1 FROM public.network_units u WHERE u.network_id = network_standards.network_id
             AND private.has_permission(u.organization_id, 'org.settings')));

-- ------------------------------------------------------------- Clubetec
CREATE OR REPLACE FUNCTION public.platform_create_network(hq uuid, p_name text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE nid uuid;
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'só a Clubetec cria redes' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.network_units WHERE organization_id = hq) THEN
    RAISE EXCEPTION 'essa empresa já é unidade de uma rede' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.networks (name, hq_org_id) VALUES (btrim(p_name), hq) RETURNING id INTO nid;
  PERFORM private.audit(hq, 'network.created', nid::text, jsonb_build_object('name', btrim(p_name)));
  RETURN nid;
END $$;

-- White label: nome do produto (2–40), logo (caminho no bucket brand da matriz) e cores #RRGGBB.
CREATE OR REPLACE FUNCTION public.platform_set_network_brand(net uuid, p_brand jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE b jsonb := '{}'::jsonb; hq uuid;
BEGIN
  IF NOT private.is_platform_operator() THEN RAISE EXCEPTION 'só a Clubetec muda a marca da rede' USING ERRCODE = '42501'; END IF;
  SELECT hq_org_id INTO hq FROM public.networks WHERE id = net;
  IF hq IS NULL THEN RAISE EXCEPTION 'rede não encontrada' USING ERRCODE = 'P0002'; END IF;
  IF char_length(btrim(coalesce(p_brand ->> 'app_name', ''))) BETWEEN 2 AND 40 THEN b := b || jsonb_build_object('app_name', btrim(p_brand ->> 'app_name')); END IF;
  IF coalesce(p_brand ->> 'primary', '') ~ '^#[0-9A-Fa-f]{6}$' THEN b := b || jsonb_build_object('primary', p_brand ->> 'primary'); END IF;
  IF coalesce(p_brand ->> 'secondary', '') ~ '^#[0-9A-Fa-f]{6}$' THEN b := b || jsonb_build_object('secondary', p_brand ->> 'secondary'); END IF;
  IF coalesce(p_brand ->> 'logo', '') LIKE hq::text || '/%' AND char_length(p_brand ->> 'logo') <= 300 THEN
    b := b || jsonb_build_object('logo', p_brand ->> 'logo');
  END IF;
  UPDATE public.networks SET brand = b WHERE id = net;
  PERFORM private.audit(hq, 'network.brand', net::text, b);
END $$;
REVOKE ALL ON FUNCTION public.platform_create_network(uuid, text), public.platform_set_network_brand(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_create_network(uuid, text), public.platform_set_network_brand(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------- matriz
-- Código de convite (uso único, 7 dias). Só o hash fica guardado; o código aparece uma vez.
CREATE OR REPLACE FUNCTION public.network_invite(net uuid)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE code text := 'REDE-' || upper(encode(extensions.gen_random_bytes(5), 'hex')); hq uuid;
BEGIN
  IF NOT private.is_network_hq(net) THEN RAISE EXCEPTION 'só a matriz convida' USING ERRCODE = '42501'; END IF;
  IF (SELECT count(*) FROM public.network_invites WHERE network_id = net AND used_at IS NULL AND expires_at > now()) >= 50 THEN
    RAISE EXCEPTION 'muitos convites abertos; espere usarem ou vencerem' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.network_invites (network_id, code_hash, hint)
  VALUES (net, encode(extensions.digest(code, 'sha256'), 'hex'), right(code, 4));
  SELECT hq_org_id INTO hq FROM public.networks WHERE id = net;
  PERFORM private.audit(hq, 'network.invite', net::text, jsonb_build_object('hint', right(code, 4)));
  RETURN code;
END $$;

CREATE OR REPLACE FUNCTION public.network_remove_unit(net uuid, unit uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE hq uuid;
BEGIN
  IF NOT private.is_network_hq(net) THEN RAISE EXCEPTION 'só a matriz remove unidades' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.network_units WHERE network_id = net AND organization_id = unit;
  SELECT hq_org_id INTO hq FROM public.networks WHERE id = net;
  PERFORM private.audit(hq, 'network.remove_unit', unit::text, '{}'::jsonb);
END $$;

-- Números de uma empresa no período (só contagens e médias; nada de cliente).
CREATE OR REPLACE FUNCTION private.org_metrics(org uuid, s timestamptz, u timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'conversas_novas', (SELECT count(*) FROM public.conversations c WHERE c.organization_id = org AND c.created_at >= s AND c.created_at < u),
    'finalizados', (SELECT count(*) FROM public.tickets t WHERE t.organization_id = org AND t.closed_at >= s AND t.closed_at < u),
    'resposta_min', (SELECT round((avg(extract(epoch FROM (t.first_response_at - coalesce(t.queued_at, t.opened_at)))) / 60)::numeric, 1)
                     FROM public.tickets t WHERE t.organization_id = org AND t.opened_at >= s AND t.opened_at < u
                       AND t.first_response_at IS NOT NULL AND t.first_response_at >= coalesce(t.queued_at, t.opened_at)),
    'avaliacoes', (SELECT count(*) FROM public.tickets t WHERE t.organization_id = org AND t.closed_at >= s AND t.closed_at < u AND t.rating IS NOT NULL),
    'nota_media', (SELECT round(avg(t.rating)::numeric, 1) FROM public.tickets t WHERE t.organization_id = org AND t.closed_at >= s AND t.closed_at < u AND t.rating IS NOT NULL))
$$;
REVOKE ALL ON FUNCTION private.org_metrics(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

-- Painel da rede: uma linha por unidade, só números.
CREATE OR REPLACE FUNCTION public.network_dashboard(net uuid, since timestamptz, until timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s timestamptz := least(since, until); u timestamptz := greatest(since, until);
BEGIN
  IF NOT private.is_network_hq(net) THEN RAISE EXCEPTION 'só a matriz vê o painel da rede' USING ERRCODE = '42501'; END IF;
  IF u - s > interval '366 days' THEN s := u - interval '366 days'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('unidade', o.name, 'organization_id', o.id, 'desde', nu.joined_at,
            'versao_padrao', nu.applied_version) || private.org_metrics(o.id, s, u) ORDER BY o.name), '[]'::jsonb)
          FROM public.network_units nu JOIN public.organizations o ON o.id = nu.organization_id
          WHERE nu.network_id = net);
END $$;

-- Aplica um padrão numa empresa: só acrescenta o que falta; troca instruções do assistente e regras.
CREATE OR REPLACE FUNCTION private.apply_network_standard(org uuid, p jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE x jsonb; secs jsonb; k text; pos integer;
BEGIN
  SELECT coalesce(max(position), 0) INTO pos FROM public.pipeline_stages WHERE organization_id = org;
  FOR x IN SELECT * FROM jsonb_array_elements(coalesce(p -> 'pipeline_stages', '[]')) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.pipeline_stages WHERE organization_id = org AND lower(name) = lower(x ->> 'name')) THEN
      pos := pos + 1;
      INSERT INTO public.pipeline_stages (organization_id, name, color, position, followup_days, followup_hint)
      VALUES (org, left(x ->> 'name', 60), coalesce(x ->> 'color', '#94A3B8'), pos,
              CASE WHEN jsonb_typeof(x -> 'followup_days') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(x -> 'followup_days'))::integer[] END,
              x ->> 'followup_hint');
    END IF;
  END LOOP;
  FOR x IN SELECT * FROM jsonb_array_elements(coalesce(p -> 'departments', '[]')) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.departments WHERE organization_id = org AND lower(name) = lower(x ->> 'name')) THEN
      INSERT INTO public.departments (organization_id, name, color) VALUES (org, left(x ->> 'name', 80), coalesce(x ->> 'color', '#94A3B8'));
    END IF;
  END LOOP;
  FOR x IN SELECT * FROM jsonb_array_elements(coalesce(p -> 'tags', '[]')) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.tags WHERE organization_id = org AND lower(name) = lower(x ->> 'name')) THEN
      INSERT INTO public.tags (organization_id, name, color, icon) VALUES (org, left(x ->> 'name', 60), coalesce(x ->> 'color', '#94A3B8'), x ->> 'icon');
    END IF;
  END LOOP;
  IF coalesce(p ->> 'agent_prompt', '') <> '' THEN
    UPDATE public.agent_configs SET system_prompt = left(p ->> 'agent_prompt', 20000) WHERE organization_id = org;
  END IF;
  secs := coalesce(p -> 'sections', '{}');
  IF secs <> '{}'::jsonb THEN
    INSERT INTO public.company_profiles (organization_id) VALUES (org) ON CONFLICT (organization_id) DO NOTHING;
    FOR k IN SELECT jsonb_object_keys(secs) LOOP
      IF k IN ('regras_ia', 'marca_voz', 'politicas', 'faq') AND jsonb_typeof(secs -> k) = 'string' THEN
        UPDATE public.company_profiles SET sections = sections || jsonb_build_object(k, left(secs ->> k, 8000)) WHERE organization_id = org;
      END IF;
    END LOOP;
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.apply_network_standard(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- Matriz publica o padrão a partir da própria configuração. Obrigatório = aplica em todas as unidades já.
CREATE OR REPLACE FUNCTION public.network_publish_standard(net uuid, p_mandatory boolean)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE hq uuid; v integer; p jsonb; un uuid;
BEGIN
  IF NOT private.is_network_hq(net) THEN RAISE EXCEPTION 'só a matriz publica o padrão' USING ERRCODE = '42501'; END IF;
  SELECT hq_org_id INTO hq FROM public.networks WHERE id = net;
  p := jsonb_build_object(
    'pipeline_stages', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', name, 'color', color, 'followup_days', to_jsonb(followup_days),
                          'followup_hint', followup_hint) ORDER BY position), '[]') FROM public.pipeline_stages WHERE organization_id = hq),
    'departments', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', name, 'color', color) ORDER BY name), '[]') FROM public.departments WHERE organization_id = hq),
    'tags', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', name, 'color', color, 'icon', icon) ORDER BY name), '[]') FROM public.tags WHERE organization_id = hq),
    'agent_prompt', (SELECT system_prompt FROM public.agent_configs WHERE organization_id = hq ORDER BY updated_at DESC NULLS LAST LIMIT 1),
    'sections', (SELECT coalesce(jsonb_object_agg(k, sections ->> k), '{}') FROM public.company_profiles,
                   unnest(ARRAY['regras_ia', 'marca_voz', 'politicas', 'faq']) k
                 WHERE organization_id = hq AND coalesce(sections ->> k, '') <> ''));
  SELECT coalesce(max(version), 0) + 1 INTO v FROM public.network_standards WHERE network_id = net;
  INSERT INTO public.network_standards (network_id, version, payload, mandatory, created_by)
  VALUES (net, v, p, coalesce(p_mandatory, false), (SELECT auth.uid()));
  IF p_mandatory THEN
    FOR un IN SELECT organization_id FROM public.network_units WHERE network_id = net LOOP
      PERFORM private.apply_network_standard(un, p);
      UPDATE public.network_units SET applied_version = v WHERE network_id = net AND organization_id = un;
    END LOOP;
  END IF;
  -- Aviso para quem gerencia cada unidade.
  INSERT INTO public.notifications (organization_id, user_id, kind, ref)
  SELECT m.organization_id, m.user_id, 'network_standard', jsonb_build_object('version', v, 'mandatory', coalesce(p_mandatory, false))
  FROM public.network_units nu JOIN public.organization_members m ON m.organization_id = nu.organization_id
  WHERE nu.network_id = net AND m.status = 'active' AND m.role IN ('owner', 'admin');
  PERFORM private.audit(hq, 'network.standard', net::text, jsonb_build_object('version', v, 'mandatory', coalesce(p_mandatory, false)));
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.network_invite(uuid), public.network_remove_unit(uuid, uuid), public.network_dashboard(uuid, timestamptz, timestamptz),
  public.network_publish_standard(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.network_invite(uuid), public.network_remove_unit(uuid, uuid), public.network_dashboard(uuid, timestamptz, timestamptz),
  public.network_publish_standard(uuid, boolean) TO authenticated;

-- --------------------------------------------------------------- unidade
CREATE OR REPLACE FUNCTION public.network_join(org uuid, p_code text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE inv public.network_invites; n public.networks;
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO inv FROM public.network_invites
  WHERE code_hash = encode(extensions.digest(upper(btrim(coalesce(p_code, ''))), 'sha256'), 'hex') AND used_at IS NULL AND expires_at > now()
  FOR UPDATE;
  IF inv.id IS NULL THEN RAISE EXCEPTION 'código inválido ou vencido' USING ERRCODE = '22023'; END IF;
  SELECT * INTO n FROM public.networks WHERE id = inv.network_id;
  IF n.hq_org_id = org THEN RAISE EXCEPTION 'a matriz não entra como unidade' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.networks WHERE hq_org_id = org) THEN RAISE EXCEPTION 'esta empresa é matriz de uma rede' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.network_units WHERE organization_id = org) THEN RAISE EXCEPTION 'esta empresa já está em uma rede' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.network_units (network_id, organization_id) VALUES (n.id, org);
  UPDATE public.network_invites SET used_at = now(), used_by_org = org WHERE id = inv.id;
  INSERT INTO public.notifications (organization_id, user_id, kind, ref)
  SELECT n.hq_org_id, m.user_id, 'network_joined', jsonb_build_object('unit', left((SELECT name FROM public.organizations WHERE id = org), 80))
  FROM public.organization_members m WHERE m.organization_id = n.hq_org_id AND m.status = 'active' AND m.role IN ('owner', 'admin');
  PERFORM private.audit(org, 'network.join', n.id::text, '{}'::jsonb);
  RETURN n.id;
END $$;

CREATE OR REPLACE FUNCTION public.network_leave(org uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.network_units WHERE organization_id = org;
  PERFORM private.audit(org, 'network.leave', org::text, '{}'::jsonb);
END $$;

-- Unidade aplica a versão mais nova do padrão.
CREATE OR REPLACE FUNCTION public.network_apply_standard(org uuid)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE nu public.network_units; st public.network_standards;
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  SELECT * INTO nu FROM public.network_units WHERE organization_id = org;
  IF nu.network_id IS NULL THEN RAISE EXCEPTION 'esta empresa não está em uma rede' USING ERRCODE = '22023'; END IF;
  SELECT * INTO st FROM public.network_standards WHERE network_id = nu.network_id ORDER BY version DESC LIMIT 1;
  IF st.version IS NULL THEN RAISE EXCEPTION 'a matriz ainda não publicou o padrão' USING ERRCODE = '22023'; END IF;
  PERFORM private.apply_network_standard(org, st.payload);
  UPDATE public.network_units SET applied_version = st.version WHERE organization_id = org;
  PERFORM private.audit(org, 'network.apply', nu.network_id::text, jsonb_build_object('version', st.version));
  RETURN st.version;
END $$;
REVOKE ALL ON FUNCTION public.network_join(uuid, text), public.network_leave(uuid), public.network_apply_standard(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.network_join(uuid, text), public.network_leave(uuid), public.network_apply_standard(uuid) TO authenticated;

-- A rede desta empresa (para a tela e para a marca): papel, marca e versões.
CREATE OR REPLACE FUNCTION public.my_network(org uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN NOT private.is_member(org) THEN NULL ELSE (
    SELECT jsonb_build_object('id', n.id, 'name', n.name, 'brand', n.brand,
      'role', CASE WHEN n.hq_org_id = org THEN 'hq' ELSE 'unit' END,
      'applied_version', (SELECT applied_version FROM public.network_units WHERE organization_id = org),
      'latest_version', (SELECT max(version) FROM public.network_standards WHERE network_id = n.id),
      'latest_mandatory', (SELECT mandatory FROM public.network_standards WHERE network_id = n.id ORDER BY version DESC LIMIT 1),
      'units', CASE WHEN n.hq_org_id = org THEN (SELECT count(*) FROM public.network_units WHERE network_id = n.id) END)
    FROM public.networks n
    WHERE n.hq_org_id = org OR n.id = (SELECT network_id FROM public.network_units WHERE organization_id = org)
    LIMIT 1) END
$$;
REVOKE ALL ON FUNCTION public.my_network(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_network(uuid) TO authenticated;

-- ------------------------------------------------------- implantação
-- Começar a implantação: guarda os números dos 30 dias anteriores (ponto de partida).
CREATE OR REPLACE FUNCTION public.start_implantation(org uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE base jsonb := private.org_metrics(org, now() - interval '30 days', now());
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  UPDATE public.organizations SET settings = coalesce(settings, '{}'::jsonb)
    || jsonb_build_object('implantation', jsonb_build_object('started_at', now(), 'baseline', base))
  WHERE id = org;
  PERFORM private.audit(org, 'implantation.start', org::text, base);
  RETURN base;
END $$;

-- Antes × depois: o ponto de partida e os 30 dias mais recentes.
CREATE OR REPLACE FUNCTION public.implantation_compare(org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE imp jsonb;
BEGIN
  IF NOT private.has_permission(org, 'org.settings') THEN RAISE EXCEPTION 'sem permissão' USING ERRCODE = '42501'; END IF;
  SELECT settings -> 'implantation' INTO imp FROM public.organizations WHERE id = org;
  IF imp IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('started_at', imp -> 'started_at', 'antes', imp -> 'baseline',
    'depois', private.org_metrics(org, now() - interval '30 days', now()));
END $$;
REVOKE ALL ON FUNCTION public.start_implantation(uuid), public.implantation_compare(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_implantation(uuid), public.implantation_compare(uuid) TO authenticated;
