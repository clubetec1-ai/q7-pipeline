-- =============================================================================
-- Teste de isolamento multi-tenant do ClubeCRM
-- Spec: docs/superpowers/specs/2026-09-24-multi-tenant-equipes-design.md §11.1
--
-- Roda inteiro dentro de BEGIN ... ROLLBACK: nao deixa dados.
-- Execucao: MCP execute_sql ou SQL Editor. Sucesso = NOTICE "ISOLATION OK".
-- Falha = ERROR "FALHOU <caso>" no primeiro caso que quebrar.
-- =============================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- Helpers (executados como o dono da sessao; trocam de papel por dentro)
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.become(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;

-- Conta linhas de uma consulta vista pelo usuario.
CREATE FUNCTION pg_temp.q(uid uuid, sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM pg_temp.become(uid);
  EXECUTE sql INTO n;
  EXECUTE 'RESET ROLE';
  RETURN n;
END $$;

-- Texto de uma consulta vista pelo usuario.
CREATE FUNCTION pg_temp.t(uid uuid, sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  PERFORM pg_temp.become(uid);
  EXECUTE sql INTO r;
  EXECUTE 'RESET ROLE';
  RETURN coalesce(r, '');
END $$;

-- Executa um comando como o usuario: 'ok:<linhas>' ou 'err:<sqlstate>'.
-- uid NULL = executa como o dono da sessao.
CREATE FUNCTION pg_temp.run(uid uuid, sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  BEGIN
    IF uid IS NOT NULL THEN PERFORM pg_temp.become(uid); END IF;
    EXECUTE sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    RETURN 'ok:' || n;
  EXCEPTION WHEN OTHERS THEN
    RETURN 'err:' || SQLSTATE;   -- a subtransacao desfaz o SET LOCAL ROLE
  END;
END $$;

CREATE FUNCTION pg_temp.expect(cond boolean, caso text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU %', caso; END IF;
END $$;

-- Negado = erro ou nenhuma linha afetada.
CREATE FUNCTION pg_temp.expect_denied(uid uuid, sql text, caso text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r text := pg_temp.run(uid, sql);
BEGIN
  IF r NOT LIKE 'err:%' AND r <> 'ok:0' THEN
    RAISE EXCEPTION 'FALHOU % (resultado %)', caso, r;
  END IF;
END $$;

CREATE FUNCTION pg_temp.expect_error(uid uuid, sql text, caso text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r text := pg_temp.run(uid, sql);
BEGIN
  IF r NOT LIKE 'err:%' THEN RAISE EXCEPTION 'FALHOU % (resultado %)', caso, r; END IF;
END $$;

-- Conversas da org A visiveis ao usuario, pelo ultimo digito do id (ex.: '124').
CREATE FUNCTION pg_temp.vis(uid uuid, tbl text DEFAULT 'conversations') RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  RETURN pg_temp.t(uid, format(
    'SELECT string_agg(DISTINCT right(%s::text, 1), %L) FROM public.%I WHERE organization_id = %L',
    CASE WHEN tbl = 'conversations' THEN 'id' ELSE 'conversation_id' END, '', tbl,
    'aaaaaaaa-0000-0000-0000-000000000001'));
END $$;

-- ---------------------------------------------------------------------------
-- Cenario
-- ---------------------------------------------------------------------------
-- Usuarios: a1 owner_a, a2 admin_a, a3 sup_a, a4 agent_a, a5 agent2_a,
--           b1 owner_b, b2 agent_b, c1 operador, c2 outsider
INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data)
SELECT ('00000000-0000-0000-0000-0000000000' || s)::uuid, 'iso-' || s || '@teste.invalid',
       'authenticated', 'authenticated', '{}'::jsonb
FROM unnest(ARRAY['a1','a2','a3','a4','a5','b1','b2','c1','c2']) AS s;

INSERT INTO public.platform_operators (user_id) VALUES ('00000000-0000-0000-0000-0000000000c1');

INSERT INTO public.organizations (id, name, slug, status, template_key, settings) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Org A', 'iso-org-a', 'active', 'generico', '{}'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Org B', 'iso-org-b', 'active', 'generico', '{}');

INSERT INTO public.organization_members (organization_id, user_id, role, status) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'owner', 'active'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', 'admin', 'active'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a3', 'supervisor', 'active'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a4', 'agent', 'active'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a5', 'agent', 'active'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'owner', 'active'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 'agent', 'active');

INSERT INTO public.departments (id, organization_id, name) VALUES
  ('aaaaaaaa-0000-0000-0001-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'D1'),
  ('aaaaaaaa-0000-0000-0001-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'D2'),
  ('bbbbbbbb-0000-0000-0001-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'DB');

INSERT INTO public.department_members (department_id, user_id, organization_id) VALUES
  ('aaaaaaaa-0000-0000-0001-000000000001', '00000000-0000-0000-0000-0000000000a3', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0001-000000000001', '00000000-0000-0000-0000-0000000000a4', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0001-000000000002', '00000000-0000-0000-0000-0000000000a5', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('bbbbbbbb-0000-0000-0001-000000000001', '00000000-0000-0000-0000-0000000000b2', 'bbbbbbbb-0000-0000-0000-000000000001');

INSERT INTO public.teams (id, organization_id, department_id, name) VALUES
  ('aaaaaaaa-0000-0000-0002-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0001-000000000001', 'G1'),
  ('bbbbbbbb-0000-0000-0002-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0001-000000000001', 'GB');
INSERT INTO public.team_members (team_id, user_id, organization_id) VALUES
  ('aaaaaaaa-0000-0000-0002-000000000001', '00000000-0000-0000-0000-0000000000a4', 'aaaaaaaa-0000-0000-0000-000000000001');

INSERT INTO public.whatsapp_instances (id, user_id, organization_id, name, provider) VALUES
  ('aaaaaaaa-0000-0000-0003-000000000001', '00000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'iso-a', 'uazapi'),
  ('bbbbbbbb-0000-0000-0003-000000000001', '00000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000001', 'iso-b', 'uazapi');

INSERT INTO public.pipeline_stages (user_id, organization_id, name, position) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Novo', 0),
  ('00000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000001', 'Novo', 0);

INSERT INTO public.agent_configs (user_id, organization_id) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000001');

-- Conversas de A (ultimo digito = caso):
--   1 D1 atribuida a agent_a | 2 D1 fila | 3 D2 fila | 4 fila geral | 5 D1 atribuida a sup_a
INSERT INTO public.conversations (id, user_id, instance_id, contact_phone, department_id, assigned_to) VALUES
  ('aaaaaaaa-0000-0000-0004-000000000001', '00000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0003-000000000001', '5511900000001', 'aaaaaaaa-0000-0000-0001-000000000001', '00000000-0000-0000-0000-0000000000a4'),
  ('aaaaaaaa-0000-0000-0004-000000000002', '00000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0003-000000000001', '5511900000002', 'aaaaaaaa-0000-0000-0001-000000000001', NULL),
  ('aaaaaaaa-0000-0000-0004-000000000003', '00000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0003-000000000001', '5511900000003', 'aaaaaaaa-0000-0000-0001-000000000002', NULL),
  ('aaaaaaaa-0000-0000-0004-000000000004', '00000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0003-000000000001', '5511900000004', NULL, NULL),
  ('aaaaaaaa-0000-0000-0004-000000000005', '00000000-0000-0000-0000-0000000000a1', 'aaaaaaaa-0000-0000-0003-000000000001', '5511900000005', 'aaaaaaaa-0000-0000-0001-000000000001', '00000000-0000-0000-0000-0000000000a3'),
  ('bbbbbbbb-0000-0000-0004-000000000001', '00000000-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0003-000000000001', '5511900000009', NULL, NULL);

-- Filhas sem organization_id: a heranca preenche.
INSERT INTO public.messages (conversation_id, user_id, direction, sender, content)
SELECT id, user_id, 'inbound', 'contact', 'oi' FROM public.conversations
WHERE id::text LIKE 'aaaaaaaa-0000-0000-0004-%' OR id::text LIKE 'bbbbbbbb-0000-0000-0004-%';
INSERT INTO public.followups (conversation_id, user_id, send_at, status, kind)
SELECT id, user_id, now() + interval '1 day', 'pending', 'manual' FROM public.conversations
WHERE id::text LIKE 'aaaaaaaa-0000-0000-0004-%' OR id::text LIKE 'bbbbbbbb-0000-0000-0004-%';

-- Tabelas so de backend, com uma linha de A para provar que ficam invisiveis.
INSERT INTO public.org_secrets (organization_id, name, secret_name) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'groq_api_key', 'org:iso:groq_api_key');
INSERT INTO public.inbound_events (organization_id, instance_id, provider, provider_message_id, payload, status) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0003-000000000001', 'uazapi', 'iso-1', '{}', 'processed');
SELECT private.audit('aaaaaaaa-0000-0000-0000-000000000001', 'iso.setup', 'org', '{}'::jsonb);

-- ---------------------------------------------------------------------------
-- Casos
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  A constant uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  owner_a  constant uuid := '00000000-0000-0000-0000-0000000000a1';
  admin_a  constant uuid := '00000000-0000-0000-0000-0000000000a2';
  sup_a    constant uuid := '00000000-0000-0000-0000-0000000000a3';
  agent_a  constant uuid := '00000000-0000-0000-0000-0000000000a4';
  agent2_a constant uuid := '00000000-0000-0000-0000-0000000000a5';
  owner_b  constant uuid := '00000000-0000-0000-0000-0000000000b1';
  agent_b  constant uuid := '00000000-0000-0000-0000-0000000000b2';
  operator constant uuid := '00000000-0000-0000-0000-0000000000c1';
  outsider constant uuid := '00000000-0000-0000-0000-0000000000c2';
  tbl text;
BEGIN
  -- 1. Sentinela: nenhuma tabela de public sem RLS.
  PERFORM pg_temp.expect((SELECT count(*) = 0 FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND NOT c.relrowsecurity),
    'sentinela RLS');

  -- 2 e 16. Toda tabela com organization_id: B e outsider nao leem nem escrevem em A.
  FOR tbl IN SELECT table_name FROM information_schema.columns
             WHERE table_schema = 'public' AND column_name = 'organization_id'
             ORDER BY table_name LOOP
    PERFORM pg_temp.expect(pg_temp.q(agent_b, format(
      'SELECT count(*) FROM public.%I WHERE organization_id = %L', tbl, A)) = 0,
      'leitura cruzada ' || tbl);
    PERFORM pg_temp.expect(pg_temp.q(outsider, format(
      'SELECT count(*) FROM public.%I', tbl)) = 0, 'outsider ' || tbl);
    PERFORM pg_temp.expect_denied(owner_b, format(
      'UPDATE public.%I SET organization_id = organization_id WHERE organization_id = %L', tbl, A),
      'update cruzado ' || tbl);
    PERFORM pg_temp.expect_denied(owner_b, format(
      'DELETE FROM public.%I WHERE organization_id = %L', tbl, A), 'delete cruzado ' || tbl);
  END LOOP;
  PERFORM pg_temp.expect(pg_temp.q(agent_b, format(
    'SELECT count(*) FROM public.organizations WHERE id = %L', A)) = 0, 'leitura cruzada organizations');
  PERFORM pg_temp.expect(pg_temp.q(outsider, 'SELECT count(*) FROM public.organizations') = 0,
    'outsider organizations');

  -- 3. Insert em organizacao alheia.
  PERFORM pg_temp.expect_error(owner_b, format(
    'INSERT INTO public.departments (organization_id, name) VALUES (%L, %L)', A, 'x'),
    'insert em org alheia');

  -- 4. Visibilidade own_and_queue (padrao).
  PERFORM pg_temp.expect(pg_temp.vis(agent_a) = '124', 'agent_a own_and_queue: ' || pg_temp.vis(agent_a));
  PERFORM pg_temp.expect(pg_temp.vis(agent2_a) = '34', 'agent2_a own_and_queue: ' || pg_temp.vis(agent2_a));

  -- 6. Supervisor restrito ao departamento; admin ve tudo.
  PERFORM pg_temp.expect(pg_temp.vis(sup_a) = '1245', 'sup_a: ' || pg_temp.vis(sup_a));
  PERFORM pg_temp.expect(pg_temp.vis(admin_a) = '12345', 'admin_a: ' || pg_temp.vis(admin_a));
  PERFORM pg_temp.expect(pg_temp.vis(owner_a) = '12345', 'owner_a: ' || pg_temp.vis(owner_a));

  -- 7. Filhas herdam a visibilidade da conversa.
  PERFORM pg_temp.expect(pg_temp.vis(agent_a, 'messages') = '124', 'messages agent_a');
  PERFORM pg_temp.expect(pg_temp.vis(agent_a, 'followups') = '124', 'followups agent_a');
  PERFORM pg_temp.expect(pg_temp.vis(agent2_a, 'messages') = '34', 'messages agent2_a');

  -- 5. Modo department.
  UPDATE public.organizations SET settings = settings || '{"agent_visibility":"department"}' WHERE id = A;
  PERFORM pg_temp.expect(pg_temp.vis(agent_a) = '1245', 'agent_a department: ' || pg_temp.vis(agent_a));
  UPDATE public.organizations SET settings = settings - 'agent_visibility' WHERE id = A;

  -- 8. Admin nao altera owner.
  PERFORM pg_temp.expect_denied(admin_a, format(
    'UPDATE public.organization_members SET role = %L WHERE user_id = %L', 'agent', owner_a),
    'admin nao altera owner');
  PERFORM pg_temp.expect_denied(admin_a, format(
    'DELETE FROM public.organization_members WHERE user_id = %L', owner_a), 'admin nao remove owner');

  -- 9. Organizacao nunca fica sem owner ativo.
  PERFORM pg_temp.expect_error(NULL, format(
    'UPDATE public.organization_members SET role = %L WHERE user_id = %L', 'admin', owner_a),
    'org sem owner');

  -- 10. Organizacao suspensa: membros nao leem nada.
  UPDATE public.organizations SET status = 'suspended' WHERE id = A;
  PERFORM pg_temp.expect(pg_temp.vis(agent_a) = '', 'suspensa agent_a');
  PERFORM pg_temp.expect(pg_temp.vis(owner_a) = '', 'suspensa owner_a');
  UPDATE public.organizations SET status = 'active' WHERE id = A;

  -- 11. Acesso de suporte.
  PERFORM pg_temp.expect(pg_temp.vis(operator) = '', 'operador sem suporte');
  INSERT INTO public.support_access (organization_id, operator_id, reason, expires_at)
  VALUES (A, operator, 'teste', now() + interval '1 hour');
  PERFORM pg_temp.expect(pg_temp.vis(operator) = '12345', 'operador com suporte');
  UPDATE public.support_access SET expires_at = now() - interval '1 minute' WHERE operator_id = operator;
  PERFORM pg_temp.expect(pg_temp.vis(operator) = '', 'suporte expirado');

  -- 12. Segredos e eventos invisiveis ao navegador.
  PERFORM pg_temp.expect(pg_temp.q(owner_a, 'SELECT count(*) FROM public.org_secrets') = 0, 'org_secrets invisivel');
  PERFORM pg_temp.expect(pg_temp.q(owner_a, 'SELECT count(*) FROM public.inbound_events') = 0, 'inbound_events invisivel');
  PERFORM pg_temp.expect_error(owner_a, 'SELECT count(*) FROM vault.decrypted_secrets', 'vault invisivel');

  -- 13. audit_log imutavel e sem insert direto.
  PERFORM pg_temp.expect(pg_temp.q(owner_a, 'SELECT count(*) FROM public.audit_log') >= 1, 'owner le audit');
  PERFORM pg_temp.expect_denied(owner_a, 'UPDATE public.audit_log SET action = action', 'audit update');
  PERFORM pg_temp.expect_denied(owner_a, 'DELETE FROM public.audit_log', 'audit delete');
  PERFORM pg_temp.expect_error(owner_a, format(
    'INSERT INTO public.audit_log (organization_id, action) VALUES (%L, %L)', A, 'forjado'), 'audit insert direto');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT count(*) FROM public.audit_log') = 0, 'agent nao le audit');

  -- 14. Heranca de organizacao do registro pai.
  PERFORM pg_temp.expect_error(NULL, format(
    'INSERT INTO public.messages (conversation_id, organization_id, direction, sender, content) VALUES (%L, %L, %L, %L, %L)',
    'aaaaaaaa-0000-0000-0004-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'inbound', 'contact', 'x'),
    'heranca diverge');
  PERFORM pg_temp.expect((SELECT count(*) = 5 FROM public.messages WHERE organization_id = A), 'heranca preenche');

  -- 15. Grupo so aceita membro do departamento.
  PERFORM pg_temp.expect_error(NULL, format(
    'INSERT INTO public.team_members (team_id, user_id, organization_id) VALUES (%L, %L, %L)',
    'aaaaaaaa-0000-0000-0002-000000000001', agent2_a, A), 'grupo so com membro do depto');

  -- 17. Permissoes lidas pelo frontend.
  PERFORM pg_temp.expect(pg_temp.t(agent_a, format(
    'SELECT (%L = ANY(public.my_permissions(%L)))::text', 'conversations.attend', A)) = 'true', 'agent pode atender');
  PERFORM pg_temp.expect(pg_temp.t(agent_a, format(
    'SELECT (%L = ANY(public.my_permissions(%L)))::text', 'members.manage', A)) = 'false', 'agent nao gerencia membros');
  PERFORM pg_temp.expect(pg_temp.t(agent_b, format(
    'SELECT coalesce(array_length(public.my_permissions(%L), 1), 0)::text', A)) = '0', 'b sem permissao em A');

  -- 18. Segredos: so quem tem org.settings grava; valor nunca vai para o audit.
  PERFORM pg_temp.expect_error(agent_a, format(
    'SELECT public.set_org_secret(%L, %L, %L)', A, 'groq_api_key', 'gsk_teste'), 'set_org_secret sem permissao');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format(
    'SELECT public.set_org_secret(%L, %L, %L)', A, 'groq_api_key', 'gsk_teste')) LIKE 'ok:%', 'set_org_secret owner');
  PERFORM pg_temp.expect((SELECT count(*) = 0 FROM public.audit_log WHERE meta::text LIKE '%gsk_teste%'), 'segredo fora do audit');
  PERFORM pg_temp.expect_error(owner_a, format(
    'SELECT public.set_org_secret(%L, %L, %L)', A, 'nome_inventado', 'x'), 'nome de segredo fora da lista');

  -- 19. Cadastro com organizacoes existentes nao cria organizacao.
  INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data)
  VALUES ('00000000-0000-0000-0000-0000000000d1', 'iso-d1@teste.invalid', 'authenticated', 'authenticated', '{}');
  PERFORM pg_temp.expect((SELECT count(*) = 1 FROM public.profiles WHERE user_id = '00000000-0000-0000-0000-0000000000d1'), 'cadastro cria perfil');
  PERFORM pg_temp.expect((SELECT count(*) = 0 FROM public.organization_members WHERE user_id = '00000000-0000-0000-0000-0000000000d1'), 'cadastro nao cria org');

  RAISE NOTICE 'ISOLATION OK';
END $$;

ROLLBACK;
