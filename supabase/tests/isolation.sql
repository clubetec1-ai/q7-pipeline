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
    json_build_object('sub', uid, 'role', 'authenticated',
      'aal', coalesce(nullif(current_setting('test.aal', true), ''), 'aal2'))::text, true);
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

-- Como q(), mas tabela so do backend (sem GRANT) conta como 0 linhas vistas.
CREATE FUNCTION pg_temp.seen(uid uuid, sql text) RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN
  RETURN pg_temp.q(uid, sql);
EXCEPTION WHEN insufficient_privilege THEN
  EXECUTE 'RESET ROLE';
  RETURN 0;
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
    PERFORM pg_temp.expect(pg_temp.seen(agent_b, format(
      'SELECT count(*) FROM public.%I WHERE organization_id = %L', tbl, A)) = 0,
      'leitura cruzada ' || tbl);
    PERFORM pg_temp.expect(pg_temp.seen(outsider, format(
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

  -- 20. Operador sem suporte nao le organizacoes (spec §5.1).
  PERFORM pg_temp.expect(pg_temp.q(operator, 'SELECT count(*) FROM public.organizations') = 0, 'operador nao lista orgs');

  -- 21. Configuracao da IA (chave da Groq) so para quem administra.
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT count(*) FROM public.agent_configs') = 0, 'agent nao le agent_configs');
  PERFORM pg_temp.expect(pg_temp.q(sup_a, 'SELECT count(*) FROM public.agent_configs') = 0, 'supervisor nao le agent_configs');

  -- 22. Segredo de numero: so org.settings grava; referencia por nome.
  PERFORM pg_temp.expect_error(agent_a, format(
    'SELECT public.set_instance_secret(%L, %L)', 'aaaaaaaa-0000-0000-0003-000000000001', 'tok'), 'set_instance_secret sem permissao');
  PERFORM pg_temp.expect_error(owner_b, format(
    'SELECT public.set_instance_secret(%L, %L)', 'aaaaaaaa-0000-0000-0003-000000000001', 'tok'), 'set_instance_secret de outra org');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format(
    'SELECT public.set_instance_secret(%L, %L)', 'aaaaaaaa-0000-0000-0003-000000000001', 'tok')) LIKE 'ok:%', 'set_instance_secret owner');
  PERFORM pg_temp.expect((SELECT secret_name = 'instance:aaaaaaaa-0000-0000-0003-000000000001:token'
    FROM public.whatsapp_instances WHERE id = 'aaaaaaaa-0000-0000-0003-000000000001'), 'secret_name por nome');

  PERFORM pg_temp.expect((SELECT token_hash = encode(extensions.digest('tok', 'sha256'), 'hex')
    FROM public.whatsapp_instances WHERE id = 'aaaaaaaa-0000-0000-0003-000000000001'), 'set_instance_secret grava o hash');
  PERFORM pg_temp.expect_error(owner_a, format(
    'SELECT public.service_put_secret(%L, %L)', 'instance:aaaaaaaa-0000-0000-0003-000000000001:webhook', 'x'),
    'service_put_secret negado ao navegador');
  PERFORM pg_temp.expect_error(owner_a, format(
    'SELECT public.service_get_secret(%L)', 'platform:cron_secret'), 'service_get_secret negado ao navegador');

  -- 23. Mesmo contato em dois numeros da mesma organizacao.
  INSERT INTO public.whatsapp_instances (id, organization_id, name, provider)
  VALUES ('aaaaaaaa-0000-0000-0003-000000000002', A, 'iso-a2', 'cloud');
  PERFORM pg_temp.expect(pg_temp.run(NULL, format(
    'INSERT INTO public.conversations (instance_id, contact_phone) VALUES (%L, %L)',
    'aaaaaaaa-0000-0000-0003-000000000002', '5511900000001')) = 'ok:1', 'mesmo contato em dois numeros');

  -- 24. Tela de configuracoes: upsert por organizacao, sem enviar organization_id.
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format(
    'INSERT INTO public.agent_configs (user_id, system_prompt) VALUES (%L, %L)
     ON CONFLICT (organization_id) DO UPDATE SET system_prompt = EXCLUDED.system_prompt', owner_a, 'novo')) = 'ok:1',
    'upsert de agent_configs por organizacao');

  -- 25. Fluxos: so org.settings escreve; publicado so pela RPC; outra org nao ve.
  INSERT INTO public.flows (id, organization_id, name) VALUES ('aaaaaaaa-0000-0000-0009-000000000001', A, 'fluxo-a');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.flows') = 0, 'outra org nao ve fluxo');
  PERFORM pg_temp.expect(pg_temp.q(sup_a, 'SELECT count(*) FROM public.flows') = 1, 'supervisor ve fluxo');
  PERFORM pg_temp.expect_denied(agent_a, format(
    'INSERT INTO public.flows (organization_id, name) VALUES (%L, %L)', A, 'x'), 'agent nao cria fluxo');
  PERFORM pg_temp.expect_denied(owner_a, format(
    'INSERT INTO public.flow_versions (organization_id, flow_id, status) VALUES (%L, %L, %L)',
    A, 'aaaaaaaa-0000-0000-0009-000000000001', 'published'), 'navegador nao publica por insert');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format(
    'INSERT INTO public.flow_versions (organization_id, flow_id, status, graph) VALUES (%L, %L, %L, %L)',
    A, 'aaaaaaaa-0000-0000-0009-000000000001', 'draft',
    '{"nodes":[{"id":"s","type":"start","data":{}}],"edges":[]}')) = 'ok:1', 'owner cria rascunho');
  PERFORM pg_temp.expect_error(owner_a,
    'UPDATE public.flow_versions SET status = ''published''', 'navegador nao troca status');
  PERFORM pg_temp.expect_error(owner_b, format(
    'SELECT public.publish_flow(%L)', 'aaaaaaaa-0000-0000-0009-000000000001'), 'outra org nao publica');
  PERFORM pg_temp.expect(pg_temp.t(owner_a, format(
    'SELECT public.publish_flow(%L)::text', 'aaaaaaaa-0000-0000-0009-000000000001')) = '1', 'owner publica v1');
  PERFORM pg_temp.expect_error(owner_a, 'SELECT count(*) FROM public.flow_runs', 'navegador nao le flow_runs');

  -- 26. Assumir atendimento de outra pessoa: so com conversations.reassign; fica registrado.
  INSERT INTO public.conversations (id, instance_id, contact_phone)
  VALUES ('aaaaaaaa-0000-0000-0010-000000000001', 'aaaaaaaa-0000-0000-0003-000000000001', '5511900000026');
  INSERT INTO public.tickets (id, organization_id, conversation_id, protocol, status, assigned_to, opened_at)
  VALUES ('aaaaaaaa-0000-0000-0011-000000000001', A, 'aaaaaaaa-0000-0000-0010-000000000001', 'T-26', 'open', agent2_a, now());
  PERFORM pg_temp.expect_error(agent_a, format(
    'SELECT public.take_over_ticket(%L)', 'aaaaaaaa-0000-0000-0011-000000000001'), 'agent nao assume de outro');
  PERFORM pg_temp.expect_error(owner_b, format(
    'SELECT public.take_over_ticket(%L)', 'aaaaaaaa-0000-0000-0011-000000000001'), 'outra org nao assume');
  PERFORM pg_temp.expect_error(agent_a, format(
    'SELECT public.claim_ticket(%L)', 'aaaaaaaa-0000-0000-0011-000000000001'), 'claim nao rouba atendimento');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format(
    'SELECT public.take_over_ticket(%L)', 'aaaaaaaa-0000-0000-0011-000000000001')) LIKE 'ok:%', 'owner assume');
  PERFORM pg_temp.expect((SELECT assigned_to = owner_a FROM public.tickets
    WHERE id = 'aaaaaaaa-0000-0000-0011-000000000001'), 'atendimento passou para o owner');
  PERFORM pg_temp.expect((SELECT count(*) = 1 FROM public.ticket_events
    WHERE ticket_id = 'aaaaaaaa-0000-0000-0011-000000000001' AND type = 'taken_over'
      AND meta ->> 'from_user' = agent2_a::text), 'evento registra de quem foi tirado');
  PERFORM pg_temp.expect((SELECT count(*) = 1 FROM public.notifications
    WHERE user_id = agent2_a AND kind = 'taken_over'), 'quem perdeu e notificado');

  -- 27. Pos-atendimento, opt-out e estatisticas do fluxo.
  INSERT INTO public.flows (id, organization_id, name)
  VALUES ('bbbbbbbb-0000-0000-0009-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'fluxo-b');
  INSERT INTO public.flow_versions (organization_id, flow_id, status, graph)
  VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0009-000000000001', 'published',
          '{"nodes":[{"id":"s","type":"start","data":{}}],"edges":[]}');
  INSERT INTO public.conversations (id, instance_id, contact_phone) VALUES
    ('aaaaaaaa-0000-0000-0010-000000000002', 'aaaaaaaa-0000-0000-0003-000000000001', '5511900000027'),
    ('aaaaaaaa-0000-0000-0010-000000000003', 'aaaaaaaa-0000-0000-0003-000000000001', '5511900000028');
  INSERT INTO public.tickets (id, organization_id, conversation_id, protocol, status, assigned_to, opened_at) VALUES
    ('aaaaaaaa-0000-0000-0011-000000000002', A, 'aaaaaaaa-0000-0000-0010-000000000002', 'T-27a', 'open', agent_a, now()),
    ('aaaaaaaa-0000-0000-0011-000000000003', A, 'aaaaaaaa-0000-0000-0010-000000000003', 'T-27b', 'open', agent_a, now());

  UPDATE public.organizations SET settings = settings || '{"post_close_flow_id":"bbbbbbbb-0000-0000-0009-000000000001"}'
  WHERE id = A;
  UPDATE public.tickets SET status = 'closed', closed_at = now() WHERE id = 'aaaaaaaa-0000-0000-0011-000000000001';
  PERFORM pg_temp.expect((SELECT count(*) = 0 FROM public.flow_runs
    WHERE ticket_id = 'aaaaaaaa-0000-0000-0011-000000000001'), 'fluxo de outra org nao roda no pos-atendimento');

  UPDATE public.organizations SET settings = settings || '{"post_close_flow_id":"nao-e-uuid"}' WHERE id = A;
  UPDATE public.tickets SET status = 'closed', closed_at = now() WHERE id = 'aaaaaaaa-0000-0000-0011-000000000002';
  PERFORM pg_temp.expect((SELECT status = 'closed' FROM public.tickets
    WHERE id = 'aaaaaaaa-0000-0000-0011-000000000002'), 'config invalida nao impede finalizar');

  UPDATE public.organizations SET settings = settings || '{"post_close_flow_id":"aaaaaaaa-0000-0000-0009-000000000001"}'
  WHERE id = A;
  UPDATE public.tickets SET status = 'closed', closed_at = now() WHERE id = 'aaaaaaaa-0000-0000-0011-000000000003';
  PERFORM pg_temp.expect((SELECT count(*) = 1 FROM public.flow_runs
    WHERE ticket_id = 'aaaaaaaa-0000-0000-0011-000000000003' AND state = 'waiting_timer'), 'pos-atendimento inicia');

  INSERT INTO public.flow_run_steps (organization_id, run_id, flow_version_id, node_id, outcome)
  SELECT A, r.id, r.flow_version_id, 's', 'first_contact' FROM public.flow_runs r
  WHERE r.ticket_id = 'aaaaaaaa-0000-0000-0011-000000000003';
  PERFORM pg_temp.expect_error(owner_b, format(
    'SELECT * FROM public.flow_stats(%L)', 'aaaaaaaa-0000-0000-0009-000000000001'), 'outra org nao le estatisticas');
  PERFORM pg_temp.expect(pg_temp.t(owner_a, format(
    'SELECT n::text FROM public.flow_stats(%L, 7) WHERE node_id = %L', 'aaaaaaaa-0000-0000-0009-000000000001', 's')) = '1',
    'owner le estatisticas');

  INSERT INTO public.tickets (organization_id, conversation_id, protocol, status)
  VALUES (A, 'aaaaaaaa-0000-0000-0010-000000000003', 'T-27c', 'bot');
  PERFORM pg_temp.expect((SELECT count(*) = 0 FROM public.flow_runs
    WHERE ticket_id = 'aaaaaaaa-0000-0000-0011-000000000003' AND state = 'waiting_timer'), 'atendimento novo cancela pos-atendimento');

  UPDATE public.contacts SET opted_out_at = now()
  WHERE id = (SELECT contact_id FROM public.conversations WHERE id = 'aaaaaaaa-0000-0000-0010-000000000001');
  PERFORM pg_temp.expect_error(agent_a, format('UPDATE public.contacts SET opted_out_at = NULL WHERE id = %L',
    (SELECT contact_id FROM public.conversations WHERE id = 'aaaaaaaa-0000-0000-0010-000000000001')),
    'navegador nao grava opt-out');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.clear_opt_out(%L)',
    (SELECT contact_id FROM public.conversations WHERE id = 'aaaaaaaa-0000-0000-0010-000000000001')),
    'outra org nao desfaz opt-out');
  PERFORM pg_temp.expect(pg_temp.run(agent_a, format('SELECT public.clear_opt_out(%L)',
    (SELECT contact_id FROM public.conversations WHERE id = 'aaaaaaaa-0000-0000-0010-000000000001'))) LIKE 'ok:%',
    'agent desfaz opt-out');
  PERFORM pg_temp.expect((SELECT ct.opted_out_at IS NULL FROM public.contacts ct
    JOIN public.conversations c ON c.contact_id = ct.id WHERE c.id = 'aaaaaaaa-0000-0000-0010-000000000001'),
    'opt-out desfeito');
  PERFORM pg_temp.expect((SELECT count(*) = 1 FROM public.audit_log
    WHERE action = 'contact.opt_out_cleared' AND actor_id = agent_a), 'desfazer opt-out fica auditado');

  -- 28. Segredos do bloco HTTP e chaves de IA: so org.settings; valor nunca volta.
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.set_http_secret(%L, %L, %L)', A, 'erp', 'x'), 'agent nao grava segredo http');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.set_http_secret(%L, %L, %L)', A, 'erp', 'x'), 'outra org nao grava segredo http');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.set_http_secret(%L, %L, %L)', A, 'Nome Ruim', 'x'), 'nome de segredo validado');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('SELECT public.set_http_secret(%L, %L, %L)', A, 'erp', 's3cr3t')) LIKE 'ok:%', 'owner grava segredo http');
  PERFORM pg_temp.expect(pg_temp.t(owner_a, format('SELECT string_agg(name, %L) FROM public.list_http_secrets(%L)', ',', A)) = 'erp', 'lista so nomes');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT * FROM public.list_http_secrets(%L)', A), 'outra org nao lista segredos');
  PERFORM pg_temp.expect((SELECT private.get_secret(format('org:%s:http:erp', A)) = 's3cr3t'), 'segredo no vault');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('SELECT public.delete_http_secret(%L, %L)', A, 'erp')) LIKE 'ok:%', 'owner apaga segredo http');
  PERFORM pg_temp.expect((SELECT private.get_secret(format('org:%s:http:erp', A)) IS NULL), 'segredo saiu do vault');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.service_http_take(%L)', A), 'limite http so no backend');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('SELECT public.set_org_secret(%L, %L, %L)', A, 'openai_api_key', 'sk-x')) LIKE 'ok:%', 'owner grava chave openai');
  PERFORM pg_temp.expect(pg_temp.t(owner_a, format('SELECT (public.ai_keys_status(%L) ->> %L)', A, 'openai')) = 'true', 'status da chave sem valor');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.ai_keys_status(%L)', A), 'agent nao ve status das chaves');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.set_org_secret(%L, %L, %L)', A, 'qualquer_key', 'x'), 'chave fora da lista recusada');

  -- 29. Saude dos numeros: piorou -> aviso so para owner/admin da propria org, uma vez.
  UPDATE public.whatsapp_instances SET health_status = 'ok' WHERE id = 'aaaaaaaa-0000-0000-0003-000000000001';
  DELETE FROM public.notifications WHERE kind = 'number_health';
  UPDATE public.whatsapp_instances SET health_status = 'critical', health_error = 'teste'
  WHERE id = 'aaaaaaaa-0000-0000-0003-000000000001';
  PERFORM pg_temp.expect((SELECT count(*) = 2 FROM public.notifications WHERE kind = 'number_health'
    AND user_id IN (owner_a, admin_a)), 'owner e admin avisados');
  PERFORM pg_temp.expect((SELECT count(*) = 0 FROM public.notifications WHERE kind = 'number_health'
    AND user_id NOT IN (owner_a, admin_a)), 'ninguem mais avisado');
  UPDATE public.whatsapp_instances SET health_status = 'critical', health_error = 'de novo'
  WHERE id = 'aaaaaaaa-0000-0000-0003-000000000001';
  PERFORM pg_temp.expect((SELECT count(*) = 2 FROM public.notifications WHERE kind = 'number_health'), 'nao repete o aviso');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT * FROM public.number_activity(%L)', A), 'outra org nao ve atividade');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT * FROM public.number_activity(%L)', A), 'agent nao ve atividade');

  -- 30. Nome na equipe: a pessoa define uma vez; depois so dono/admin; nome do dono so o dono.
  UPDATE public.organization_members SET display_name = NULL WHERE organization_id = A AND user_id IN (agent_a, agent2_a);
  PERFORM pg_temp.expect(pg_temp.run(agent_a, format('SELECT public.set_member_name(%L, %L, %L)', A, agent_a, 'Ana Agente')) LIKE 'ok:%', 'pessoa define o proprio nome');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.set_member_name(%L, %L, %L)', A, agent_a, 'Outro'), 'pessoa nao troca o proprio nome');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.set_member_name(%L, %L, %L)', A, agent2_a, 'Invasor'), 'agent nao nomeia outro');
  PERFORM pg_temp.expect_error(agent_a, format('UPDATE public.organization_members SET display_name = %L WHERE user_id = %L', 'X', agent_a), 'coluna nao gravavel direto');
  PERFORM pg_temp.expect(pg_temp.run(admin_a, format('SELECT public.set_member_name(%L, %L, %L)', A, agent_a, 'Ana Souza')) LIKE 'ok:%', 'admin altera nome');
  PERFORM pg_temp.expect_error(admin_a, format('SELECT public.set_member_name(%L, %L, %L)', A, owner_a, 'Dono'), 'admin nao altera nome do dono');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('SELECT public.set_member_name(%L, %L, %L)', A, owner_a, 'Dono A')) LIKE 'ok:%', 'dono altera o proprio nome');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.set_member_name(%L, %L, %L)', A, agent_a, 'Fora'), 'outra org nao altera nome');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.set_member_name(%L, %L, %L)', 'bbbbbbbb-0000-0000-0000-000000000001', agent_a, 'Fora'), 'nao nomeia quem nao e da org');
  PERFORM pg_temp.expect((SELECT display_name = 'Ana Souza' FROM public.organization_members WHERE organization_id = A AND user_id = agent_a), 'nome final');
  PERFORM pg_temp.expect((SELECT count(*) = 3 FROM public.audit_log WHERE organization_id = A AND action = 'member.renamed'), 'alteracoes auditadas');

  -- 31. Biblioteca: membros leem, so library.manage grava; nunca de/para outra org.
  INSERT INTO public.library_files (id, organization_id, name, media_path)
  VALUES ('aaaaaaaa-0000-0000-0012-000000000001', A, 'Catalogo', A::text || '/library/cat.pdf');
  INSERT INTO storage.objects (bucket_id, name) VALUES ('media', A::text || '/library/cat.pdf');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT count(*) FROM public.library_files') = 1, 'atendente ve a biblioteca');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.library_files') = 0, 'outra org nao ve a biblioteca');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, format('SELECT count(*) FROM storage.objects WHERE name = %L', A::text || '/library/cat.pdf')) = 1, 'atendente le o arquivo');
  PERFORM pg_temp.expect(pg_temp.q(agent_b, format('SELECT count(*) FROM storage.objects WHERE name = %L', A::text || '/library/cat.pdf')) = 0, 'outra org nao le o arquivo');
  PERFORM pg_temp.expect_denied(agent_a, format('DELETE FROM storage.objects WHERE name = %L', A::text || '/library/cat.pdf'), 'atendente nao apaga arquivo');
  PERFORM pg_temp.expect_denied(agent_a, format('INSERT INTO public.library_files (organization_id, name, media_path) VALUES (%L, %L, %L)',
    A, 'x', A::text || '/library/x.pdf'), 'atendente nao cadastra arquivo');
  PERFORM pg_temp.expect(pg_temp.run(sup_a, format('INSERT INTO public.library_files (organization_id, name, media_path) VALUES (%L, %L, %L)',
    A, 'Manual', A::text || '/library/manual.pdf')) = 'ok:1', 'supervisor cadastra arquivo');
  PERFORM pg_temp.expect_error(owner_a, format('INSERT INTO public.library_files (organization_id, name, media_path) VALUES (%L, %L, %L)',
    A, 'x', 'bbbbbbbb-0000-0000-0000-000000000001/library/x.pdf'), 'caminho de outra org recusado');
  PERFORM pg_temp.expect_error(owner_b, format('INSERT INTO public.quick_replies (organization_id, shortcut, content, library_file_id) VALUES (%L, %L, %L, %L)',
    'bbbbbbbb-0000-0000-0000-000000000001', 'x', 'x', 'aaaaaaaa-0000-0000-0012-000000000001'), 'resposta rapida nao usa arquivo de outra org');

  -- 32. Canal de e-mail: caixa por org, senha so no Vault, conversa herda a org da caixa.
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format(
    'INSERT INTO public.email_accounts (id, organization_id, name, address, username, imap_host, smtp_host, department_id)
     VALUES (%L, %L, %L, %L, %L, %L, %L, %L)', 'aaaaaaaa-0000-0000-0013-000000000001', A, 'Contato', 'contato@a.test',
    'contato@a.test', 'imap.a.test', 'smtp.a.test', 'aaaaaaaa-0000-0000-0001-000000000001')) = 'ok:1', 'owner cria caixa');
  PERFORM pg_temp.expect_denied(agent_a, format(
    'INSERT INTO public.email_accounts (organization_id, name, address, username, imap_host, smtp_host) VALUES (%L, %L, %L, %L, %L, %L)',
    A, 'x', 'x@a.test', 'x', 'imap.a.test', 'smtp.a.test'), 'atendente nao cria caixa');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.email_accounts') = 0, 'outra org nao ve caixa');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT count(*) FROM public.email_accounts') = 1, 'atendente ve a caixa');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.set_email_password(%L, %L)', 'aaaaaaaa-0000-0000-0013-000000000001', 'x'), 'atendente nao grava senha');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.set_email_password(%L, %L)', 'aaaaaaaa-0000-0000-0013-000000000001', 'x'), 'outra org nao grava senha');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('SELECT public.set_email_password(%L, %L)', 'aaaaaaaa-0000-0000-0013-000000000001', 'segredo')) LIKE 'ok:%', 'owner grava senha');
  PERFORM pg_temp.expect((SELECT has_password FROM public.email_accounts WHERE id = 'aaaaaaaa-0000-0000-0013-000000000001'), 'caixa marcada com senha');
  PERFORM pg_temp.expect((SELECT private.get_secret('email:aaaaaaaa-0000-0000-0013-000000000001:password') = 'segredo'), 'senha no vault');
  PERFORM pg_temp.expect_error(owner_a, 'UPDATE public.email_accounts SET has_password = false', 'has_password nao gravavel');
  PERFORM pg_temp.expect_error(owner_a, format('UPDATE public.email_accounts SET imap_host = %L', 'bad host!'), 'host invalido recusado');

  INSERT INTO public.conversations (id, channel, email_account_id, contact_email, contact_name)
  VALUES ('aaaaaaaa-0000-0000-0010-000000000032', 'email', 'aaaaaaaa-0000-0000-0013-000000000001', 'cliente@b.test', 'Cliente');
  PERFORM pg_temp.expect((SELECT organization_id = A AND contact_id IS NOT NULL FROM public.conversations
    WHERE id = 'aaaaaaaa-0000-0000-0010-000000000032'), 'conversa de e-mail herda org e ganha contato');
  PERFORM pg_temp.expect((SELECT phone IS NULL AND email = 'cliente@b.test' FROM public.contacts ct
    JOIN public.conversations c ON c.contact_id = ct.id WHERE c.id = 'aaaaaaaa-0000-0000-0010-000000000032'), 'contato so de e-mail');
  PERFORM pg_temp.expect(pg_temp.run(NULL, format('INSERT INTO public.conversations (channel, email_account_id, contact_email, instance_id) VALUES (%L, %L, %L, %L)',
    'email', 'aaaaaaaa-0000-0000-0013-000000000001', 'z@b.test', 'aaaaaaaa-0000-0000-0003-000000000001')) LIKE 'err:%', 'canal misturado recusado');
  PERFORM pg_temp.expect(pg_temp.run(NULL, format('INSERT INTO public.conversations (organization_id, channel, email_account_id, contact_email) VALUES (%L, %L, %L, %L)',
    'bbbbbbbb-0000-0000-0000-000000000001', 'email', 'aaaaaaaa-0000-0000-0013-000000000001', 'z@b.test')) LIKE 'err:%', 'conversa nao troca de org');
  PERFORM pg_temp.expect((SELECT status = 'queued' AND department_id = 'aaaaaaaa-0000-0000-0001-000000000001'
    FROM public.service_ticket_for_inbound('aaaaaaaa-0000-0000-0010-000000000032', false)), 'e-mail vai para a fila do departamento da caixa');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('DELETE FROM public.email_accounts WHERE id = %L', 'aaaaaaaa-0000-0000-0013-000000000001')) = 'ok:1', 'owner apaga caixa');
  PERFORM pg_temp.expect((SELECT private.get_secret('email:aaaaaaaa-0000-0000-0013-000000000001:password') IS NULL), 'senha sai do vault');

  -- 33. Painel da plataforma: so operador; suporte com motivo e prazo; auditado.
  PERFORM pg_temp.expect_error(owner_a, 'SELECT count(*) FROM public.platform_org_overview()', 'dono de empresa nao ve o painel');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.platform_set_org_status(%L, %L)', 'bbbbbbbb-0000-0000-0000-000000000001', 'suspended'), 'dono nao suspende outra empresa');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.service_create_org(%L, %L, %L)', 'X', 'generico', owner_a), 'navegador nao cria empresa direto');
  PERFORM pg_temp.expect(pg_temp.q(operator, 'SELECT count(*) FROM public.platform_org_overview()') >= 2, 'operador ve as empresas');
  PERFORM pg_temp.expect(pg_temp.q(operator, 'SELECT count(*) FROM public.conversations') = 0, 'operador sem suporte nao ve conversas');
  PERFORM pg_temp.expect_error(operator, format('SELECT public.platform_open_support(%L, %L, 30)', A, 'curto'), 'suporte exige motivo');
  PERFORM pg_temp.expect(pg_temp.run(operator, format('SELECT public.platform_open_support(%L, %L, 30)', A, 'cliente pediu ajuda no fluxo')) LIKE 'ok:%', 'operador abre suporte');
  PERFORM pg_temp.expect(pg_temp.q(operator, format('SELECT count(*) FROM public.conversations WHERE organization_id = %L', A)) > 0, 'suporte ve a empresa');
  PERFORM pg_temp.expect(pg_temp.q(operator, format('SELECT count(*) FROM public.conversations WHERE organization_id = %L', 'bbbbbbbb-0000-0000-0000-000000000001')) = 0, 'suporte so da empresa aberta');
  PERFORM pg_temp.expect(pg_temp.q(operator, 'SELECT count(*) FROM public.my_support_access()') = 1, 'seletor mostra a empresa em suporte');
  PERFORM pg_temp.expect((SELECT count(*) = 1 FROM public.audit_log WHERE organization_id = A AND action = 'platform.support_open'), 'abertura auditada');
  PERFORM pg_temp.expect(pg_temp.run(operator, format('SELECT public.platform_close_support(%L)', A)) LIKE 'ok:%', 'operador encerra suporte');
  PERFORM pg_temp.expect(pg_temp.q(operator, format('SELECT count(*) FROM public.conversations WHERE organization_id = %L', A)) = 0, 'sem suporte volta a nao ver');
  PERFORM pg_temp.expect(pg_temp.run(operator, format('SELECT public.platform_set_org_status(%L, %L)', 'bbbbbbbb-0000-0000-0000-000000000001', 'suspended')) LIKE 'ok:%', 'operador suspende empresa');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.conversations') = 0, 'empresa suspensa perde acesso');

  -- 34. Registros personalizados: tipos por org, acesso por tipo, validacao no banco.
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format(
    'INSERT INTO public.record_types (id, organization_id, key, name, access, fields) VALUES (%L, %L, %L, %L, %L, %L)',
    'aaaaaaaa-0000-0000-0014-000000000001', A, 'conta_receber', 'Conta a receber', 'managers',
    '[{"key":"valor","label":"Valor","type":"money","required":true},{"key":"vencimento","label":"Vencimento","type":"date"},
      {"key":"situacao","label":"Situação","type":"select","options":["aberta","paga"]}]')) = 'ok:1', 'owner cria tipo');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format(
    'INSERT INTO public.record_types (id, organization_id, key, name, fields) VALUES (%L, %L, %L, %L, %L)',
    'aaaaaaaa-0000-0000-0014-000000000002', A, 'pedido', 'Pedido', '[{"key":"numero","label":"Número","type":"text"}]')) = 'ok:1', 'owner cria tipo da equipe');
  PERFORM pg_temp.expect_denied(agent_a, format('INSERT INTO public.record_types (organization_id, key, name) VALUES (%L, %L, %L)', A, 'x', 'X'), 'atendente nao cria tipo');
  PERFORM pg_temp.expect_error(owner_a, format('INSERT INTO public.record_types (organization_id, key, name, fields) VALUES (%L, %L, %L, %L)',
    A, 'ruim', 'Ruim', '[{"key":"a","label":"A","type":"select","options":[]}]'), 'lista sem opcoes recusada');

  PERFORM pg_temp.expect_error(owner_a, format('INSERT INTO public.records (organization_id, type_id, data) VALUES (%L, %L, %L)',
    A, 'aaaaaaaa-0000-0000-0014-000000000001', '{"valor":"abc"}'), 'valor invalido recusado');
  PERFORM pg_temp.expect_error(owner_a, format('INSERT INTO public.records (organization_id, type_id, data) VALUES (%L, %L, %L)',
    A, 'aaaaaaaa-0000-0000-0014-000000000001', '{"vencimento":"2026-10-10"}'), 'obrigatorio exigido');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('INSERT INTO public.records (id, organization_id, type_id, data) VALUES (%L, %L, %L, %L)',
    'aaaaaaaa-0000-0000-0015-000000000001', A, 'aaaaaaaa-0000-0000-0014-000000000001',
    '{"valor":"150,50","situacao":"aberta","intruso":"x"}')) = 'ok:1', 'registro valido');
  PERFORM pg_temp.expect((SELECT data = '{"valor": 150.50, "situacao": "aberta"}'::jsonb FROM public.records
    WHERE id = 'aaaaaaaa-0000-0000-0015-000000000001'), 'valor normalizado e chave desconhecida descartada');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT count(*) FROM public.records') = 0, 'atendente nao ve registro de gestores');
  PERFORM pg_temp.expect(pg_temp.q(sup_a, 'SELECT count(*) FROM public.records') = 1, 'supervisor ve registro de gestores');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.record_types') = 0, 'outra org nao ve tipos');
  PERFORM pg_temp.expect(pg_temp.run(agent_a, format('INSERT INTO public.records (organization_id, type_id, data) VALUES (%L, %L, %L)',
    A, 'aaaaaaaa-0000-0000-0014-000000000002', '{"numero":"123"}')) = 'ok:1', 'atendente cria registro da equipe');
  PERFORM pg_temp.expect_error(owner_b, format('INSERT INTO public.records (organization_id, type_id, data) VALUES (%L, %L, %L)',
    'bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0014-000000000002', '{}'), 'outra org nao usa tipo alheio');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('UPDATE public.records SET data = %L WHERE id = %L',
    '{"valor":"200","situacao":"paga"}', 'aaaaaaaa-0000-0000-0015-000000000001')) = 'ok:1', 'owner edita registro');
  PERFORM pg_temp.expect((SELECT count(*) = 1 FROM public.audit_log WHERE action = 'record.updated'
    AND target = 'aaaaaaaa-0000-0000-0015-000000000001' AND meta -> 'fields' ? 'valor'), 'historico registra quais campos');

  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('INSERT INTO public.record_types (organization_id, key, name, fields) VALUES (%L, %L, %L, %L)',
    A, 'contato', 'Campos do contato', '[{"key":"plano","label":"Plano","type":"select","options":["basico","pro"]}]')) = 'ok:1', 'owner define campos do contato');
  PERFORM pg_temp.expect_error(owner_a, format('UPDATE public.contacts SET custom = %L WHERE id = (SELECT contact_id FROM public.conversations WHERE id = %L)',
    '{"plano":"ouro"}', 'aaaaaaaa-0000-0000-0010-000000000001'), 'campo do contato validado');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('UPDATE public.contacts SET custom = %L WHERE id = (SELECT contact_id FROM public.conversations WHERE id = %L)',
    '{"plano":"pro","x":"y"}', 'aaaaaaaa-0000-0000-0010-000000000001')) = 'ok:1', 'preenche campo do contato');
  PERFORM pg_temp.expect((SELECT ct.custom = '{"plano": "pro"}'::jsonb FROM public.contacts ct JOIN public.conversations c ON c.contact_id = ct.id
    WHERE c.id = 'aaaaaaaa-0000-0000-0010-000000000001'), 'campo desconhecido do contato descartado');

  -- 35. Diagnostico (entrevistador): retrato e conversa so de dono/admin da propria org.
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('INSERT INTO public.company_profiles (organization_id, sections) VALUES (%L, %L)',
    A, '{"empresa":"Loja de teste","metas":"crescer 20%"}')) = 'ok:1', 'owner cria retrato');
  INSERT INTO public.interview_messages (organization_id, role, content) VALUES (A, 'assistant', 'Olá!');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT count(*) FROM public.company_profiles') = 0, 'atendente nao ve retrato');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT count(*) FROM public.interview_messages') = 0, 'atendente nao ve entrevista');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.company_profiles') = 0, 'outra org nao ve retrato');
  PERFORM pg_temp.expect(pg_temp.q(admin_a, 'SELECT count(*) FROM public.interview_messages') = 1, 'admin ve entrevista');
  PERFORM pg_temp.expect_error(owner_a, format('UPDATE public.company_profiles SET sections = %L WHERE organization_id = %L',
    '{"senhas":"x"}', A), 'secao desconhecida recusada');
  PERFORM pg_temp.expect_error(owner_a, format('UPDATE public.company_profiles SET suggestions = %L WHERE organization_id = %L',
    '[]', A), 'sugestoes so pelo backend');
  PERFORM pg_temp.expect_denied(owner_b, format('UPDATE public.company_profiles SET use_in_ai = false WHERE organization_id = %L', A), 'outra org nao altera');

  -- 36. Cobrancas: so o backend grava; gestores veem todas; outra org nunca ve.
  INSERT INTO public.charges (id, organization_id, contact_id, provider_id, value, due_date)
  SELECT 'aaaaaaaa-0000-0000-0016-000000000001', A, c.contact_id, 'pay_teste_1', 150, current_date + 3
  FROM public.conversations c WHERE c.id = 'aaaaaaaa-0000-0000-0010-000000000001';
  PERFORM pg_temp.expect_denied(owner_a, format('INSERT INTO public.charges (organization_id, provider_id, value, due_date) VALUES (%L, %L, 10, current_date)',
    A, 'x'), 'navegador nao cria cobranca');
  PERFORM pg_temp.expect_error(owner_a, format('UPDATE public.charges SET status = %L WHERE id = %L', 'paid', 'aaaaaaaa-0000-0000-0016-000000000001'),
    'navegador nao marca como paga');
  PERFORM pg_temp.expect(pg_temp.q(owner_a, 'SELECT count(*) FROM public.charges') = 1, 'owner ve cobranca');
  PERFORM pg_temp.expect(pg_temp.q(sup_a, 'SELECT count(*) FROM public.charges') = 1, 'supervisor ve cobranca');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.charges') = 0, 'outra org nao ve cobranca');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.service_put_secret(%L, %L)', format('org:%s:asaas_api_key', A), 'x'), 'chave do asaas so pelo backend');

  -- 37. Guias de integracao e pedidos de ajuda: config so pelo backend; pedidos visiveis so a quem pode.
  INSERT INTO public.integration_guides (id, organization_id, system, goal, config)
  VALUES ('aaaaaaaa-0000-0000-0017-000000000001', A, 'ERP', 'status do pedido', '{"url":"https://api.exemplo.com"}');
  PERFORM pg_temp.expect(pg_temp.q(owner_a, 'SELECT count(*) FROM public.integration_guides') = 1, 'owner ve guia');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT count(*) FROM public.integration_guides') = 0, 'atendente nao ve guia');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.integration_guides') = 0, 'outra org nao ve guia');
  PERFORM pg_temp.expect_error(owner_a, format('UPDATE public.integration_guides SET config = %L', '{"url":"https://evil"}'), 'config so pelo backend');
  PERFORM pg_temp.expect_error(owner_a, format('INSERT INTO public.integration_guides (organization_id, system, goal) VALUES (%L, %L, %L)', A, 'x', 'y'), 'guia so pelo backend');

  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('INSERT INTO public.service_requests (organization_id, topic, message, created_by) VALUES (%L, %L, %L, %L)',
    A, 'Integração', 'ajuda', owner_a)) = 'ok:1', 'owner pede ajuda');
  PERFORM pg_temp.expect_denied(owner_a, format('INSERT INTO public.service_requests (organization_id, topic, message, created_by) VALUES (%L, %L, %L, %L)',
    A, 'x', 'y', agent_a), 'nao pede em nome de outro');
  PERFORM pg_temp.expect_denied(agent_a, format('INSERT INTO public.service_requests (organization_id, topic, message, created_by) VALUES (%L, %L, %L, %L)',
    A, 'x', 'y', agent_a), 'atendente nao pede');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.service_requests') = 0, 'outra org nao ve pedido');
  PERFORM pg_temp.expect(pg_temp.q(operator, 'SELECT count(*) FROM public.service_requests') >= 1, 'operador ve pedidos');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.platform_set_request_status((SELECT id FROM public.service_requests WHERE organization_id = %L LIMIT 1), %L)', A, 'done'),
    'dono nao muda situacao do pedido');
  PERFORM pg_temp.expect(pg_temp.run(operator, format('SELECT public.platform_set_request_status((SELECT id FROM public.service_requests WHERE organization_id = %L LIMIT 1), %L)', A, 'in_progress')) LIKE 'ok:%',
    'operador muda situacao');

  -- 38. Conectores: conexao so visivel a dono/admin da org; state e aplicativo so backend/operador.
  INSERT INTO public.org_connections (organization_id, connector) VALUES (A, 'bling');
  INSERT INTO public.oauth_states (state, organization_id, connector, user_id) VALUES (repeat('a', 48), A, 'bling', owner_a);
  PERFORM pg_temp.expect(pg_temp.q(owner_a, 'SELECT count(*) FROM public.org_connections') = 1, 'owner ve conexao');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT count(*) FROM public.org_connections') = 0, 'atendente nao ve conexao');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.org_connections') = 0, 'outra org nao ve conexao');
  PERFORM pg_temp.expect_error(owner_a, 'SELECT count(*) FROM public.oauth_states', 'navegador nao le state do oauth');
  PERFORM pg_temp.expect_error(owner_a, format('UPDATE public.org_connections SET status = %L', 'connected'), 'navegador nao altera conexao');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.platform_set_connector_app(%L, %L, %L)', 'bling', 'clienteid123', 'segredo123'), 'dono nao cadastra aplicativo');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.service_put_secret(%L, %L)', format('conn:%s:bling:access', A), 'x'), 'token do conector so pelo backend');

  -- 39. Historico nao se apaga; exportacao so com permissao (tentativa = alerta); busca respeita visibilidade.
  PERFORM pg_temp.expect((SELECT organization_id = A AND email_account_id IS NULL FROM public.conversations
    WHERE id = 'aaaaaaaa-0000-0000-0010-000000000032'), 'caixa apagada mantem a conversa');
  PERFORM pg_temp.expect_error(owner_a, format('DELETE FROM public.conversations WHERE id = %L', 'aaaaaaaa-0000-0000-0004-000000000001'), 'dono nao apaga conversa');
  PERFORM pg_temp.expect_error(owner_a, format('DELETE FROM public.messages WHERE conversation_id = %L', 'aaaaaaaa-0000-0000-0004-000000000001'), 'dono nao apaga mensagem');
  PERFORM pg_temp.expect_error(agent_a, format('UPDATE public.messages SET content = %L WHERE conversation_id = %L', 'x', 'aaaaaaaa-0000-0000-0004-000000000001'), 'atendente nao edita mensagem');
  PERFORM pg_temp.expect_error(owner_a, 'DELETE FROM public.tickets', 'dono nao apaga atendimento');
  PERFORM pg_temp.expect_error(owner_a, 'DELETE FROM public.ticket_events', 'dono nao apaga evento');
  PERFORM pg_temp.expect_error(owner_a, 'DELETE FROM public.internal_notes', 'dono nao apaga nota');
  -- Segunda barreira: permissao devolvida por engano continua bloqueada pelo gatilho.
  CREATE POLICY iso_tmp_delete ON public.messages FOR DELETE TO authenticated USING (true);
  GRANT DELETE ON public.messages TO authenticated;
  PERFORM pg_temp.expect_error(owner_a, format('DELETE FROM public.messages WHERE conversation_id = %L', 'aaaaaaaa-0000-0000-0004-000000000001'), 'gatilho barra apagar mensagem');
  REVOKE DELETE ON public.messages FROM authenticated;
  DROP POLICY iso_tmp_delete ON public.messages;
  -- Apagada pelo cliente: so marca.
  UPDATE public.messages SET provider_message_id = 'iso-del-1' WHERE conversation_id = 'aaaaaaaa-0000-0000-0004-000000000001';
  PERFORM pg_temp.expect(public.service_mark_message_deleted(A, 'iso-del-1', 'contact') = 1, 'marca apagada pelo cliente');
  PERFORM pg_temp.expect((SELECT deleted_by = 'contact' AND content = 'oi' FROM public.messages WHERE provider_message_id = 'iso-del-1'), 'mensagem continua guardada');
  PERFORM pg_temp.expect(public.service_mark_message_deleted('bbbbbbbb-0000-0000-0000-000000000001', 'iso-del-1', 'contact') = 0, 'outra org nao marca');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.service_mark_message_deleted(%L, %L, %L)', A, 'iso-del-1', 'phone'), 'navegador nao marca apagada');
  -- Exportacao.
  PERFORM pg_temp.expect(pg_temp.t(owner_a, format('SELECT public.export_contacts(%L) ->> %L', A, 'ok')) = 'true', 'dono exporta');
  PERFORM pg_temp.expect(pg_temp.t(owner_a, format('SELECT public.export_contacts(%L) ->> %L', A, 'count'))
    = (SELECT count(*)::text FROM public.contacts WHERE organization_id = A), 'exporta so os contatos da org');
  PERFORM pg_temp.expect((SELECT count(*) FROM public.audit_log WHERE organization_id = A AND action = 'contacts.export') = 2, 'exportacao auditada');
  PERFORM pg_temp.expect(pg_temp.t(agent_a, format('SELECT public.export_contacts(%L) ->> %L', A, 'ok')) = 'false', 'atendente nao exporta');
  PERFORM pg_temp.expect(pg_temp.t(sup_a, format('SELECT public.export_contacts(%L) ->> %L', A, 'ok')) = 'false', 'supervisor nao exporta');
  PERFORM pg_temp.expect(pg_temp.t(agent_a, format('SELECT public.export_contacts(%L) ->> %L', A, 'ok')) = 'false', 'atendente tenta de novo');
  PERFORM pg_temp.expect((SELECT count(*) FROM public.audit_log WHERE organization_id = A AND action = 'security.export_denied') = 3, 'tentativas auditadas');
  PERFORM pg_temp.expect((SELECT count(*) FROM public.notifications WHERE organization_id = A AND kind = 'security_alert'
    AND ref ->> 'by' = agent_a::text) = 2, 'dono e admin avisados uma vez');
  PERFORM pg_temp.expect((SELECT count(*) FROM public.notifications WHERE organization_id = A AND kind = 'security_alert'
    AND user_id NOT IN (owner_a, admin_a)) = 0, 'so dono e admin recebem alerta');
  PERFORM pg_temp.expect(pg_temp.t(owner_b, format('SELECT public.export_contacts(%L) ->> %L', A, 'ok')) = 'false', 'outra org nao exporta');
  PERFORM pg_temp.expect((SELECT count(*) FROM public.audit_log WHERE organization_id = A AND actor_id = owner_b) = 0, 'outra org nao gera registro em A');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT private.security_alert(%L, %L, %L)', A, 'x', '{}'), 'alerta so interno');
  -- Busca no texto.
  INSERT INTO public.messages (conversation_id, direction, sender, content) VALUES
    ('aaaaaaaa-0000-0000-0004-000000000001', 'inbound', 'contact', 'meu pedido esta atrasado'),
    ('aaaaaaaa-0000-0000-0004-000000000003', 'inbound', 'contact', 'pedido atrasado de novo');
  PERFORM pg_temp.expect(pg_temp.t(agent_a, format('SELECT string_agg(right(conversation_id::text, 1), %L) FROM public.search_messages(%L, %L)', '', A, 'atrasado')) = '1', 'atendente acha so o que ve');
  PERFORM pg_temp.expect(pg_temp.q(owner_a, format('SELECT count(*) FROM public.search_messages(%L, %L)', A, 'ATRASADO')) = 2, 'dono acha todas');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, format('SELECT count(*) FROM public.search_messages(%L, %L)', A, 'atrasado')) = 0, 'outra org nao acha');
  PERFORM pg_temp.expect(pg_temp.q(owner_a, format('SELECT count(*) FROM public.search_messages(%L, %L)', A, '%')) = 0, 'curinga nao lista tudo');

  -- 40. Transbordo: setor ajudante ve e assume so a fila parada (sem responsavel); nunca outra org.
  INSERT INTO public.conversations (id, instance_id, contact_phone, department_id) VALUES
    ('aaaaaaaa-0000-0000-0040-000000000001', 'aaaaaaaa-0000-0000-0003-000000000001', '5511900000040', 'aaaaaaaa-0000-0000-0001-000000000001');
  INSERT INTO public.tickets (id, organization_id, conversation_id, protocol, status, department_id, queued_at) VALUES
    ('aaaaaaaa-0000-0000-0040-000000000002', A, 'aaaaaaaa-0000-0000-0040-000000000001', 'ISO-40', 'queued',
     'aaaaaaaa-0000-0000-0001-000000000001', now());
  PERFORM pg_temp.expect(pg_temp.q(agent2_a, format('SELECT count(*) FROM public.conversations WHERE id = %L', 'aaaaaaaa-0000-0000-0040-000000000001')) = 0, 'sem transbordo: D2 nao ve fila de D1');
  PERFORM pg_temp.expect_denied(agent2_a, format('UPDATE public.departments SET overflow_to = ARRAY[%L]::uuid[], overflow_after_minutes = 5 WHERE id = %L',
    'aaaaaaaa-0000-0000-0001-000000000002', 'aaaaaaaa-0000-0000-0001-000000000001'), 'atendente nao configura transbordo');
  PERFORM pg_temp.expect_error(owner_a, format('UPDATE public.departments SET overflow_to = ARRAY[%L]::uuid[] WHERE id = %L',
    'bbbbbbbb-0000-0000-0001-000000000001', 'aaaaaaaa-0000-0000-0001-000000000001'), 'setor de outra org recusado');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('UPDATE public.departments SET overflow_to = ARRAY[%L, %L]::uuid[], overflow_after_minutes = 5 WHERE id = %L',
    'aaaaaaaa-0000-0000-0001-000000000002', 'aaaaaaaa-0000-0000-0001-000000000001', 'aaaaaaaa-0000-0000-0001-000000000001')) = 'ok:1', 'dono configura transbordo');
  PERFORM pg_temp.expect((SELECT overflow_to = ARRAY['aaaaaaaa-0000-0000-0001-000000000002']::uuid[] FROM public.departments
    WHERE id = 'aaaaaaaa-0000-0000-0001-000000000001'), 'proprio setor tirado da lista');
  PERFORM pg_temp.expect(pg_temp.q(agent2_a, format('SELECT count(*) FROM public.conversations WHERE id = %L', 'aaaaaaaa-0000-0000-0040-000000000001')) = 0, 'fila recente: ainda nao ve');
  UPDATE public.tickets SET queued_at = now() - interval '10 minutes' WHERE id = 'aaaaaaaa-0000-0000-0040-000000000002';
  PERFORM pg_temp.expect(pg_temp.q(agent2_a, format('SELECT count(*) FROM public.conversations WHERE id = %L', 'aaaaaaaa-0000-0000-0040-000000000001')) = 1, 'fila parada: ajudante ve');
  PERFORM pg_temp.expect(pg_temp.q(agent2_a, format('SELECT count(*) FROM public.conversations WHERE id IN (%L, %L)',
    'aaaaaaaa-0000-0000-0004-000000000001', 'aaaaaaaa-0000-0000-0004-000000000005')) = 0, 'ajudante nao ve atribuidas');
  PERFORM pg_temp.expect(pg_temp.q(agent_b, format('SELECT count(*) FROM public.conversations WHERE organization_id = %L', A)) = 0, 'outra org continua sem ver');
  PERFORM private.drain_all();
  PERFORM pg_temp.expect((SELECT overflow_at IS NOT NULL FROM public.tickets WHERE id = 'aaaaaaaa-0000-0000-0040-000000000002'), 'marcado como transbordo');
  PERFORM pg_temp.expect(EXISTS (SELECT 1 FROM public.ticket_events WHERE ticket_id = 'aaaaaaaa-0000-0000-0040-000000000002' AND type = 'overflow'), 'evento de transbordo');
  PERFORM pg_temp.expect(pg_temp.run(agent2_a, format('SELECT public.claim_ticket(%L)', 'aaaaaaaa-0000-0000-0040-000000000002')) LIKE 'ok:%', 'ajudante assume');
  PERFORM pg_temp.expect((SELECT assigned_to = agent2_a AND overflow_at IS NULL AND department_id = 'aaaaaaaa-0000-0000-0001-000000000001'
    FROM public.tickets WHERE id = 'aaaaaaaa-0000-0000-0040-000000000002'), 'assumido fica no setor de origem, marca limpa');
  PERFORM pg_temp.expect(pg_temp.q(agent2_a, format('SELECT count(*) FROM public.conversations WHERE id = %L', 'aaaaaaaa-0000-0000-0040-000000000001')) = 1, 'quem assumiu continua vendo');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, format('SELECT count(*) FROM public.conversations WHERE id = %L', 'aaaaaaaa-0000-0000-0040-000000000001')) = 0, 'atendente de D1 (own_and_queue) deixa de ver apos assumido');

  -- 41. Avaliacao automatica: so com a empresa ligando; atendente ve as proprias; supervisao so do seu setor; ninguem grava pelo navegador.
  INSERT INTO public.conversations (id, instance_id, contact_phone, department_id) VALUES
    ('aaaaaaaa-0000-0000-0041-000000000001', 'aaaaaaaa-0000-0000-0003-000000000001', '5511900000041', 'aaaaaaaa-0000-0000-0001-000000000001'),
    ('aaaaaaaa-0000-0000-0041-000000000002', 'aaaaaaaa-0000-0000-0003-000000000001', '5511900000042', 'aaaaaaaa-0000-0000-0001-000000000002');
  INSERT INTO public.tickets (id, organization_id, conversation_id, protocol, status, department_id, assigned_to, opened_at) VALUES
    ('aaaaaaaa-0000-0000-0041-000000000011', A, 'aaaaaaaa-0000-0000-0041-000000000001', 'ISO-41A', 'open', 'aaaaaaaa-0000-0000-0001-000000000001', agent_a, now()),
    ('aaaaaaaa-0000-0000-0041-000000000012', A, 'aaaaaaaa-0000-0000-0041-000000000002', 'ISO-41B', 'open', 'aaaaaaaa-0000-0000-0001-000000000002', agent2_a, now());
  UPDATE public.tickets SET status = 'closed', closed_at = now() WHERE id = 'aaaaaaaa-0000-0000-0041-000000000011';
  PERFORM pg_temp.expect(NOT EXISTS (SELECT 1 FROM public.ticket_reviews WHERE ticket_id = 'aaaaaaaa-0000-0000-0041-000000000011'), 'desligado: nao avalia');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.set_auto_review(%L, true)', A), 'atendente nao liga avaliacao');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.set_auto_review(%L, true)', A), 'outra org nao liga avaliacao');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('SELECT public.set_auto_review(%L, true)', A)) LIKE 'ok:%', 'dono liga avaliacao');
  UPDATE public.tickets SET status = 'open', closed_at = NULL WHERE id = 'aaaaaaaa-0000-0000-0041-000000000011';
  UPDATE public.tickets SET status = 'closed', closed_at = now() WHERE id IN ('aaaaaaaa-0000-0000-0041-000000000011', 'aaaaaaaa-0000-0000-0041-000000000012');
  PERFORM pg_temp.expect((SELECT agent_id = agent_a AND department_id = 'aaaaaaaa-0000-0000-0001-000000000001' AND status = 'pending'
    FROM public.ticket_reviews WHERE ticket_id = 'aaaaaaaa-0000-0000-0041-000000000011'), 'fila de avaliacao com atendente e setor');
  UPDATE public.ticket_reviews SET status = 'done', score = 8, satisfied = 'sim' WHERE organization_id = A;
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT count(*) FROM public.ticket_reviews') = 1, 'atendente ve so a propria');
  PERFORM pg_temp.expect(pg_temp.q(agent2_a, format('SELECT count(*) FROM public.ticket_reviews WHERE agent_id = %L', agent_a)) = 0, 'colega nao ve avaliacao alheia');
  PERFORM pg_temp.expect(pg_temp.q(sup_a, format('SELECT count(*) FROM public.ticket_reviews WHERE ticket_id = %L', 'aaaaaaaa-0000-0000-0041-000000000011')) = 1, 'supervisor ve do seu setor');
  PERFORM pg_temp.expect(pg_temp.q(sup_a, format('SELECT count(*) FROM public.ticket_reviews WHERE ticket_id = %L', 'aaaaaaaa-0000-0000-0041-000000000012')) = 0, 'supervisor nao ve de outro setor');
  PERFORM pg_temp.expect(pg_temp.q(owner_a, 'SELECT count(*) FROM public.ticket_reviews') = 2, 'dono ve todas');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.ticket_reviews') = 0, 'outra org nao ve');
  PERFORM pg_temp.expect_error(agent_a, 'UPDATE public.ticket_reviews SET score = 10', 'atendente nao altera nota');
  PERFORM pg_temp.expect_error(owner_a, 'DELETE FROM public.ticket_reviews', 'dono nao apaga avaliacao');
  PERFORM pg_temp.expect_error(owner_a, format('INSERT INTO public.ticket_reviews (organization_id, ticket_id) VALUES (%L, %L)', A, 'aaaaaaaa-0000-0000-0040-000000000002'), 'navegador nao cria avaliacao');

  -- 42. Entrevistador 2.0: etapa so dono/admin; plano e pesquisa so pelo backend; secoes novas internas validadas.
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('UPDATE public.company_profiles SET stage = %L, sections = sections || %L::jsonb WHERE organization_id = %L',
    'cultura', '{"cultura":"Missao: atender bem"}', A)) = 'ok:1', 'dono muda etapa e grava cultura');
  PERFORM pg_temp.expect_error(owner_a, format('UPDATE public.company_profiles SET stage = %L WHERE organization_id = %L', 'invalida', A), 'etapa invalida recusada');
  PERFORM pg_temp.expect_error(owner_a, format('UPDATE public.company_profiles SET plan = %L::jsonb WHERE organization_id = %L', '{"x":1}', A), 'plano so pelo backend');
  PERFORM pg_temp.expect_error(owner_a, format('UPDATE public.company_profiles SET public_research = %L::jsonb WHERE organization_id = %L', '{"x":1}', A), 'pesquisa so pelo backend');
  PERFORM pg_temp.expect_denied(agent_a, format('UPDATE public.company_profiles SET stage = %L WHERE organization_id = %L', 'setores', A), 'atendente nao muda etapa');
  PERFORM pg_temp.expect_denied(owner_b, format('UPDATE public.company_profiles SET stage = %L WHERE organization_id = %L', 'setores', A), 'outra org nao muda etapa');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, format('SELECT count(*) FROM public.company_profiles WHERE organization_id = %L', A)) = 0, 'outra org nao ve o plano');

  -- 43. Campanhas: so dono/admin; numero e grupos da propria org; lista montada no banco sem opt-out; iniciada nao se edita.
  INSERT INTO public.contact_groups (id, organization_id, name) VALUES
    ('aaaaaaaa-0000-0000-0043-000000000001', A, 'ISO clientes'),
    ('bbbbbbbb-0000-0000-0043-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'ISO B');
  INSERT INTO public.contacts (id, organization_id, phone, name, opted_out_at) VALUES
    ('aaaaaaaa-0000-0000-0043-000000000011', A, '5511943000001', 'Ana Cliente', NULL),
    ('aaaaaaaa-0000-0000-0043-000000000012', A, '5511943000002', 'Bruno Saiu', now());
  INSERT INTO public.contact_group_members (organization_id, group_id, contact_id) VALUES
    (A, 'aaaaaaaa-0000-0000-0043-000000000001', 'aaaaaaaa-0000-0000-0043-000000000011'),
    (A, 'aaaaaaaa-0000-0000-0043-000000000001', 'aaaaaaaa-0000-0000-0043-000000000012');
  PERFORM pg_temp.expect_error(agent_a, format('INSERT INTO public.campaigns (organization_id, name) VALUES (%L, %L)', A, 'x'), 'atendente nao cria campanha');
  PERFORM pg_temp.expect_denied(sup_a, format('INSERT INTO public.campaigns (organization_id, name) VALUES (%L, %L)', A, 'x'), 'supervisor nao cria campanha');
  PERFORM pg_temp.expect_error(owner_a, format('INSERT INTO public.campaigns (organization_id, name, group_ids) VALUES (%L, %L, ARRAY[%L]::uuid[])',
    A, 'x', 'bbbbbbbb-0000-0000-0043-000000000001'), 'grupo de outra org recusado');
  PERFORM pg_temp.expect_error(owner_a, format('INSERT INTO public.campaigns (organization_id, name, instance_id) VALUES (%L, %L, %L)',
    A, 'x', 'bbbbbbbb-0000-0000-0003-000000000001'), 'numero de outra org recusado');
  PERFORM pg_temp.expect_error(owner_a, format('INSERT INTO public.campaigns (organization_id, name, status) VALUES (%L, %L, %L)', A, 'x', 'running'), 'nao nasce em andamento');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format(
    'INSERT INTO public.campaigns (id, organization_id, name, instance_id, group_ids, message) VALUES (%L, %L, %L, %L, ARRAY[%L]::uuid[], %L)',
    'aaaaaaaa-0000-0000-0043-000000000021', A, 'Promo', 'aaaaaaaa-0000-0000-0003-000000000001', 'aaaaaaaa-0000-0000-0043-000000000001', 'Oi {nome}!')) = 'ok:1', 'dono cria rascunho');
  PERFORM pg_temp.expect(pg_temp.t(owner_a, format('SELECT public.campaign_audience(%L, ARRAY[%L]::uuid[]) ->> %L', A, 'aaaaaaaa-0000-0000-0043-000000000001', 'recebem')) = '1', 'previa desconta opt-out');
  PERFORM pg_temp.expect(pg_temp.t(agent_a, format('SELECT coalesce(public.campaign_audience(%L, ARRAY[%L]::uuid[])::text, %L)', A, 'aaaaaaaa-0000-0000-0043-000000000001', 'nulo')) = 'nulo', 'atendente nao ve previa');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.start_campaign(%L)', 'aaaaaaaa-0000-0000-0043-000000000021'), 'atendente nao inicia');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.start_campaign(%L)', 'aaaaaaaa-0000-0000-0043-000000000021'), 'outra org nao inicia');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('SELECT public.start_campaign(%L)', 'aaaaaaaa-0000-0000-0043-000000000021')) LIKE 'ok:%', 'dono inicia');
  PERFORM pg_temp.expect((SELECT status = 'running' AND total = 2 AND skipped = 1 FROM public.campaigns WHERE id = 'aaaaaaaa-0000-0000-0043-000000000021'), 'lista congelada com opt-out pulado');
  PERFORM pg_temp.expect((SELECT status FROM public.campaign_recipients WHERE contact_id = 'aaaaaaaa-0000-0000-0043-000000000012') = 'skipped', 'quem saiu nao recebe');
  PERFORM pg_temp.expect_denied(owner_a, format('UPDATE public.campaigns SET message = %L WHERE id = %L', 'mudei', 'aaaaaaaa-0000-0000-0043-000000000021'), 'iniciada nao se edita');
  PERFORM pg_temp.expect_denied(owner_a, format('DELETE FROM public.campaigns WHERE id = %L', 'aaaaaaaa-0000-0000-0043-000000000021'), 'iniciada nao se apaga');
  PERFORM pg_temp.expect_error(owner_a, 'INSERT INTO public.campaign_recipients (organization_id, campaign_id, contact_id, phone) SELECT organization_id, campaign_id, contact_id, phone FROM public.campaign_recipients LIMIT 1', 'navegador nao insere destinatario');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT count(*) FROM public.campaign_recipients') = 0, 'atendente nao ve destinatarios');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.campaigns') = 0, 'outra org nao ve campanha');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('SELECT public.set_campaign_status(%L, %L)', 'aaaaaaaa-0000-0000-0043-000000000021', 'paused')) LIKE 'ok:%', 'dono pausa');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.set_campaign_status(%L, %L)', 'aaaaaaaa-0000-0000-0043-000000000021', 'done'), 'status invalido recusado');

  -- 44. LGPD: anonimizar troca os dados pessoais e mantem a estrutura; so o backend; so a propria org.
  INSERT INTO public.conversations (id, instance_id, contact_phone, contact_name) VALUES
    ('aaaaaaaa-0000-0000-0044-000000000001', 'aaaaaaaa-0000-0000-0003-000000000001', '5511944000001', 'Carla Titular');
  UPDATE public.contacts SET email = 'carla@exemplo.test', document = '12345678900', notes = 'cliente vip'
  WHERE organization_id = A AND phone = '5511944000001';
  INSERT INTO public.messages (conversation_id, direction, sender, content, media_path) VALUES
    ('aaaaaaaa-0000-0000-0044-000000000001', 'inbound', 'contact', 'meu CPF e 123.456.789-00', A::text || '/x/foto.jpg');
  INSERT INTO public.internal_notes (organization_id, conversation_id, content, author_id) VALUES
    (A, 'aaaaaaaa-0000-0000-0044-000000000001', 'ligar para Carla depois', owner_a);
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.service_anonymize_contact(%L, (SELECT id FROM public.contacts WHERE phone = %L), %L, %L)',
    A, '5511944000001', owner_a, 'teste'), 'navegador nao chama anonimizacao');
  PERFORM pg_temp.expect(pg_temp.run(NULL, format('SELECT public.service_anonymize_contact(%L, (SELECT id FROM public.contacts WHERE organization_id = %L AND phone = %L), %L, %L)',
    'bbbbbbbb-0000-0000-0000-000000000001', A, '5511944000001', owner_b, 'x')) LIKE 'err:%', 'outra org nao anonimiza contato de A');
  PERFORM pg_temp.expect((public.service_anonymize_contact(A, (SELECT id FROM public.contacts WHERE organization_id = A AND phone = '5511944000001'),
    owner_a, 'pedido do titular') ->> 'media') LIKE '%foto.jpg%', 'devolve arquivos para apagar');
  PERFORM pg_temp.expect((SELECT name = 'Anonimizado' AND phone IS NULL AND email IS NULL AND document IS NULL AND notes IS NULL
    AND anonymized_at IS NOT NULL AND opted_out_at IS NOT NULL FROM public.contacts c
    JOIN public.conversations v ON v.contact_id = c.id WHERE v.id = 'aaaaaaaa-0000-0000-0044-000000000001'), 'contato sem dados pessoais');
  PERFORM pg_temp.expect((SELECT contact_name = 'Anonimizado' AND contact_phone LIKE 'anon-%' FROM public.conversations
    WHERE id = 'aaaaaaaa-0000-0000-0044-000000000001'), 'conversa sem nome e telefone');
  PERFORM pg_temp.expect((SELECT bool_and(content LIKE '[conteúdo removido%' AND media_path IS NULL) FROM public.messages
    WHERE conversation_id = 'aaaaaaaa-0000-0000-0044-000000000001'), 'mensagens sem conteudo e arquivo');
  PERFORM pg_temp.expect((SELECT count(*) FROM public.messages WHERE conversation_id = 'aaaaaaaa-0000-0000-0044-000000000001') = 1, 'historico continua (estrutura)');
  PERFORM pg_temp.expect((SELECT bool_and(content LIKE '[nota removida%') FROM public.internal_notes
    WHERE conversation_id = 'aaaaaaaa-0000-0000-0044-000000000001'), 'notas sem dado pessoal');
  PERFORM pg_temp.expect(EXISTS (SELECT 1 FROM public.audit_log WHERE organization_id = A AND action = 'contact.anonymize'
    AND meta ->> 'motivo' = 'pedido do titular'), 'auditado com motivo');

  -- 45. MFA: com fator ativado, sessao so com senha nao tem permissao; empresa pode exigir de dono/admin; operador so com codigo.
  PERFORM set_config('test.aal', 'aal1', true);
  PERFORM pg_temp.expect(pg_temp.q(owner_a, format('SELECT cardinality(public.my_permissions(%L))', A)) > 0, 'sem MFA e sem exigencia: dono entra so com senha');
  UPDATE public.organizations SET settings = settings || '{"require_mfa": true}'::jsonb WHERE id = A;
  PERFORM pg_temp.expect(pg_temp.q(owner_a, format('SELECT cardinality(public.my_permissions(%L))', A)) = 0, 'exigido: dono sem codigo fica sem acesso');
  PERFORM pg_temp.expect(pg_temp.q(owner_a, 'SELECT count(*) FROM public.conversations') = 0, 'exigido: dono sem codigo nao le conversas');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, format('SELECT cardinality(public.my_permissions(%L))', A)) > 0, 'exigencia vale so para dono/admin');
  PERFORM pg_temp.expect(pg_temp.t(owner_a, 'SELECT public.my_mfa_status() ->> ''required''') = 'true', 'tela sabe que precisa ativar');
  INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  VALUES (gen_random_uuid(), agent_a, 'iso', 'totp', 'verified', now(), now());
  PERFORM pg_temp.expect(pg_temp.q(agent_a, format('SELECT cardinality(public.my_permissions(%L))', A)) = 0, 'com fator: so senha nao basta');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT count(*) FROM public.conversations') = 0, 'com fator: so senha nao le conversas');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.set_require_mfa(%L, false)', A), 'sem codigo nao mexe na exigencia');
  PERFORM pg_temp.expect_error(operator, 'SELECT public.platform_org_overview()', 'operador sem codigo nao ve a plataforma');
  PERFORM set_config('test.aal', 'aal2', true);
  PERFORM pg_temp.expect(pg_temp.q(agent_a, format('SELECT cardinality(public.my_permissions(%L))', A)) > 0, 'com codigo: atendente entra');
  PERFORM pg_temp.expect(pg_temp.q(owner_a, format('SELECT cardinality(public.my_permissions(%L))', A)) > 0, 'com codigo: dono entra');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.set_require_mfa(%L, true)', A), 'so exige quem tem MFA ativado');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.set_require_mfa(%L, false)', A), 'atendente nao mexe na exigencia');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('SELECT public.set_require_mfa(%L, false)', A)) LIKE 'ok:%', 'dono desliga exigencia');
  PERFORM pg_temp.expect(pg_temp.run(operator, 'SELECT public.platform_org_overview()') LIKE 'ok:%', 'operador com codigo ve a plataforma');
  DELETE FROM auth.mfa_factors WHERE user_id = agent_a;

  -- 46. Codigos de recuperacao: so o backend le/grava; cada pessoa ve so quantos restam dela.
  INSERT INTO public.mfa_recovery_codes (user_id, code_hash) VALUES
    (agent_a, repeat('a', 64)), (agent_a, repeat('b', 64)), (owner_a, repeat('c', 64));
  PERFORM pg_temp.expect_error(agent_a, 'SELECT count(*) FROM public.mfa_recovery_codes', 'navegador nao le codigos');
  PERFORM pg_temp.expect_error(agent_a, format('INSERT INTO public.mfa_recovery_codes (user_id, code_hash) VALUES (%L, %L)', agent_a, repeat('d', 64)), 'navegador nao grava codigo');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT public.my_recovery_codes_left()') = 2, 'atendente ve so os dele');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT public.my_recovery_codes_left()') = 0, 'outra pessoa nao ve os de ninguem');

  -- 47. Texto lido pela IA (imagem/PDF): navegador nao grava; anonimizacao LGPD apaga.
  INSERT INTO public.conversations (id, instance_id, contact_phone, contact_name) VALUES
    ('aaaaaaaa-0000-0000-0047-000000000001', 'aaaaaaaa-0000-0000-0003-000000000001', '5511947000001', 'Davi Comprovante');
  INSERT INTO public.messages (conversation_id, direction, sender, content, type, media_text) VALUES
    ('aaaaaaaa-0000-0000-0047-000000000001', 'inbound', 'contact', '[imagem]', 'image', 'Comprovante PIX de Davi Silva, CPF 123.456.789-00, R$ 50,00');
  PERFORM pg_temp.expect_error(agent_a, format('UPDATE public.messages SET media_text = %L WHERE conversation_id = %L', 'x', 'aaaaaaaa-0000-0000-0047-000000000001'), 'navegador nao grava texto lido');
  PERFORM public.service_anonymize_contact(A, (SELECT id FROM public.contacts WHERE organization_id = A AND phone = '5511947000001'), owner_a, 'pedido do titular');
  PERFORM pg_temp.expect((SELECT bool_and(media_text IS NULL) FROM public.messages WHERE conversation_id = 'aaaaaaaa-0000-0000-0047-000000000001'), 'anonimizacao apaga texto lido');
  -- 48. Diagnostico: recomecar guarda copia e zera; desfazer restaura; so dono/admin da propria org.
  UPDATE public.company_profiles SET sections = '{"empresa":"texto antigo"}'::jsonb, stage = 'setores' WHERE organization_id = A;
  INSERT INTO public.interview_messages (organization_id, role, content) VALUES (A, 'user', 'conversa antiga');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.reset_company_profile(%L)', A), 'atendente nao zera');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.reset_company_profile(%L)', A), 'outra org nao zera');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('SELECT public.reset_company_profile(%L)', A)) LIKE 'ok:%', 'dono zera');
  PERFORM pg_temp.expect((SELECT sections = '{}'::jsonb AND stage = 'empresa' AND plan = '{}'::jsonb FROM public.company_profiles WHERE organization_id = A), 'retrato zerado');
  PERFORM pg_temp.expect(NOT EXISTS (SELECT 1 FROM public.interview_messages WHERE organization_id = A), 'conversa zerada');
  PERFORM pg_temp.expect(pg_temp.q(owner_a, format('SELECT public.company_profile_snapshots_count(%L)', A)) = 1, 'copia guardada');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, format('SELECT public.company_profile_snapshots_count(%L)', A)) = 0, 'outra org nao ve copia');
  PERFORM pg_temp.expect_error(owner_a, 'SELECT count(*) FROM public.company_profile_snapshots', 'navegador nao le copia');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.restore_company_profile(%L)', A), 'outra org nao restaura');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('SELECT public.restore_company_profile(%L)', A)) LIKE 'ok:%', 'dono desfaz');
  PERFORM pg_temp.expect((SELECT sections ->> 'empresa' = 'texto antigo' AND stage = 'setores' FROM public.company_profiles WHERE organization_id = A), 'retrato restaurado');
  PERFORM pg_temp.expect(EXISTS (SELECT 1 FROM public.interview_messages WHERE organization_id = A AND content = 'conversa antiga'), 'conversa restaurada');

  -- 49. Ciclo de melhoria: aprova quem pode (dono/admin ou supervisor do setor); no ar guarda o antes; monitor avalia e cria correcao.
  PERFORM pg_temp.expect(pg_temp.run(sup_a, format('SELECT public.create_improvement(%L, %L, %L, %L, %L, %L)',
    A, 'Lembrete de pagamento', 'Clientes esquecem o vencimento', '1. Criar fluxo', 'automacao', 'aaaaaaaa-0000-0000-0001-000000000001')) LIKE 'ok:%', 'supervisor cria melhoria do setor');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('SELECT public.create_improvement(%L, %L, %L, %L, %L, %L)',
    A, 'Treinar equipe D2', '', '', 'processo', 'aaaaaaaa-0000-0000-0001-000000000002')) LIKE 'ok:%', 'dono cria melhoria de outro setor');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.create_improvement(%L, %L, %L, %L, %L, NULL)', A, 'x', '', '', 'processo'), 'atendente nao cria melhoria');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.improvements') = 0, 'outra org nao ve melhorias');
  PERFORM pg_temp.expect(pg_temp.q(sup_a, format('SELECT count(*) FROM public.improvements WHERE title = %L', 'Treinar equipe D2')) = 0, 'supervisor nao ve melhoria de outro setor');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.approve_improvement((SELECT id FROM public.improvements WHERE title = %L))', 'Lembrete de pagamento'), 'atendente nao aprova');
  PERFORM pg_temp.expect_error(sup_a, format('SELECT public.approve_improvement(%L)', (SELECT id FROM public.improvements WHERE title = 'Treinar equipe D2')), 'supervisor nao aprova de outro setor');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.set_improvement_live(%L, 7)', (SELECT id FROM public.improvements WHERE title = 'Lembrete de pagamento')), 'nao vai ao ar sem aprovar');
  PERFORM pg_temp.expect(pg_temp.run(sup_a, format('SELECT public.approve_improvement(%L)', (SELECT id FROM public.improvements WHERE title = 'Lembrete de pagamento'))) LIKE 'ok:%', 'supervisor do setor aprova');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.link_improvement_artifact(%L, %L, %L)', (SELECT id FROM public.improvements WHERE title = 'Lembrete de pagamento'),
    'flow', (SELECT id FROM public.flows WHERE organization_id = 'bbbbbbbb-0000-0000-0000-000000000001' LIMIT 1)), 'nao liga fluxo de outra org');
  PERFORM pg_temp.expect(pg_temp.run(sup_a, format('SELECT public.set_improvement_live(%L, 7)', (SELECT id FROM public.improvements WHERE title = 'Lembrete de pagamento'))) LIKE 'ok:%', 'supervisor coloca no ar');
  PERFORM pg_temp.expect((SELECT status = 'no_ar' AND metrics_before IS NOT NULL FROM public.improvements WHERE title = 'Lembrete de pagamento'), 'no ar com metricas de antes');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.discard_improvement(%L, %L)', (SELECT id FROM public.improvements WHERE title = 'Lembrete de pagamento'), 'x'), 'no ar nao se descarta');
  PERFORM pg_temp.expect_error(owner_a, format('UPDATE public.improvements SET result = %L', 'funcionou'), 'navegador nao grava resultado');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.service_add_improvements(%L, %L, %L::jsonb)', A, 'plano', '[]'), 'navegador nao grava pelo backend');
  -- Simula piora: antes 90% satisfeitos / nota 9; depois 12 atendimentos avaliados insatisfeitos.
  UPDATE public.improvements SET metrics_before = '{"satisfeitos_pct": 90, "nota_media": 9}'::jsonb, live_at = now() - interval '1 minute'
  WHERE title = 'Lembrete de pagamento';
  INSERT INTO public.tickets (id, organization_id, conversation_id, protocol, status, department_id, closed_at)
  SELECT ('aaaaaaaa-0000-0000-0049-0000000000' || lpad(g::text, 2, '0'))::uuid, A, 'aaaaaaaa-0000-0000-0004-000000000002',
         'ISO-49-' || g, 'closed', 'aaaaaaaa-0000-0000-0001-000000000001', now()
  FROM generate_series(1, 12) g;
  INSERT INTO public.ticket_reviews (organization_id, ticket_id, department_id, status, satisfied, score, reviewed_at)
  SELECT A, ('aaaaaaaa-0000-0000-0049-0000000000' || lpad(g::text, 2, '0'))::uuid, 'aaaaaaaa-0000-0000-0001-000000000001', 'done', 'nao', 2, now()
  FROM generate_series(1, 12) g;
  PERFORM private.evaluate_improvement((SELECT id FROM public.improvements WHERE title = 'Lembrete de pagamento'));
  PERFORM pg_temp.expect((SELECT status = 'resultado' AND result = 'nao_funcionou' FROM public.improvements WHERE title = 'Lembrete de pagamento'), 'monitor: nao funcionou');
  PERFORM pg_temp.expect((SELECT source = 'monitor' AND version = 2 AND status = 'sugerida' AND parent_id IS NOT NULL
    FROM public.improvements WHERE title = 'Ajustar: Lembrete de pagamento'), 'correcao v2 sugerida');
  PERFORM pg_temp.expect((SELECT count(DISTINCT user_id) FROM public.notifications WHERE organization_id = A AND kind = 'improvement'
    AND user_id IN (owner_a, admin_a, sup_a)) = 3, 'dono, admin e supervisor do setor avisados');
  PERFORM pg_temp.expect(NOT EXISTS (SELECT 1 FROM public.notifications WHERE organization_id = A AND kind = 'improvement' AND user_id IN (agent_a, agent2_a)), 'atendentes nao sao avisados');

  -- 50. Base de conhecimento: por setor; trechos so do backend; busca do cliente nunca traz documento interno.
  INSERT INTO public.knowledge_docs (id, organization_id, department_id, title, visibility, status) VALUES
    ('aaaaaaaa-0000-0000-0050-000000000001', A, NULL, 'Politica interna de desconto', 'interno', 'ready'),
    ('aaaaaaaa-0000-0000-0050-000000000002', A, 'aaaaaaaa-0000-0000-0001-000000000001', 'Tabela de precos D1', 'atendimento', 'ready'),
    ('aaaaaaaa-0000-0000-0050-000000000003', A, 'aaaaaaaa-0000-0000-0001-000000000002', 'Manual D2', 'atendimento', 'ready');
  INSERT INTO public.knowledge_chunks (organization_id, doc_id, ord, content) VALUES
    (A, 'aaaaaaaa-0000-0000-0050-000000000001', 0, 'Desconto maximo para ramal: 15 por cento, so com aprovacao do dono.'),
    (A, 'aaaaaaaa-0000-0000-0050-000000000002', 0, 'Ramal basico custa 49,90 por mes.'),
    (A, 'aaaaaaaa-0000-0000-0050-000000000003', 0, 'Ramal no setor D2: procedimento de ativacao.');
  PERFORM pg_temp.expect(pg_temp.q(owner_a, 'SELECT count(*) FROM public.knowledge_docs') = 3, 'dono ve todos');
  PERFORM pg_temp.expect(pg_temp.q(sup_a, 'SELECT count(*) FROM public.knowledge_docs') = 2, 'supervisor ve empresa toda + seu setor');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT count(*) FROM public.knowledge_docs') = 0, 'atendente nao ve a base');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.knowledge_docs') = 0, 'outra org nao ve');
  PERFORM pg_temp.expect_error(owner_a, 'SELECT count(*) FROM public.knowledge_chunks', 'trechos so do backend');
  PERFORM pg_temp.expect_error(owner_a, format('INSERT INTO public.knowledge_docs (organization_id, title) VALUES (%L, %L)', A, 'x'), 'navegador nao cria documento');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT * FROM public.service_search_knowledge(%L, %L, %L)', A, 'ramal', 'interno'), 'navegador nao busca direto');
  PERFORM pg_temp.expect(pg_temp.t(sup_a, format('SELECT public.can_manage_knowledge(%L, %L)::text', A, 'aaaaaaaa-0000-0000-0001-000000000001')) = 'true', 'supervisor gerencia seu setor');
  PERFORM pg_temp.expect(pg_temp.t(sup_a, format('SELECT public.can_manage_knowledge(%L, %L)::text', A, 'aaaaaaaa-0000-0000-0001-000000000002')) = 'false', 'supervisor nao gerencia outro setor');
  PERFORM pg_temp.expect(pg_temp.t(sup_a, format('SELECT public.can_manage_knowledge(%L, NULL)::text', A)) = 'false', 'empresa toda so dono/admin');
  PERFORM pg_temp.expect(pg_temp.t(agent_a, format('SELECT public.can_manage_knowledge(%L, %L)::text', A, 'aaaaaaaa-0000-0000-0001-000000000001')) = 'false', 'atendente nao gerencia');
  PERFORM pg_temp.expect((SELECT count(*) FROM public.service_search_knowledge(A, 'desconto ramal', 'cliente')) = 2
    AND NOT EXISTS (SELECT 1 FROM public.service_search_knowledge(A, 'desconto ramal', 'cliente') WHERE title LIKE 'Politica interna%'), 'busca do cliente sem documento interno');
  PERFORM pg_temp.expect(EXISTS (SELECT 1 FROM public.service_search_knowledge(A, 'desconto', 'interno') WHERE title LIKE 'Politica interna%'), 'agente interno ve o interno');
  PERFORM pg_temp.expect(NOT EXISTS (SELECT 1 FROM public.service_search_knowledge(A, 'ramal', 'cliente', ARRAY['aaaaaaaa-0000-0000-0001-000000000001']::uuid[]) WHERE title = 'Manual D2'), 'setor filtra outro setor');
  PERFORM pg_temp.expect((SELECT count(*) FROM public.service_search_knowledge('bbbbbbbb-0000-0000-0000-000000000001', 'ramal', 'interno')) = 0, 'outra org nao acha nada');

  -- 51. Relatorios: escopo pelo papel (dono tudo, supervisor setores dele, atendente so os proprios); outra org nunca.
  INSERT INTO public.tickets (id, organization_id, conversation_id, protocol, status, department_id, assigned_to, opened_at, first_response_at, closed_at) VALUES
    ('aaaaaaaa-0000-0000-0051-000000000001', A, 'aaaaaaaa-0000-0000-0004-000000000003', 'ISO-51A', 'closed', 'aaaaaaaa-0000-0000-0001-000000000001', agent_a, now(), now(), now()),
    ('aaaaaaaa-0000-0000-0051-000000000002', A, 'aaaaaaaa-0000-0000-0004-000000000003', 'ISO-51B', 'closed', 'aaaaaaaa-0000-0000-0001-000000000002', agent2_a, now(), now(), now());
  PERFORM pg_temp.expect(pg_temp.t(agent_a, format($q$SELECT string_agg(l ->> 'user_id', ',') FROM jsonb_array_elements(public.report(%L, 'atendentes', now() - interval '1 day', now() + interval '1 minute') -> 'linhas') l$q$, A))
    = agent_a::text, 'atendente ve so a propria linha');
  PERFORM pg_temp.expect_error(agent_a, format($q$SELECT public.report(%L, 'operacao', now() - interval '1 day', now())$q$, A), 'atendente nao ve operacao');
  PERFORM pg_temp.expect(pg_temp.t(sup_a, format($q$SELECT public.report(%L, 'operacao', now() - interval '1 day', now() + interval '1 minute', %L) -> 'por_setor' ->> 0$q$,
    A, 'aaaaaaaa-0000-0000-0001-000000000002')) NOT LIKE '%D2%', 'supervisor nao escolhe setor alheio');
  PERFORM pg_temp.expect(pg_temp.t(sup_a, format($q$SELECT public.report(%L, 'atendentes', now() - interval '1 day', now() + interval '1 minute') ->> 'linhas'$q$, A)) NOT LIKE '%' || agent2_a::text || '%',
    'supervisor nao ve atendente de outro setor');
  PERFORM pg_temp.expect_error(owner_b, format($q$SELECT public.report(%L, 'atendentes', now() - interval '1 day', now())$q$, A), 'outra org nao ve relatorio');
  PERFORM pg_temp.expect_error(outsider, format($q$SELECT public.log_report_export(%L, 'x')$q$, A), 'estranho nao registra exportacao');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format($q$SELECT public.report(%L, k, now() - interval '30 days', now() + interval '1 minute') FROM unnest(ARRAY['atendentes','operacao','qualidade','melhorias','comercial','ia']) k$q$, A)) LIKE 'ok:%',
    'dono roda os seis relatorios');
  PERFORM pg_temp.expect(pg_temp.t(owner_a, format($q$SELECT (public.report(%L, 'atendentes', now() - interval '1 day', now() + interval '1 minute') -> 'linhas')::text$q$, A)) LIKE '%' || agent2_a::text || '%',
    'dono ve todos os atendentes');

  -- 52. Etiquetas e grupos: dono gerencia (cor, icone, juntar, excluir); atendente nao; sensivel nao se mistura; outra org nunca.
  INSERT INTO public.tags (id, organization_id, name) VALUES
    ('aaaaaaaa-0000-0000-0052-000000000001', A, 'Cliente VIP'), ('aaaaaaaa-0000-0000-0052-000000000002', A, 'Cliente Vip ');
  INSERT INTO public.contact_groups (id, organization_id, name, sensitive) VALUES
    ('aaaaaaaa-0000-0000-0052-000000000011', A, 'Inadimplentes', true), ('aaaaaaaa-0000-0000-0052-000000000012', A, 'Clientes ouro', false);
  INSERT INTO public.contact_tags (organization_id, contact_id, tag_id)
  SELECT A, id, 'aaaaaaaa-0000-0000-0052-000000000002' FROM public.contacts WHERE organization_id = A LIMIT 2;
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('UPDATE public.tags SET color = %L, icon = %L WHERE id = %L', '#EF4444', 'crown', 'aaaaaaaa-0000-0000-0052-000000000001')) = 'ok:1', 'dono muda cor e icone');
  PERFORM pg_temp.expect_error(owner_a, format('UPDATE public.tags SET icon = %L WHERE id = %L', '<script>', 'aaaaaaaa-0000-0000-0052-000000000001'), 'icone invalido recusado');
  PERFORM pg_temp.expect_denied(agent_a, format('UPDATE public.tags SET name = %L WHERE id = %L', 'x', 'aaaaaaaa-0000-0000-0052-000000000001'), 'atendente nao renomeia etiqueta');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.merge_tags(%L, %L)', 'aaaaaaaa-0000-0000-0052-000000000002', 'aaaaaaaa-0000-0000-0052-000000000001'), 'atendente nao junta');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.merge_tags(%L, %L)', 'aaaaaaaa-0000-0000-0052-000000000002', 'aaaaaaaa-0000-0000-0052-000000000001'), 'outra org nao junta');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('SELECT public.merge_tags(%L, %L)', 'aaaaaaaa-0000-0000-0052-000000000002', 'aaaaaaaa-0000-0000-0052-000000000001')) LIKE 'ok:%', 'dono junta duplicadas');
  PERFORM pg_temp.expect((SELECT count(*) FROM public.contact_tags WHERE tag_id = 'aaaaaaaa-0000-0000-0052-000000000001') = 2
    AND NOT EXISTS (SELECT 1 FROM public.tags WHERE id = 'aaaaaaaa-0000-0000-0052-000000000002'), 'marcacoes movidas e duplicada apagada');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.merge_groups(%L, %L)', 'aaaaaaaa-0000-0000-0052-000000000011', 'aaaaaaaa-0000-0000-0052-000000000012'), 'sensivel nao junta com comum');
  PERFORM pg_temp.expect(pg_temp.t(owner_a, format('SELECT public.tag_group_counts(%L) -> %L ->> %L', A, 'tags', 'aaaaaaaa-0000-0000-0052-000000000001')) = '2', 'contagem por etiqueta');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, format('SELECT count(*) FROM jsonb_object_keys(public.tag_group_counts(%L) -> %L)', A, 'tags')) = 0, 'outra org nao conta');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('DELETE FROM public.contact_groups WHERE id = %L', 'aaaaaaaa-0000-0000-0052-000000000012')) = 'ok:1', 'dono exclui grupo');
  PERFORM pg_temp.expect(EXISTS (SELECT 1 FROM public.audit_log WHERE organization_id = A AND action = 'group.deleted'), 'exclusao auditada');

  -- 53. Chat interno: geral para todos; setor so do setor (+dono/admin); direto so dos dois; historico imutavel; outra org nunca.
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('SELECT public.ensure_team_channels(%L)', A)) LIKE 'ok:%', 'cria canais');
  PERFORM pg_temp.expect(pg_temp.q(owner_a, 'SELECT count(*) FROM public.team_channels') >= 3, 'dono ve geral e setores');
  PERFORM pg_temp.expect(pg_temp.t(agent_a, 'SELECT string_agg(name, '','' ORDER BY name) FROM public.team_channels') = 'D1,Geral', 'atendente ve geral + seu setor');
  PERFORM pg_temp.expect(pg_temp.t(agent2_a, 'SELECT string_agg(name, '','' ORDER BY name) FROM public.team_channels') = 'D2,Geral', 'outro atendente ve geral + setor dele');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, format('SELECT count(*) FROM public.team_channels WHERE organization_id = %L', A)) = 0, 'outra org nao ve canais');
  PERFORM pg_temp.expect(pg_temp.run(agent_a, format('INSERT INTO public.team_messages (organization_id, channel_id, author_id, content, mentions) VALUES (%L, (SELECT id FROM public.team_channels WHERE name = %L AND organization_id = %L), %L, %L, ARRAY[%L, %L]::uuid[])',
    A, 'D1', A, agent_a, 'Alguem cobre a fila da tarde?', sup_a, agent2_a)) = 'ok:1', 'atendente escreve no seu setor');
  PERFORM pg_temp.expect(EXISTS (SELECT 1 FROM public.notifications WHERE kind = 'team_mention' AND user_id = sup_a), 'mencao avisa quem ve o canal');
  PERFORM pg_temp.expect(NOT EXISTS (SELECT 1 FROM public.notifications WHERE kind = 'team_mention' AND user_id = agent2_a), 'mencao nao avisa quem nao ve o canal');
  PERFORM pg_temp.expect_error(agent_a, format('INSERT INTO public.team_messages (organization_id, channel_id, author_id, content) VALUES (%L, (SELECT id FROM public.team_channels WHERE name = %L AND organization_id = %L), %L, %L)',
    A, 'D2', A, agent_a, 'x'), 'nao escreve em setor alheio');
  PERFORM pg_temp.expect_error(agent_a, format('INSERT INTO public.team_messages (organization_id, channel_id, author_id, content) VALUES (%L, (SELECT id FROM public.team_channels WHERE name = %L AND organization_id = %L), %L, %L)',
    A, 'Geral', A, owner_a, 'x'), 'nao escreve como outra pessoa');
  PERFORM pg_temp.expect_error(agent_a, format('INSERT INTO public.team_messages (organization_id, channel_id, author_id, conversation_id) VALUES (%L, (SELECT id FROM public.team_channels WHERE name = %L AND organization_id = %L), %L, %L)',
    A, 'Geral', A, agent_a, 'bbbbbbbb-0000-0000-0004-000000000001'), 'nao compartilha atendimento de outra org');
  PERFORM pg_temp.expect_error(agent_a, 'UPDATE public.team_messages SET content = ''editado''', 'mensagem nao se edita');
  PERFORM pg_temp.expect_error(owner_a, 'DELETE FROM public.team_messages', 'mensagem nao se apaga');
  PERFORM pg_temp.expect(pg_temp.run(agent_a, format('SELECT public.open_direct_chat(%L, %L)', A, agent2_a)) LIKE 'ok:%', 'abre conversa direta');
  PERFORM pg_temp.expect(pg_temp.q(agent2_a, 'SELECT count(*) FROM public.team_channels WHERE kind = ''direto''') = 1, 'o outro ve a direta');
  PERFORM pg_temp.expect(pg_temp.q(owner_a, 'SELECT count(*) FROM public.team_channels WHERE kind = ''direto''') = 0, 'direta e privada ate para o dono');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.open_direct_chat(%L, %L)', A, owner_b), 'nao abre direta com outra org');
  PERFORM pg_temp.expect(pg_temp.q(sup_a, format('SELECT count(*) FROM public.team_unread(%L)', A)) >= 1, 'nao lidas para quem ve');

  -- 54. Ramal: so a Clubetec cadastra; dono escolhe o atendente; senha so para o dono do ramal em WebRTC;
  --     ligacoes imutaveis, cada um ve as suas; outra org nunca.
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.operator_save_extension(%L, NULL, %L, %L, %L, %L, %L, %L, %L)',
    A, '201', '201', 'pbx.exemplo.com', 'wss://pbx.exemplo.com:8089/ws', 'handphone', 'Recepcao', 'segredo123'), 'dono nao cadastra ramal');
  PERFORM pg_temp.expect(pg_temp.run(operator, format('SELECT public.operator_save_extension(%L, NULL, %L, %L, %L, %L, %L, %L, %L)',
    A, '201', '201', 'pbx.exemplo.com', 'wss://pbx.exemplo.com:8089/ws', 'handphone', 'Recepcao', 'segredo123')) = 'ok:1', 'clubetec cadastra ramal');
  PERFORM pg_temp.expect_error(operator, format('SELECT public.operator_save_extension(%L, NULL, %L, %L, %L, %L, %L, %L, %L)',
    A, '202', '202', 'pbx.exemplo.com', 'https://malicioso.com', 'handphone', '', ''), 'servidor so wss');
  PERFORM pg_temp.expect(pg_temp.q(owner_a, 'SELECT count(*) FROM public.pbx_extensions') = 1, 'dono ve os ramais');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.pbx_extensions') = 0, 'outra org nao ve ramais');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT count(*) FROM public.pbx_extensions') = 0, 'atendente sem ramal nao ve ramais');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.assign_extension((SELECT id FROM public.pbx_extensions WHERE number = %L), %L)', '201', owner_b), 'outra org nao atribui');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.assign_extension((SELECT id FROM public.pbx_extensions WHERE number = %L), %L)', '201', owner_b), 'nao atribui a pessoa de outra org');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('SELECT public.assign_extension((SELECT id FROM public.pbx_extensions WHERE number = %L), %L)', '201', agent_a)) = 'ok:1', 'dono atribui ao atendente');
  PERFORM pg_temp.expect(pg_temp.t(agent_a, format('SELECT public.my_extension(%L)->>%L', A, 'password')) = 'segredo123', 'atendente recebe a senha em webrtc');
  PERFORM pg_temp.expect(pg_temp.t(agent2_a, format('SELECT coalesce(public.my_extension(%L)::text, %L)', A, 'nada')) = 'nada', 'outro atendente nao recebe ramal');
  PERFORM pg_temp.expect(pg_temp.t(owner_b, format('SELECT coalesce(public.my_extension(%L)::text, %L)', A, 'nada')) = 'nada', 'outra org nao recebe ramal');
  PERFORM pg_temp.expect_error(agent2_a, format('SELECT public.set_extension_mode((SELECT id FROM public.pbx_extensions WHERE organization_id = %L AND number = %L), %L)', A, '201', 'off'), 'outro atendente nao muda o modo');
  PERFORM pg_temp.expect(pg_temp.run(agent_a, format('SELECT public.set_extension_mode((SELECT id FROM public.pbx_extensions WHERE number = %L), %L)', '201', 'sip')) = 'ok:1', 'atendente muda para sip');
  PERFORM pg_temp.expect(pg_temp.t(agent_a, format('SELECT coalesce(public.my_extension(%L)->>%L, %L)', A, 'password', 'sem')) = 'sem', 'em sip a senha nao vai ao navegador');
  PERFORM pg_temp.expect_error(agent_a, format('UPDATE public.pbx_extensions SET wss_url = %L', 'wss://outro.com'), 'atendente nao altera ramal direto');
  PERFORM pg_temp.expect(pg_temp.run(agent_a, format('SELECT public.log_call(%L, NULL, %L, %L, %L, %L)', A, 'in', '(11) 90000-0001', 'ringing', 'sip')) = 'ok:1', 'atendente registra ligacao');
  PERFORM pg_temp.expect((SELECT contact_id IS NOT NULL FROM public.calls WHERE phone = '11900000001'), 'ligacao liga ao cliente pelo numero');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT count(*) FROM public.calls') = 1, 'atendente ve a sua ligacao');
  PERFORM pg_temp.expect(pg_temp.q(owner_a, 'SELECT count(*) FROM public.calls') = 1, 'dono ve as ligacoes');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.calls') = 0, 'outra org nao ve ligacoes');
  PERFORM pg_temp.expect_error(agent2_a, format('SELECT public.log_call(%L, (SELECT id FROM public.calls LIMIT 1), %L, %L, %L, %L)', A, 'in', '1', 'ended', 'sip'), 'nao altera ligacao de outro');
  PERFORM pg_temp.expect_error(agent_a, format('INSERT INTO public.calls (organization_id, direction, phone, source) VALUES (%L, %L, %L, %L)', A, 'out', '11999', 'sip'), 'ligacao so pela funcao');
  PERFORM pg_temp.expect_error(owner_a, 'DELETE FROM public.calls', 'ligacao nao se apaga');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, format('SELECT count(*) FROM public.lookup_caller(%L, %L)', A, '11900000001')) = 1, 'identifica cliente visivel');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, format('SELECT count(*) FROM public.lookup_caller(%L, %L)', A, '11900000003')) = 0, 'nao identifica cliente de outro setor');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, format('SELECT count(*) FROM public.lookup_caller(%L, %L)', A, '11900000001')) = 0, 'outra org nao identifica');
  PERFORM pg_temp.expect(pg_temp.run(operator, format('SELECT public.operator_delete_extension((SELECT id FROM public.pbx_extensions WHERE number = %L))', '201')) = 'ok:1', 'clubetec exclui ramal');
  PERFORM pg_temp.expect(NOT EXISTS (SELECT 1 FROM vault.secrets s WHERE s.name LIKE 'ext:%' AND NOT EXISTS (SELECT 1 FROM public.pbx_extensions e WHERE s.name = format('ext:%s:password', e.id))), 'senha sai do cofre');
  PERFORM pg_temp.expect((SELECT count(*) FROM public.calls WHERE organization_id = A) = 1, 'historico fica apos excluir o ramal');

  -- 55. Etiquetas padrao em toda empresa; etiqueta de setor(es): so quem e do setor ve e marca (ou quem ve tudo).
  PERFORM pg_temp.expect((SELECT count(*) FROM public.tags WHERE organization_id = A AND is_default) >= 9, 'empresa tem etiquetas padrao');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.add_default_tags(%L)', A), 'atendente nao recria padrao');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('SELECT public.add_default_tags(%L)', A)) = 'ok:1', 'dono recria padrao');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.add_default_tags(%L)', A), 'outra org nao mexe');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('INSERT INTO public.tags (organization_id, name) VALUES (%L, %L)', A, 'Garantia D2')) = 'ok:1', 'dono cria etiqueta');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('INSERT INTO public.tag_departments (organization_id, tag_id, department_id) SELECT %L, t.id, d.id FROM public.tags t, public.departments d WHERE t.organization_id = %L AND t.name = %L AND d.organization_id = %L AND d.name = %L',
    A, A, 'Garantia D2', A, 'D2')) = 'ok:1', 'dono associa etiqueta ao setor D2');
  PERFORM pg_temp.expect_error(owner_a, format('INSERT INTO public.tag_departments (organization_id, tag_id, department_id) SELECT %L, t.id, %L FROM public.tags t WHERE t.organization_id = %L AND t.name = %L',
    A, 'bbbbbbbb-0000-0000-0001-000000000001', A, 'Garantia D2'), 'etiqueta nao usa setor de outra org');
  PERFORM pg_temp.expect_error(agent_a, format('INSERT INTO public.tag_departments (organization_id, tag_id, department_id) SELECT %L, t.id, d.id FROM public.tags t, public.departments d WHERE t.organization_id = %L AND t.name = %L AND d.organization_id = %L AND d.name = %L',
    A, A, 'VIP', A, 'D1'), 'atendente nao associa setor');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, format('SELECT count(*) FROM public.tags WHERE name = %L', 'Garantia D2')) = 0, 'atendente de D1 nao ve etiqueta de D2');
  PERFORM pg_temp.expect(pg_temp.q(agent2_a, format('SELECT count(*) FROM public.tags WHERE name = %L', 'Garantia D2')) = 1, 'atendente de D2 ve etiqueta de D2');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, format('SELECT count(*) FROM public.tags WHERE name = %L', 'VIP')) = 1, 'atendente ve etiqueta geral');
  PERFORM pg_temp.expect_error(agent_a, format('INSERT INTO public.contact_tags (organization_id, contact_id, tag_id) VALUES (%L, (SELECT contact_id FROM public.conversations WHERE id = %L), (SELECT id FROM public.tags WHERE organization_id = %L AND name = %L))',
    A, 'aaaaaaaa-0000-0000-0004-000000000001', A, 'Garantia D2'), 'atendente de D1 nao usa etiqueta de D2');
  PERFORM pg_temp.expect(pg_temp.run(agent_a, format('INSERT INTO public.contact_tags (organization_id, contact_id, tag_id) VALUES (%L, (SELECT contact_id FROM public.conversations WHERE id = %L), (SELECT id FROM public.tags WHERE organization_id = %L AND name = %L))',
    A, 'aaaaaaaa-0000-0000-0004-000000000001', A, 'VIP')) = 'ok:1', 'atendente usa etiqueta geral');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('INSERT INTO public.contact_tags (organization_id, contact_id, tag_id) VALUES (%L, (SELECT contact_id FROM public.conversations WHERE id = %L), (SELECT id FROM public.tags WHERE organization_id = %L AND name = %L))',
    A, 'aaaaaaaa-0000-0000-0004-000000000001', A, 'Garantia D2')) = 'ok:1', 'dono usa etiqueta de qualquer setor');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, format('SELECT count(*) FROM public.contact_tags ct JOIN public.conversations c ON c.contact_id = ct.contact_id WHERE c.id = %L', 'aaaaaaaa-0000-0000-0004-000000000001')) = 1, 'atendente so ve as etiquetas do seu setor no cliente');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('INSERT INTO public.tag_departments (organization_id, tag_id, department_id) SELECT %L, t.id, d.id FROM public.tags t, public.departments d WHERE t.organization_id = %L AND t.name = %L AND d.organization_id = %L AND d.name = %L',
    A, A, 'Garantia D2', A, 'D1')) = 'ok:1', 'etiqueta em mais de um setor');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, format('SELECT count(*) FROM public.tags WHERE name = %L', 'Garantia D2')) = 1, 'agora D1 tambem ve');

  -- 56. Status do ramal: so o atendente do ramal informa; outra org nunca.
  PERFORM pg_temp.run(operator, format('SELECT public.operator_save_extension(%L, NULL, %L, %L, %L, %L, %L, %L, %L)',
    A, '301', '301', 'pbx.exemplo.com', 'wss://pbx.exemplo.com/ws', 'nvoip', '', 'x1'));
  PERFORM pg_temp.run(owner_a, format('SELECT public.assign_extension((SELECT id FROM public.pbx_extensions WHERE number = %L), %L)', '301', agent_a));
  PERFORM pg_temp.expect(pg_temp.run(agent_a, format('SELECT public.report_extension_status((SELECT id FROM public.pbx_extensions WHERE number = %L), %L)', '301', 'online')) = 'ok:1', 'atendente informa online');
  PERFORM pg_temp.expect((SELECT reg_state FROM public.pbx_extensions WHERE number = '301') = 'online', 'status gravado');
  PERFORM pg_temp.expect_error(agent2_a, format('SELECT public.report_extension_status(%L, %L)', (SELECT id FROM public.pbx_extensions WHERE number = '301'), 'offline'), 'outro atendente nao informa');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.report_extension_status(%L, %L)', (SELECT id FROM public.pbx_extensions WHERE number = '301'), 'offline'), 'outra org nao informa');
  PERFORM pg_temp.expect(pg_temp.t(operator, format('SELECT reg_state FROM public.pbx_extensions WHERE number = %L', '301')) = 'online', 'clubetec ve o status');

  PERFORM pg_temp.expect(pg_temp.q(operator, format('SELECT count(*) FROM public.operator_org_members(%L)', A)) >= 5, 'clubetec ve a equipe para instalar ramais');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT * FROM public.operator_org_members(%L)', A), 'dono nao usa a lista da clubetec');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT * FROM public.operator_org_members(%L)', A), 'outra org nao lista a equipe');

  RAISE NOTICE 'ISOLATION OK';
END $$;

ROLLBACK;
