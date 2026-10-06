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

  -- 57. Nvoip: credencial so dono/admin, so no cofre; atendente nao ve; ligacao da central so pelo servidor.
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.set_voice_integration(%L, %L, %L)', A, 'cid', 'csecret'), 'atendente nao configura nvoip');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.set_voice_integration(%L, %L, %L)', A, 'cid', 'csecret'), 'outra org nao configura');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('SELECT public.set_voice_integration(%L, %L, %L)', A, 'cid', 'csecret')) = 'ok:1', 'dono configura nvoip');
  PERFORM pg_temp.expect((SELECT has_credentials FROM public.voice_integrations WHERE organization_id = A), 'credencial marcada');
  PERFORM pg_temp.expect(pg_temp.q(owner_a, 'SELECT count(*) FROM public.voice_integrations') = 1, 'dono ve a integracao');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT count(*) FROM public.voice_integrations') = 0, 'atendente nao ve a integracao');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.voice_integrations') = 0, 'outra org nao ve a integracao');
  PERFORM pg_temp.expect(pg_temp.t(agent_a, format('SELECT public.my_extension(%L)->>%L', A, 'click_to_call')) = 'true', 'ramal nvoip liga pela api');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.service_upsert_call(%L, %L, %L, %L, %L, %L, now(), NULL, NULL, 0, NULL)', A, 'x1', 'in', '11900000001', '301', 'missed'), 'navegador nao grava ligacao da central');
  PERFORM pg_temp.expect(public.service_upsert_call(A, 'nv-1', 'in', '5511900000001', '301', 'missed', now(), NULL, NULL, 0, NULL) IS NOT NULL, 'servidor grava ligacao');
  PERFORM pg_temp.expect(EXISTS (SELECT 1 FROM public.notifications WHERE kind = 'missed_call' AND user_id = agent_a), 'perdida avisa o atendente do ramal');
  PERFORM pg_temp.expect(public.service_upsert_call(A, 'nv-1', 'in', '5511900000001', '301', 'missed', now(), NULL, NULL, 0, NULL) IS NOT NULL
    AND (SELECT count(*) FROM public.notifications WHERE kind = 'missed_call' AND user_id = agent_a) = 1, 'aviso nao repete');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.calls WHERE provider_call_id IS NOT NULL') = 0, 'outra org nao ve ligacoes da central');

  -- 58. Marca: so dono/admin (ou campanhas) le e envia; atendente e outra org nunca.
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('UPDATE public.company_profiles SET brand = %L::jsonb WHERE organization_id = %L',
    '{"colors":[{"name":"Azul","hex":"#1E40AF"}]}', A)) = 'ok:1', 'dono salva as cores da marca');
  PERFORM pg_temp.expect(pg_temp.t(owner_a, format('SELECT public.brand_kit(%L)->%L->%L->0->>%L', A, 'brand', 'colors', 'hex')) = '#1E40AF', 'dono le a marca');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.brand_kit(%L)', A), 'atendente nao le a marca');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.brand_kit(%L)', A), 'outra org nao le a marca');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L)', 'brand', A::text || '/logo.png')) = 'ok:1', 'dono envia logo');
  PERFORM pg_temp.expect_error(agent_a, format('INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L)', 'brand', A::text || '/x.png'), 'atendente nao envia logo');
  PERFORM pg_temp.expect_error(owner_b, format('INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L)', 'brand', A::text || '/y.png'), 'outra org nao envia logo');
  PERFORM pg_temp.expect_error(owner_a, format('INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L)', 'brand', A::text || '/../z.png'), 'caminho fora do padrao recusado');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, format('SELECT count(*) FROM storage.objects WHERE bucket_id = %L', 'brand')) = 0, 'atendente nao ve os arquivos da marca');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, format('SELECT count(*) FROM storage.objects WHERE bucket_id = %L', 'brand')) = 0, 'outra org nao ve os arquivos da marca');

  -- 59. Lembrete de processo "depois": avisa dono/admin da empresa na data, uma vez; atendente e outra org nao.
  UPDATE public.company_profiles SET processes = jsonb_build_array(
    jsonb_build_object('nome', 'Orcamento', 'setor', 'Vendas', 'implementar', 'depois', 'lembrar_em', to_char(current_date - 1, 'YYYY-MM-DD')),
    jsonb_build_object('nome', 'Cobranca', 'setor', 'Financeiro', 'implementar', 'agora'),
    jsonb_build_object('nome', 'Futuro', 'setor', 'RH', 'implementar', 'depois', 'lembrar_em', to_char(current_date + 30, 'YYYY-MM-DD')))
  WHERE organization_id = A;
  PERFORM private.process_reminders_tick();
  PERFORM pg_temp.expect((SELECT count(*) FROM public.notifications WHERE kind = 'process_reminder' AND organization_id = A AND user_id IN (owner_a, admin_a)) = 2, 'lembrete para dono e admin');
  PERFORM pg_temp.expect(NOT EXISTS (SELECT 1 FROM public.notifications WHERE kind = 'process_reminder' AND user_id IN (agent_a, sup_a, owner_b)), 'atendente, supervisor e outra org nao recebem');
  PERFORM private.process_reminders_tick();
  PERFORM pg_temp.expect((SELECT count(*) FROM public.notifications WHERE kind = 'process_reminder' AND organization_id = A) = 2, 'lembrete nao repete');
  PERFORM pg_temp.expect((SELECT processes->0->>'lembrado_em' FROM public.company_profiles WHERE organization_id = A) IS NOT NULL, 'marca que ja lembrou');

  -- 60. Cor da marca no tema: so se o dono ligar; qualquer membro le so a cor; outra org nada.
  PERFORM pg_temp.expect(pg_temp.t(agent_a, format('SELECT coalesce(public.org_theme(%L)::text, %L)', A, 'nada')) = 'nada', 'sem ligar, sem cor');
  UPDATE public.company_profiles SET brand = brand || '{"use_in_theme": true}'::jsonb WHERE organization_id = A;
  PERFORM pg_temp.expect(pg_temp.t(agent_a, format('SELECT public.org_theme(%L)->>%L', A, 'primary')) = '#1E40AF', 'atendente recebe so a cor');
  PERFORM pg_temp.expect(pg_temp.t(owner_b, format('SELECT coalesce(public.org_theme(%L)::text, %L)', A, 'nada')) = 'nada', 'outra org nao recebe a cor');

  -- 61. Modulos por empresa: so a Clubetec liga/desliga; a trava vale no banco; outra org nao ve nem mexe.
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT count(*) FROM public.org_modules') = 7, 'membro ve os modulos da empresa');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, format('SELECT count(*) FROM public.org_modules WHERE organization_id = %L', A)) = 0, 'outra org nao ve os modulos');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.platform_set_module(%L, %L, false)', A, 'campanhas'), 'dono nao liga/desliga modulo');
  PERFORM pg_temp.expect_error(owner_a, format('UPDATE public.org_modules SET enabled = true WHERE organization_id = %L', A), 'dono nao altera modulo direto');
  PERFORM pg_temp.expect(pg_temp.run(operator, format('SELECT public.platform_set_module(%L, %L, false)', A, 'campanhas')) = 'ok:1', 'clubetec desliga campanhas');
  PERFORM pg_temp.expect_error(owner_a, format('INSERT INTO public.campaigns (organization_id, name, instance_id, message) VALUES (%L, %L, %L, %L)',
    A, 'Promo sem modulo', 'aaaaaaaa-0000-0000-0003-000000000001', 'oi'), 'sem modulo nao cria campanha');
  PERFORM pg_temp.expect(pg_temp.run(operator, format('SELECT public.platform_set_module(%L, %L, false)', A, 'telefonia')) = 'ok:1', 'clubetec desliga telefonia');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.log_call(%L, NULL, %L, %L, %L, %L)', A, 'out', '11999990000', 'ringing', 'sip'), 'sem modulo nao registra ligacao');
  PERFORM pg_temp.expect(pg_temp.run(operator, format('SELECT public.platform_set_module(%L, %L, false)', A, 'canais')) = 'ok:1', 'clubetec desliga canais');
  PERFORM pg_temp.expect_error(owner_a, format('INSERT INTO public.whatsapp_instances (organization_id, name, provider) VALUES (%L, %L, %L)', A, 'Segundo', 'uazapi'), 'sem canais nao cria 2o numero');
  PERFORM pg_temp.expect(pg_temp.run(operator, format('SELECT public.platform_set_module(%L, %L, false)', A, 'gestao')) = 'ok:1', 'clubetec desliga gestao');
  PERFORM pg_temp.expect(pg_temp.run(NULL, format('INSERT INTO public.ticket_reviews (organization_id, ticket_id) SELECT %L, t.id FROM public.tickets t WHERE t.organization_id = %L AND NOT EXISTS (SELECT 1 FROM public.ticket_reviews r WHERE r.ticket_id = t.id) LIMIT 1', A, A)) = 'ok:0', 'sem gestao nao gera avaliacao');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.org_modules WHERE NOT enabled') = 0, 'desligar em uma org nao afeta a outra');
  PERFORM pg_temp.run(operator, format('SELECT public.platform_set_module(%L, %L, true)', A, 'campanhas'));
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('INSERT INTO public.campaigns (organization_id, name, instance_id, message) VALUES (%L, %L, %L, %L)',
    A, 'Promo com modulo', 'aaaaaaaa-0000-0000-0003-000000000001', 'oi')) = 'ok:1', 'religado, cria campanha');
  PERFORM pg_temp.run(operator, format('SELECT public.platform_set_module(%L, %L, true)', A, 'telefonia'));
  PERFORM pg_temp.run(operator, format('SELECT public.platform_set_module(%L, %L, true)', A, 'canais'));
  PERFORM pg_temp.run(operator, format('SELECT public.platform_set_module(%L, %L, true)', A, 'gestao'));

  -- 62. "Nao e atendimento" (e-mail): quem ve a conversa ignora o remetente e fecha; outra org nunca.
  INSERT INTO public.tickets (organization_id, conversation_id, protocol, status, queued_at)
  VALUES (A, 'aaaaaaaa-0000-0000-0010-000000000032', '2099-000062', 'queued', now()) ON CONFLICT DO NOTHING;
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.ignore_email_sender(%L)', 'aaaaaaaa-0000-0000-0010-000000000032'), 'outra org nao ignora');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.unignore_email(%L, %L)', A, 'cliente@b.test'), 'outra org nao desfaz');
  PERFORM pg_temp.expect(pg_temp.t(owner_a, format('SELECT public.ignore_email_sender(%L, true)', 'aaaaaaaa-0000-0000-0010-000000000032')) = '@b.test', 'dono ignora o dominio');
  PERFORM pg_temp.expect(NOT EXISTS (SELECT 1 FROM public.tickets WHERE conversation_id = 'aaaaaaaa-0000-0000-0010-000000000032' AND status <> 'closed'), 'atendimento fechado');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT count(*) FROM public.email_ignore') = 1, 'equipe ve a lista');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.email_ignore') = 0, 'outra org nao ve a lista');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.unignore_email(%L, %L)', A, '@b.test'), 'atendente nao desfaz');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('SELECT public.unignore_email(%L, %L)', A, '@b.test')) = 'ok:1', 'dono desfaz');
  PERFORM pg_temp.expect_error(owner_a, format('INSERT INTO public.email_ignore (organization_id, pattern) VALUES (%L, %L)', A, 'x@y.com'), 'lista so pela funcao');

  -- 63. Empresa nova da Clubetec: o dono convidado aceita o proprio convite; ninguem aceita por ele nem muda o papel.
  PERFORM set_config('request.jwt.claims', '', true); -- cria como sistema (Clubetec), sem usuario logado
  INSERT INTO public.organizations (id, name, slug, status, template_key, settings) VALUES ('cccccccc-0000-0000-0000-000000000063', 'Empresa nova 63', 'iso-org-63', 'active', 'generico', '{}');
  INSERT INTO public.organization_members (organization_id, user_id, role, status) VALUES ('cccccccc-0000-0000-0000-000000000063', outsider, 'owner', 'invited');
  PERFORM pg_temp.expect(pg_temp.q(outsider, 'SELECT count(*) FROM public.my_invitations()') = 1, 'dono convidado ve o convite');
  PERFORM pg_temp.expect(pg_temp.t(owner_b, format('SELECT public.accept_invitation(%L)::text', 'cccccccc-0000-0000-0000-000000000063')) = 'false', 'outra pessoa nao aceita por ele');
  PERFORM pg_temp.expect_denied(outsider, format('UPDATE public.organization_members SET status = %L, role = %L WHERE organization_id = %L', 'active', 'admin', 'cccccccc-0000-0000-0000-000000000063'), 'convidado nao muda o proprio papel');
  PERFORM pg_temp.expect(pg_temp.t(outsider, format('SELECT public.accept_invitation(%L)::text', 'cccccccc-0000-0000-0000-000000000063')) = 'true', 'dono convidado aceita');
  PERFORM pg_temp.expect((SELECT status FROM public.organization_members WHERE organization_id = 'cccccccc-0000-0000-0000-000000000063' AND user_id = outsider) = 'active', 'dono ativo');

  -- 64. IA da Clubetec: so o operador grava a chave e ve se existe; a empresa so sabe se esta disponivel para ela.
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.set_platform_secret(%L, %L)', 'groq_api_key', 'gsk_x'), 'dono nao grava chave da plataforma');
  PERFORM pg_temp.expect_error(owner_a, 'SELECT public.platform_secret_status()', 'dono nao ve segredos da plataforma');
  PERFORM pg_temp.expect(pg_temp.run(operator, format('SELECT public.set_platform_secret(%L, %L)', 'groq_api_key', 'gsk_teste')) = 'ok:1', 'clubetec grava a chave');
  PERFORM pg_temp.expect(pg_temp.t(operator, 'SELECT public.platform_secret_status()->>''groq_api_key''') = 'true', 'clubetec ve que existe');
  PERFORM pg_temp.expect(pg_temp.t(agent_a, format('SELECT public.platform_ai_available(%L)::text', A)) = 'true', 'membro sabe que a IA esta disponivel');
  PERFORM pg_temp.expect(pg_temp.t(owner_b, format('SELECT public.platform_ai_available(%L)::text', A)) = 'false', 'outra org nao consulta a empresa A');
  UPDATE public.organizations SET settings = settings || '{"ai_platform": false}'::jsonb WHERE id = A;
  PERFORM pg_temp.expect(pg_temp.t(agent_a, format('SELECT public.platform_ai_available(%L)::text', A)) = 'false', 'empresa que recusou nao usa');

  -- 65. Diagnostico 3.0: o dono avanca por todas as etapas novas (clientes, marca, regras); valor fora da lista e recusado.
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('UPDATE public.company_profiles SET stage = %L WHERE organization_id = %L', 'clientes', A)) = 'ok:1', 'etapa clientes');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('UPDATE public.company_profiles SET stage = %L WHERE organization_id = %L', 'marca', A)) = 'ok:1', 'etapa marca');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('UPDATE public.company_profiles SET stage = %L WHERE organization_id = %L', 'regras', A)) = 'ok:1', 'etapa regras');
  PERFORM pg_temp.expect_error(owner_a, format('UPDATE public.company_profiles SET stage = %L WHERE organization_id = %L', 'qualquer', A), 'etapa invalida recusada');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('UPDATE public.company_profiles SET sections = sections || %L WHERE organization_id = %L',
    '{"clientes":"c","regras_ia":"r","marca_visual":"v","marca_voz":"z"}', A)) = 'ok:1', 'secoes novas aceitas');
  PERFORM pg_temp.expect_error(owner_a, format('UPDATE public.company_profiles SET sections = sections || %L WHERE organization_id = %L', '{"senha":"x"}', A), 'secao desconhecida recusada');

  -- 66. IA da plataforma (principal + reservas) e consumo: só o operador configura e vê; empresa nenhuma vê consumo; servidor soma.
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.platform_ai_set(%L, %L, %L, %L)', 'principal', 'openai', '', 'sk-teste-123456789012345'), 'dono nao configura IA da plataforma');
  PERFORM pg_temp.expect_error(owner_a, 'SELECT public.platform_ai_status()', 'dono nao ve as posicoes');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT * FROM public.platform_ai_usage(%L)', current_date - 30), 'dono nao ve consumo de todos');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.service_ai_usage_add(%L, %L, %L, 1, 10, 10, 0)', A, 'openai', 'plataforma'), 'navegador nao soma consumo');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.service_ai_slot_error(%L, %L)', 'principal', 'x'), 'navegador nao marca falha');
  PERFORM pg_temp.expect_error(operator, format('SELECT public.platform_ai_set(%L, %L, %L, %L)', 'principal', 'inventado', '', 'k'), 'fornecedor invalido recusado');
  PERFORM pg_temp.expect_error(operator, format('SELECT public.platform_ai_set(%L, %L, %L, %L)', 'reserva2', 'gemini', 'x y;drop', 'chave-teste-1234567890'), 'modelo invalido recusado');
  PERFORM pg_temp.expect(pg_temp.run(operator, format('SELECT public.platform_ai_set(%L, %L, %L, %L)', 'reserva1', 'openai', 'gpt-4o-mini', 'sk-teste-123456789012345')) = 'ok:1', 'operador configura reserva');
  PERFORM pg_temp.expect(pg_temp.t(operator, 'SELECT (SELECT e->>''has_key'' FROM jsonb_array_elements(public.platform_ai_status()) e WHERE e->>''slot'' = ''reserva1'')') = 'true', 'operador ve que tem chave');
  PERFORM pg_temp.expect(pg_temp.t(operator, 'SELECT public.platform_ai_status()::text') NOT LIKE '%sk-teste%', 'chave nunca volta');
  PERFORM public.service_ai_usage_add(A, 'openai', 'plataforma', 1, 100, 50, 0);
  PERFORM public.service_ai_usage_add(A, 'openai', 'plataforma', 1, 10, 5, 0);
  PERFORM pg_temp.expect(pg_temp.q(operator, format('SELECT sum(tokens_in) FROM public.platform_ai_usage(%L) WHERE organization_id = %L', current_date - 1, A)) = 110, 'consumo somado por empresa');
  PERFORM pg_temp.expect_error(owner_a, 'SELECT count(*) FROM public.ai_usage_daily', 'tabela de consumo fechada para o navegador');
  PERFORM pg_temp.expect_error(owner_a, 'SELECT count(*) FROM public.platform_ai_slots', 'tabela de posicoes fechada para o navegador');
  PERFORM pg_temp.expect(pg_temp.run(operator, format('SELECT public.platform_ai_clear(%L)', 'reserva1')) = 'ok:1', 'operador esvazia reserva');
  PERFORM pg_temp.expect_error(operator, format('SELECT public.platform_ai_clear(%L)', 'principal'), 'principal nao some');

  -- 67. Atendente preferencial: o cliente volta para quem o atendeu, se estiver online; senao, fila normal.
  INSERT INTO public.conversations (id, instance_id, contact_phone, department_id) VALUES
    ('aaaaaaaa-0000-0000-0067-000000000001', 'aaaaaaaa-0000-0000-0003-000000000001', '5511900000067', 'aaaaaaaa-0000-0000-0001-000000000001');
  INSERT INTO public.tickets (id, organization_id, conversation_id, protocol, status, department_id, assigned_to, opened_at, closed_at) VALUES
    ('aaaaaaaa-0000-0000-0067-000000000002', A, 'aaaaaaaa-0000-0000-0067-000000000001', 'ISO-67A', 'closed',
     'aaaaaaaa-0000-0000-0001-000000000001', agent_a, now() - interval '2 hours', now() - interval '1 hour');
  PERFORM pg_temp.expect_denied(agent2_a, format('UPDATE public.departments SET preferred_agent = true WHERE id = %L', 'aaaaaaaa-0000-0000-0001-000000000001'), 'atendente nao liga preferencial');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('UPDATE public.departments SET preferred_agent = true, distribution_mode = %L WHERE id = %L', 'manual', 'aaaaaaaa-0000-0000-0001-000000000001')) = 'ok:1', 'dono liga preferencial');
  PERFORM pg_temp.expect_error(owner_a, format('UPDATE public.departments SET preferred_days = 0 WHERE id = %L', 'aaaaaaaa-0000-0000-0001-000000000001'), 'prazo invalido recusado');
  INSERT INTO public.agent_presence (organization_id, user_id, status, last_seen_at, max_concurrent) VALUES (A, agent_a, 'online', now(), 100)
    ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'online', last_seen_at = now(), max_concurrent = 100;
  INSERT INTO public.tickets (id, organization_id, conversation_id, protocol, status, department_id, queued_at) VALUES
    ('aaaaaaaa-0000-0000-0067-000000000003', A, 'aaaaaaaa-0000-0000-0067-000000000001', 'ISO-67B', 'queued', 'aaaaaaaa-0000-0000-0001-000000000001', now());
  PERFORM pg_temp.expect((SELECT assigned_to = agent_a FROM public.tickets WHERE id = 'aaaaaaaa-0000-0000-0067-000000000003'), 'cliente volta para quem atendeu (mesmo na fila manual)');
  PERFORM pg_temp.expect(EXISTS (SELECT 1 FROM public.ticket_events WHERE ticket_id = 'aaaaaaaa-0000-0000-0067-000000000003' AND type = 'assigned' AND (meta->>'preferred')::boolean), 'registrado como preferencial');
  UPDATE public.tickets SET status = 'closed', closed_at = now() WHERE id = 'aaaaaaaa-0000-0000-0067-000000000003';
  UPDATE public.agent_presence SET status = 'offline' WHERE organization_id = A AND user_id = agent_a;
  INSERT INTO public.tickets (id, organization_id, conversation_id, protocol, status, department_id, queued_at) VALUES
    ('aaaaaaaa-0000-0000-0067-000000000004', A, 'aaaaaaaa-0000-0000-0067-000000000001', 'ISO-67C', 'queued', 'aaaaaaaa-0000-0000-0001-000000000001', now());
  PERFORM pg_temp.expect((SELECT assigned_to IS NULL AND status = 'queued' FROM public.tickets WHERE id = 'aaaaaaaa-0000-0000-0067-000000000004'), 'preferido offline: fica na fila');

  -- 68. Saude da empresa (so dono/admin da propria) e e-mail de seguranca da plataforma (so operador).
  PERFORM pg_temp.expect(pg_temp.q(owner_a, format('SELECT jsonb_array_length(public.org_health(%L))', A)) = 6, 'dono ve a saude da empresa');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.org_health(%L)', A), 'atendente nao ve saude');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.org_health(%L)', A), 'outra org nao ve saude de A');
  PERFORM pg_temp.expect_error(owner_a, 'SELECT public.platform_security_email()', 'dono nao le e-mail de seguranca');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.platform_set_security_email(%L)', 'x@y.com'), 'dono nao grava e-mail de seguranca');
  PERFORM pg_temp.expect_error(operator, format('SELECT public.platform_set_security_email(%L)', 'nao-e-email'), 'e-mail invalido recusado');
  PERFORM pg_temp.expect(pg_temp.run(operator, format('SELECT public.platform_set_security_email(%L)', 'seg@clubetec.test')) = 'ok:1', 'operador grava');
  PERFORM pg_temp.expect(pg_temp.t(operator, 'SELECT public.platform_security_email()') = 'seg@clubetec.test', 'operador le');
  PERFORM pg_temp.expect_error(owner_a, 'SELECT public.service_platform_alert_recipients()', 'navegador nao lista destinatarios');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.service_ai_failover_alert(%L)', 'principal'), 'navegador nao dispara aviso');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.service_ai_slot_ok(%L)', 'principal'), 'navegador nao marca ok');

  -- 69. Funil de vendas: relatorio so de quem ve relatorios da propria org; instalacao so pelo servidor;
  --     bloco "Mover no funil" so aceita etapa da propria empresa.
  PERFORM pg_temp.expect(pg_temp.t(owner_a, format('SELECT (public.sales_funnel_report(%L, current_date - 30)) ? %L', A, 'stages')) = 'true', 'dono ve relatorio do funil');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.sales_funnel_report(%L, current_date)', A), 'atendente nao ve relatorio do funil');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.sales_funnel_report(%L, current_date)', A), 'outra org nao ve funil de A');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.service_install_sales_funnel(%L)', A), 'navegador nao instala funil');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT private.install_sales_funnel(%L)', A), 'navegador nao chama a funcao privada');
  PERFORM public.service_install_sales_funnel(A);
  PERFORM pg_temp.expect((SELECT count(*) FROM public.pipeline_stages WHERE organization_id = A AND name IN ('Qualificado', 'Cliente', 'Perdido')) = 3, 'funil cria etapas');
  PERFORM pg_temp.expect((SELECT count(*) FROM public.tags WHERE organization_id = A AND name LIKE 'Lead %') = 3, 'funil cria etiquetas');
  PERFORM public.service_install_sales_funnel(A);
  PERFORM pg_temp.expect((SELECT count(*) FROM public.pipeline_stages WHERE organization_id = A AND name = 'Qualificado') = 1, 'instalar de novo nao duplica');
  PERFORM pg_temp.expect((SELECT string_agg(name, '|' ORDER BY position) FROM public.pipeline_stages WHERE organization_id = A)
    = 'Novo lead|Qualificado|Diagnóstico ou demonstração|Proposta enviada|Teste grátis|Cliente|Perdido|Novo', 'funil na ordem, etapa antiga no fim');
  PERFORM pg_temp.expect((SELECT count(*) FROM public.pipeline_stages WHERE organization_id = 'bbbbbbbb-0000-0000-0000-000000000001' AND name = 'Qualificado') = 0, 'funil de A nao mexe em B');
  INSERT INTO public.flows (id, organization_id, name) VALUES ('aaaaaaaa-0000-0000-0069-000000000001', A, 'funil-a');
  INSERT INTO public.flow_versions (organization_id, flow_id, status, graph) VALUES (A, 'aaaaaaaa-0000-0000-0069-000000000001', 'draft',
    jsonb_build_object('nodes', jsonb_build_array(jsonb_build_object('id', 's', 'type', 'start', 'data', '{}'::jsonb),
      jsonb_build_object('id', 'st', 'type', 'stage', 'data', jsonb_build_object('stage_id', (SELECT id FROM public.pipeline_stages WHERE organization_id = 'bbbbbbbb-0000-0000-0000-000000000001' LIMIT 1)))),
      'edges', jsonb_build_array(jsonb_build_object('id', 'e', 'source', 's', 'target', 'st'))));
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.publish_flow(%L)', 'aaaaaaaa-0000-0000-0069-000000000001'), 'etapa de outra org recusada no fluxo');
  UPDATE public.flow_versions SET graph = jsonb_set(graph, '{nodes,1,data,stage_id}',
    to_jsonb((SELECT id FROM public.pipeline_stages WHERE organization_id = A AND name = 'Qualificado')::text))
  WHERE flow_id = 'aaaaaaaa-0000-0000-0069-000000000001' AND status = 'draft';
  PERFORM pg_temp.expect(pg_temp.t(owner_a, format('SELECT public.publish_flow(%L)', 'aaaaaaaa-0000-0000-0069-000000000001')) = '1', 'etapa propria publicada');

  -- 70. Referencias so dentro da mesma organizacao (mesmo para quem participa de varias).
  PERFORM pg_temp.expect_error(NULL, format('UPDATE public.conversations SET stage_id = (SELECT id FROM public.pipeline_stages WHERE organization_id = %L LIMIT 1) WHERE id = %L',
    'bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0004-000000000001'), 'conversa de A nao vai para etapa de B');
  PERFORM pg_temp.expect_error(NULL, format('UPDATE public.conversations SET instance_id = %L WHERE id = %L',
    'bbbbbbbb-0000-0000-0003-000000000001', 'aaaaaaaa-0000-0000-0004-000000000001'), 'conversa de A nao usa numero de B');
  PERFORM pg_temp.expect_error(NULL, format('INSERT INTO public.messages (organization_id, user_id, conversation_id, direction, sender, content) VALUES (%L, %L, %L, %L, %L, %L)',
    'bbbbbbbb-0000-0000-0000-000000000001', owner_b, 'aaaaaaaa-0000-0000-0004-000000000001', 'inbound', 'contact', 'x'), 'mensagem de B nao entra em conversa de A');
  PERFORM pg_temp.expect(pg_temp.run(NULL, format('INSERT INTO public.messages (organization_id, user_id, conversation_id, direction, sender, content) VALUES (%L, %L, %L, %L, %L, %L)',
    A, owner_a, 'aaaaaaaa-0000-0000-0004-000000000001', 'inbound', 'contact', 'x')) = 'ok:1', 'mensagem da propria org aceita');

  -- 71. Aparencia: todo membro ve o logo das telas da propria empresa (so ele); outra org nada.
  INSERT INTO storage.objects (bucket_id, name) VALUES ('brand', A::text || '/logo-telas-1.png'), ('brand', A::text || '/manual.pdf');
  UPDATE public.company_profiles SET brand = jsonb_build_object('use_in_theme', true,
    'theme', jsonb_build_object('primary', '#112233', 'secondary', '#445566', 'logo', A::text || '/logo-telas-1.png'))
  WHERE organization_id = A;
  PERFORM pg_temp.expect(pg_temp.t(agent_a, format('SELECT public.org_theme(%L) ->> %L', A, 'secondary')) = '#445566', 'membro recebe as cores');
  PERFORM pg_temp.expect(pg_temp.t(owner_b, format('SELECT coalesce(public.org_theme(%L)::text, %L)', A, 'nada')) = 'nada', 'outra org nao recebe tema de A');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, format('SELECT count(*) FROM storage.objects WHERE name = %L', A::text || '/logo-telas-1.png')) = 1, 'atendente ve o logo das telas');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, format('SELECT count(*) FROM storage.objects WHERE name = %L', A::text || '/manual.pdf')) = 0, 'atendente nao ve o resto da marca');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, format('SELECT count(*) FROM storage.objects WHERE name = %L', A::text || '/logo-telas-1.png')) = 0, 'outra org nao ve o logo de A');
  UPDATE public.company_profiles SET brand = jsonb_set(brand, '{theme,logo}', to_jsonb('bbbbbbbb-0000-0000-0000-000000000001/x.png'::text)) WHERE organization_id = A;
  PERFORM pg_temp.expect(pg_temp.t(agent_a, format('SELECT coalesce(public.org_theme(%L) ->> %L, %L)', A, 'logo', 'sem')) = 'sem', 'logo fora da pasta da empresa ignorado');

  -- 72. Retorno automatico por etapa do funil: agenda ao entrar, cancela ao sair, recomeca quando o cliente responde.
  PERFORM pg_temp.expect((SELECT followup_days = '{2,5,10}' FROM public.pipeline_stages WHERE organization_id = A AND name = 'Proposta enviada'), 'funil pronto ja vem com 2, 5 e 10 dias');
  PERFORM pg_temp.expect_error(owner_a, format('UPDATE public.pipeline_stages SET followup_days = %L WHERE organization_id = %L AND name = %L', '{61}', A, 'Proposta enviada'), 'mais de 60 dias recusado');
  PERFORM pg_temp.expect(pg_temp.run(agent_a, format('UPDATE public.pipeline_stages SET followup_days = %L WHERE organization_id = %L', '{1}', A)) = 'ok:0', 'atendente nao muda retornos');
  PERFORM pg_temp.expect(pg_temp.run(owner_b, format('UPDATE public.pipeline_stages SET followup_days = %L WHERE organization_id = %L', '{1}', A)) = 'ok:0', 'outra org nao muda retornos de A');
  UPDATE public.conversations SET stage_id = (SELECT id FROM public.pipeline_stages WHERE organization_id = A AND name = 'Proposta enviada')
  WHERE id = 'aaaaaaaa-0000-0000-0004-000000000001';
  PERFORM pg_temp.expect((SELECT count(*) FROM public.followups WHERE conversation_id = 'aaaaaaaa-0000-0000-0004-000000000001' AND kind = 'auto_stage' AND status = 'pending') = 3, 'entrar na etapa agenda 3 retornos');
  PERFORM pg_temp.expect((SELECT bool_and(organization_id = A) FROM public.followups WHERE conversation_id = 'aaaaaaaa-0000-0000-0004-000000000001' AND kind = 'auto_stage'), 'retornos na mesma empresa');
  INSERT INTO public.messages (organization_id, user_id, conversation_id, direction, sender, content)
  VALUES (A, owner_a, 'aaaaaaaa-0000-0000-0004-000000000001', 'inbound', 'contact', 'oi');
  PERFORM pg_temp.expect((SELECT count(*) FROM public.followups WHERE conversation_id = 'aaaaaaaa-0000-0000-0004-000000000001' AND kind = 'auto_stage' AND status = 'pending') = 3, 'cliente respondeu: recomeca a contagem');
  UPDATE public.conversations SET stage_id = (SELECT id FROM public.pipeline_stages WHERE organization_id = A AND name = 'Qualificado')
  WHERE id = 'aaaaaaaa-0000-0000-0004-000000000001';
  PERFORM pg_temp.expect((SELECT count(*) FROM public.followups WHERE conversation_id = 'aaaaaaaa-0000-0000-0004-000000000001' AND kind = 'auto_stage' AND status = 'pending') = 0, 'saiu da etapa: retornos cancelados');

  -- 73. Cerebro: areas so o dono cria; responsavel tem que ser da equipe da mesma empresa; exige o modulo.
  INSERT INTO public.org_modules (organization_id, module, enabled) VALUES (A, 'gestao', false)
    ON CONFLICT (organization_id, module) DO UPDATE SET enabled = false;
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.set_org_area(%L, NULL, %L, %L, NULL, NULL, NULL, NULL, false, true)', A, 'vendas', 'Sem modulo'), 'sem o modulo Gestao nao cria area');
  INSERT INTO public.org_modules (organization_id, module, enabled) VALUES (A, 'gestao', true)
    ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.set_org_area(%L, NULL, %L, %L, NULL, NULL, NULL, NULL, false, true)', A, 'vendas', 'Vendas'), 'atendente nao cria area');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.set_org_area(%L, NULL, %L, %L, NULL, NULL, NULL, NULL, false, true)', A, 'vendas', 'Vendas'), 'outra org nao cria area em A');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.set_org_area(%L, NULL, %L, %L, NULL, %L, NULL, NULL, false, true)', A, 'vendas', 'Vendas', owner_b), 'responsavel de outra empresa recusado');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.set_org_area(%L, NULL, %L, %L, NULL, NULL, NULL, NULL, false, true)', A, 'inventada', 'X'), 'tipo de area fora da lista recusado');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('SELECT public.set_org_area(%L, NULL, %L, %L, NULL, %L, NULL, %L, false, true)', A, 'vendas', 'Vendas', agent_a, 'responsavel')) = 'ok:1', 'dono cria area com responsavel');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT count(*) FROM public.org_areas') = 1, 'responsavel ve a sua area');
  PERFORM pg_temp.expect(pg_temp.q(agent2_a, 'SELECT count(*) FROM public.org_areas') = 0, 'outro atendente nao ve areas');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.org_areas') = 0, 'outra org nao ve areas de A');
  PERFORM pg_temp.expect_denied(owner_a, format('INSERT INTO public.org_areas (organization_id, key, name) VALUES (%L, %L, %L)', A, 'rh', 'RH'), 'navegador nao grava area direto');
  PERFORM pg_temp.expect(pg_temp.t(owner_a, format('SELECT public.seed_org_areas(%L) >= 1', A)) = 'true', 'dono sugere areas pelos setores');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.seed_org_areas(%L)', A), 'atendente nao sugere areas');

  -- 74. Responsavel aprova so a propria area, so processo/automacao, e so no modo responsavel.
  INSERT INTO public.improvements (id, organization_id, title, kind, status, source, area_id) VALUES
    ('aaaaaaaa-0000-0000-0074-000000000001', A, 'Melhoria de vendas', 'processo', 'sugerida', 'cerebro', (SELECT id FROM public.org_areas WHERE organization_id = A AND name = 'Vendas')),
    ('aaaaaaaa-0000-0000-0074-000000000002', A, 'Agente novo de vendas', 'agente', 'sugerida', 'cerebro', (SELECT id FROM public.org_areas WHERE organization_id = A AND name = 'Vendas')),
    ('aaaaaaaa-0000-0000-0074-000000000003', A, 'Outra area', 'processo', 'sugerida', 'manual', (SELECT id FROM public.org_areas WHERE organization_id = A AND name <> 'Vendas' LIMIT 1));
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT count(*) FROM public.improvements WHERE source = ''cerebro''') = 2, 'responsavel ve as propostas da area');
  PERFORM pg_temp.expect(pg_temp.q(agent2_a, 'SELECT count(*) FROM public.improvements WHERE source = ''cerebro''') = 0, 'outro atendente nao ve');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.approve_improvement(%L)', 'aaaaaaaa-0000-0000-0074-000000000002'), 'responsavel nao aprova agente de IA');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.approve_improvement(%L)', 'aaaaaaaa-0000-0000-0074-000000000003'), 'responsavel nao aprova outra area');
  PERFORM pg_temp.expect_error(agent2_a, format('SELECT public.approve_improvement(%L)', 'aaaaaaaa-0000-0000-0074-000000000001'), 'quem nao e responsavel nao aprova');
  UPDATE public.org_areas SET approval_mode = 'dono' WHERE organization_id = A AND name = 'Vendas';
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.approve_improvement(%L)', 'aaaaaaaa-0000-0000-0074-000000000001'), 'modo dono: responsavel nao aprova');
  UPDATE public.org_areas SET approval_mode = 'responsavel' WHERE organization_id = A AND name = 'Vendas';
  PERFORM pg_temp.expect(pg_temp.run(agent_a, format('SELECT public.approve_improvement(%L)', 'aaaaaaaa-0000-0000-0074-000000000001')) = 'ok:1', 'responsavel aprova a propria area');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.set_improvement_area(%L, NULL)', 'aaaaaaaa-0000-0000-0074-000000000002'), 'responsavel nao muda a area da proposta');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.set_improvement_area(%L, %L)', 'aaaaaaaa-0000-0000-0074-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001'), 'area inexistente ou de outra org recusada');
  PERFORM pg_temp.expect_error(owner_a, format('UPDATE public.improvements SET area_id = (SELECT id FROM public.org_areas WHERE organization_id = %L LIMIT 1)', A), 'navegador nao grava improvements');

  -- 75. Metas e numeros por area: so o dono define; indicador so do catalogo da area; responsavel so ve a sua.
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('SELECT public.save_area_goal(%L, NULL, (SELECT id FROM public.org_areas WHERE organization_id = %L AND name = %L), %L, %L, %L, 10, %L, NULL)',
    A, A, 'Vendas', 'Mais leads', 'leads_novos', 'up', 'semana')) = 'ok:1', 'dono cria meta da area');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.save_area_goal(%L, NULL, (SELECT id FROM public.org_areas WHERE organization_id = %L AND name = %L), %L, %L, %L, 10, %L, NULL)',
    A, A, 'Vendas', 'Errada', 'valor_emitido', 'up', 'semana'), 'indicador de outra area recusado');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.save_area_goal(%L, NULL, (SELECT id FROM public.org_areas WHERE organization_id = %L AND name = %L), %L, %L, %L, 5, %L, NULL)',
    A, A, 'Vendas', 'X', 'leads_novos', 'up', 'semana'), 'responsavel nao cria meta');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT count(*) FROM public.area_goals') = 1, 'responsavel ve a meta da sua area');
  PERFORM pg_temp.expect(pg_temp.q(agent2_a, 'SELECT count(*) FROM public.area_goals') = 0, 'outro atendente nao ve metas');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.area_goals') = 0, 'outra org nao ve metas de A');
  PERFORM pg_temp.expect(pg_temp.t(owner_a, format('SELECT public.brain_overview(%L) ->> %L', A, 'scope')) = 'dono', 'dono ve o painel inteiro');
  PERFORM pg_temp.expect(pg_temp.t(agent_a, format('SELECT jsonb_array_length(public.brain_overview(%L) -> %L)', A, 'areas')) = '1', 'responsavel ve so a sua area');
  PERFORM pg_temp.expect(pg_temp.t(agent_a, format('SELECT public.brain_overview(%L) -> %L -> 0 -> %L -> 0 ->> %L', A, 'areas', 'goals', 'light')) IN ('no_rumo', 'atencao', 'fora', 'sem_dados'), 'semaforo calculado no banco');
  PERFORM pg_temp.expect_error(agent2_a, format('SELECT public.brain_overview(%L)', A), 'quem nao e responsavel nao ve o painel');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.brain_overview(%L)', A), 'outra org nao ve o painel de A');
  PERFORM pg_temp.expect_denied(owner_a, format('INSERT INTO public.area_metric_snapshots (organization_id, area_id, metric_key, period_start, value) VALUES (%L, (SELECT id FROM public.org_areas WHERE organization_id = %L LIMIT 1), %L, current_date, 1)', A, A, 'leads_novos'), 'navegador nao grava foto dos numeros');
  PERFORM pg_temp.expect(private.snapshot_area_metrics(A) >= 1, 'backend grava a foto semanal');

  -- 76. Cobrancas do cerebro: avisa so quem deve (mesma empresa), 1x por intervalo, e escala ao dono depois de 2.
  UPDATE public.improvements SET approved_at = now() - interval '8 days', reminded_at = NULL, reminders = 0 WHERE id = 'aaaaaaaa-0000-0000-0074-000000000001';
  DELETE FROM public.notifications WHERE organization_id = A AND kind = 'brain_reminder';
  PERFORM private.brain_daily_tick();
  PERFORM pg_temp.expect((SELECT count(*) FROM public.notifications WHERE organization_id = A AND kind = 'brain_reminder'
    AND ref ->> 'improvement_id' = 'aaaaaaaa-0000-0000-0074-000000000001' AND user_id = agent_a) = 1, 'responsavel cobrado pela aprovada parada');
  PERFORM pg_temp.expect((SELECT count(*) FROM public.notifications WHERE kind = 'brain_reminder' AND organization_id <> A
    AND ref ->> 'improvement_id' = 'aaaaaaaa-0000-0000-0074-000000000001') = 0, 'cobranca nao vaza para outra empresa');
  PERFORM private.brain_daily_tick();
  PERFORM pg_temp.expect((SELECT reminders FROM public.improvements WHERE id = 'aaaaaaaa-0000-0000-0074-000000000001') = 1, 'nao cobra de novo antes de 3 dias');
  UPDATE public.improvements SET reminders = 2, reminded_at = now() - interval '4 days' WHERE id = 'aaaaaaaa-0000-0000-0074-000000000001';
  PERFORM private.brain_daily_tick();
  PERFORM pg_temp.expect((SELECT count(*) FROM public.notifications WHERE organization_id = A AND kind = 'brain_reminder'
    AND (ref ->> 'escalado')::boolean AND user_id = owner_a AND ref ->> 'improvement_id' = 'aaaaaaaa-0000-0000-0074-000000000001') = 1, 'depois de 2 cobrancas escala ao dono');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.nudge_improvement(%L)', 'aaaaaaaa-0000-0000-0074-000000000001'), 'responsavel nao usa Cobrar');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.nudge_improvement(%L)', 'aaaaaaaa-0000-0000-0074-000000000001'), 'Cobrar so 1x a cada 24h');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.brain_pending(%L)', A), 'outra org nao ve pendencias de A');
  PERFORM pg_temp.expect(pg_temp.t(agent_a, format('SELECT jsonb_array_length(public.brain_pending(%L)) >= 1', A)) = 'true', 'responsavel ve as pendencias da area');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.set_improvement_due(%L, current_date - 1)', 'aaaaaaaa-0000-0000-0074-000000000001'), 'prazo no passado recusado');
  PERFORM pg_temp.expect(pg_temp.run(agent_a, format('SELECT public.set_improvement_due(%L, current_date + 3)', 'aaaaaaaa-0000-0000-0074-000000000001')) = 'ok:1', 'responsavel define prazo');

  -- 77. Resultado volta ao Diagnostico (so da mesma empresa).
  UPDATE public.company_profiles SET processes = '[{"nome":"Confirmar agendamento","implementar":"agora"},{"nome":"Outro"}]'::jsonb WHERE organization_id = A;
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.link_improvement_process(%L, %L)', 'aaaaaaaa-0000-0000-0074-000000000001', 'Nao existe'), 'processo inexistente recusado');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.link_improvement_process(%L, %L)', 'aaaaaaaa-0000-0000-0074-000000000001', 'Outro'), 'responsavel nao liga processo');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('SELECT public.link_improvement_process(%L, %L)', 'aaaaaaaa-0000-0000-0074-000000000001', 'confirmar agendamento')) = 'ok:1', 'dono liga a proposta ao processo');
  UPDATE public.improvements SET status = 'no_ar', live_at = now() WHERE id = 'aaaaaaaa-0000-0000-0074-000000000001';
  PERFORM pg_temp.expect((SELECT x -> 'implantacao' ->> 'status' FROM public.company_profiles p, jsonb_array_elements(p.processes) x
    WHERE p.organization_id = A AND x ->> 'nome' = 'Confirmar agendamento') = 'no_ar', 'processo mostra que foi implantado');
  PERFORM pg_temp.expect((SELECT x ->> 'implementar' FROM public.company_profiles p, jsonb_array_elements(p.processes) x
    WHERE p.organization_id = A AND x ->> 'nome' = 'Confirmar agendamento') = 'agora', 'escolha do dono preservada');
  PERFORM pg_temp.expect(NOT EXISTS (SELECT 1 FROM public.company_profiles p, jsonb_array_elements(coalesce(p.processes, '[]'::jsonb)) x
    WHERE p.organization_id <> A AND x ? 'implantacao' AND x -> 'implantacao' ->> 'melhoria_id' = 'aaaaaaaa-0000-0000-0074-000000000001'), 'nao toca no Diagnostico de outra empresa');

  -- 78. Cerebro so pelo servidor; analises so o dono ve; franquia so o operador grava.
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.service_brain_packet(%L)', A), 'navegador nao le o pacote do cerebro');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.service_brain_propose_area(%L, NULL, NULL, %L)', A, '[]'), 'navegador nao grava proposta do cerebro');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.service_brain_start_run(%L, %L, NULL)', A, 'manual'), 'navegador nao abre analise');
  PERFORM pg_temp.expect_error(owner_a, 'SELECT * FROM public.service_brain_due()', 'navegador nao lista empresas do cerebro');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.platform_set_module_limits(%L, %L, %L)', A, 'gestao', '{"analises_mes":999}'), 'dono nao muda a propria franquia');
  PERFORM pg_temp.expect(pg_temp.run(operator, format('SELECT public.platform_set_module_limits(%L, %L, %L)', A, 'gestao', '{"analises_mes":8}')) = 'ok:1', 'operador define a franquia');
  INSERT INTO public.brain_runs (id, organization_id, kind, status, period_start) VALUES ('aaaaaaaa-0000-0000-0078-000000000001', A, 'manual', 'ok', current_date);
  PERFORM pg_temp.expect(pg_temp.q(owner_a, 'SELECT count(*) FROM public.brain_runs') = 1, 'dono ve as analises');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT count(*) FROM public.brain_runs') = 0, 'responsavel nao ve o resumo de CEO');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.brain_runs') = 0, 'outra org nao ve analises de A');
  PERFORM pg_temp.expect_denied(owner_a, format('INSERT INTO public.brain_runs (organization_id, kind) VALUES (%L, %L)', A, 'manual'), 'navegador nao grava analise');

  -- 79. Propostas do cerebro: nascem sugeridas, no maximo 3, avisam o responsavel, e area cheia nao recebe mais.
  DELETE FROM public.improvements WHERE organization_id = A AND source = 'cerebro' AND status = 'sugerida';
  PERFORM pg_temp.expect(public.service_brain_propose_area(A, 'aaaaaaaa-0000-0000-0078-000000000001', (SELECT id FROM public.org_areas WHERE organization_id = A AND name = 'Vendas'),
    '[{"titulo":"P1","tipo":"processo"},{"titulo":"P2","tipo":"automacao","modelo":"followup"},{"titulo":"P3","tipo":"processo"},{"titulo":"P4","tipo":"processo"}]'::jsonb) = 3, 'no maximo 3 por analise');
  PERFORM pg_temp.expect((SELECT bool_and(status = 'sugerida' AND source = 'cerebro' AND agent_key = 'area:vendas' AND organization_id = A)
    FROM public.improvements WHERE brain_run_id = 'aaaaaaaa-0000-0000-0078-000000000001'), 'nascem sugeridas, marcadas como do cerebro');
  PERFORM pg_temp.expect(EXISTS (SELECT 1 FROM public.notifications WHERE organization_id = A AND user_id = agent_a AND kind = 'improvement' AND ref ->> 'title' = 'P1'), 'responsavel avisado');
  PERFORM pg_temp.expect(public.service_brain_propose_area(A, 'aaaaaaaa-0000-0000-0078-000000000001', (SELECT id FROM public.org_areas WHERE organization_id = A AND name = 'Vendas'), '[{"titulo":"P1"}]'::jsonb) = 0, 'titulo repetido nao duplica');
  PERFORM public.service_brain_propose_area(A, 'aaaaaaaa-0000-0000-0078-000000000001', (SELECT id FROM public.org_areas WHERE organization_id = A AND name = 'Vendas'), '[{"titulo":"P5"},{"titulo":"P6"}]'::jsonb);
  PERFORM pg_temp.expect(public.service_brain_propose_area(A, 'aaaaaaaa-0000-0000-0078-000000000001', (SELECT id FROM public.org_areas WHERE organization_id = A AND name = 'Vendas'), '[{"titulo":"P7"}]'::jsonb) = 0, 'area com 5 pendentes nao recebe mais');
  PERFORM pg_temp.expect(public.service_brain_propose_area('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0078-000000000001', (SELECT id FROM public.org_areas WHERE organization_id = A AND name = 'Vendas'), '[{"titulo":"Z"}]'::jsonb) = 0, 'area de A nao grava em nome de B');
  -- Modo "so o dono": nem o supervisor do setor aprova; e o aviso vai para o dono.
  INSERT INTO public.improvements (id, organization_id, title, kind, status, source, area_id, department_id) VALUES
    ('aaaaaaaa-0000-0000-0079-000000000001', A, 'Agente do setor', 'agente', 'sugerida', 'manual', NULL, 'aaaaaaaa-0000-0000-0001-000000000001'),
    ('aaaaaaaa-0000-0000-0079-000000000002', A, 'Do cerebro no setor', 'processo', 'sugerida', 'cerebro', (SELECT id FROM public.org_areas WHERE organization_id = A AND name = 'Vendas'), 'aaaaaaaa-0000-0000-0001-000000000001');
  PERFORM pg_temp.expect(pg_temp.run(sup_a, format('SELECT public.approve_improvement(%L)', 'aaaaaaaa-0000-0000-0079-000000000001')) = 'ok:1', 'supervisor do setor continua aprovando (regra antiga)');
  UPDATE public.org_areas SET approval_mode = 'dono' WHERE organization_id = A AND name = 'Vendas';
  PERFORM pg_temp.expect_error(sup_a, format('SELECT public.approve_improvement(%L)', 'aaaaaaaa-0000-0000-0079-000000000002'), 'modo dono: supervisor do setor nao aprova');
  PERFORM pg_temp.expect((SELECT count(*) FROM private.brain_recipients(A, (SELECT id FROM public.org_areas WHERE organization_id = A AND name = 'Vendas'), false) r WHERE r = agent_a) = 0, 'modo dono: cobranca nao vai para o responsavel');
  UPDATE public.org_areas SET approval_mode = 'responsavel' WHERE organization_id = A AND name = 'Vendas';
  -- Correcao herda a area da original.
  INSERT INTO public.improvements (id, organization_id, title, kind, status, source, parent_id) VALUES
    ('aaaaaaaa-0000-0000-0079-000000000003', A, 'Ajustar: P1', 'processo', 'sugerida', 'monitor', (SELECT id FROM public.improvements WHERE organization_id = A AND title = 'P1'));
  PERFORM pg_temp.expect((SELECT area_id IS NOT NULL FROM public.improvements WHERE id = 'aaaaaaaa-0000-0000-0079-000000000003'), 'correcao herda a area');
  -- Analise: so uma em andamento; presa vira erro.
  INSERT INTO public.brain_runs (organization_id, kind, status, started_at) VALUES (A, 'manual', 'rodando', now() - interval '20 minutes');
  PERFORM pg_temp.expect(public.service_brain_start_run(A, 'semanal', NULL) IS NOT NULL, 'analise presa e liberada e a nova abre');
  PERFORM pg_temp.expect(public.service_brain_start_run(A, 'semanal', NULL) IS NULL, 'so uma analise em andamento por empresa');

  -- 80. LGPD do pacote: so agregados, sem telefone nem conteudo de conversa.
  PERFORM pg_temp.expect(public.service_brain_packet(A)::text NOT LIKE '%5511900000001%', 'pacote sem telefone de cliente');
  PERFORM pg_temp.expect(public.service_brain_packet(A)::text NOT LIKE '%@%', 'pacote sem e-mail');
  PERFORM pg_temp.expect(public.service_brain_packet(A)::text NOT LIKE '%"oi"%', 'pacote sem mensagens');

  -- 83. Planos: visitante e cliente veem so os publicos e ativos; so a Clubetec edita.
  INSERT INTO public.plans (key, name, modules, public, active) VALUES ('iso_oculto', 'Oculto', ARRAY['ia'], false, true) ON CONFLICT (key) DO NOTHING;
  EXECUTE 'SET LOCAL ROLE anon';
  PERFORM pg_temp.expect((SELECT count(*) FROM public.plans WHERE key = 'iso_oculto') = 0 AND (SELECT count(*) FROM public.plans) >= 1, 'visitante ve so planos publicos');
  EXECUTE 'RESET ROLE';
  PERFORM pg_temp.expect(pg_temp.q(owner_a, 'SELECT count(*) FROM public.plans WHERE key = ''iso_oculto''') = 0, 'cliente nao ve plano oculto');
  PERFORM pg_temp.expect(pg_temp.q(operator, 'SELECT count(*) FROM public.plans WHERE key = ''iso_oculto''') = 1, 'Clubetec ve plano oculto');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.platform_save_plan(%L, %L, NULL, 1, 0, %L, %L, NULL, 14, true, true, 0)', 'gratis', 'Gratis', '{ia}', '{}'), 'cliente nao cria plano');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.platform_set_subscription(%L, %L, %L, 30)', A, 'completo', 'active'), 'cliente nao muda a propria assinatura');
  PERFORM pg_temp.expect_denied(owner_a, format('INSERT INTO public.subscriptions (organization_id, plan_key) VALUES (%L, %L)', A, 'completo'), 'navegador nao grava assinatura');

  -- 84. Criar a propria empresa (teste gratis): e-mail confirmado, modulos do plano, 1 teste por pessoa, franquia de IA.
  UPDATE auth.users SET email_confirmed_at = NULL WHERE id = outsider;
  PERFORM pg_temp.expect_error(outsider, format('SELECT public.self_signup_org(%L, %L, %L)', 'Loja do Outsider', 'generico', 'essencial'), 'sem e-mail confirmado nao cria');
  UPDATE auth.users SET email_confirmed_at = now() WHERE id = outsider;
  PERFORM pg_temp.expect_error(outsider, format('SELECT public.self_signup_org(%L, %L, %L)', 'Loja', 'generico', 'iso_oculto'), 'plano oculto nao vale no cadastro');
  PERFORM pg_temp.expect(pg_temp.run(outsider, format('SELECT public.self_signup_org(%L, %L, %L)', 'Loja do Outsider', 'generico', 'essencial')) = 'ok:1', 'pessoa cria a propria empresa');
  PERFORM pg_temp.expect((SELECT s.status = 'trial' AND s.trial_ends_at > now() + interval '13 days' FROM public.subscriptions s JOIN public.organizations o ON o.id = s.organization_id
    WHERE o.created_by = outsider), 'nasce em teste gratis');
  PERFORM pg_temp.expect((SELECT string_agg(module, ',' ORDER BY module) FROM public.org_modules m JOIN public.organizations o ON o.id = m.organization_id
    WHERE o.created_by = outsider AND m.enabled) = 'canais,ia', 'modulos exatamente os do plano');
  PERFORM pg_temp.expect((SELECT role = 'owner' FROM public.organization_members m JOIN public.organizations o ON o.id = m.organization_id
    WHERE o.created_by = outsider AND m.user_id = outsider), 'quem criou vira dono');
  PERFORM pg_temp.expect_error(outsider, format('SELECT public.self_signup_org(%L, %L, %L)', 'Segunda', 'generico', 'essencial'), 'um teste gratis por pessoa');
  PERFORM pg_temp.expect_denied(owner_b, format('INSERT INTO public.organizations (name, slug, created_by) VALUES (%L, %L, %L)', 'Pirata', 'org-pirata', owner_b), 'navegador nao cria empresa direto');
  PERFORM pg_temp.expect_denied(owner_b, format('INSERT INTO public.organization_members (organization_id, user_id, role, status) VALUES (%L, %L, %L, %L)', A, owner_b, 'owner', 'active'), 'navegador nao se poe como dono');
  PERFORM pg_temp.expect(pg_temp.q(owner_a, format('SELECT count(*) FROM public.subscriptions s JOIN public.organizations o ON o.id = s.organization_id WHERE o.created_by = %L', outsider)) = 0, 'outra empresa nao ve a assinatura');
  PERFORM pg_temp.expect(pg_temp.t(outsider, format('SELECT public.my_subscription((SELECT id FROM public.organizations WHERE created_by = %L)) ->> %L', outsider, 'status')) = 'trial', 'dono ve a propria assinatura');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.my_subscription((SELECT id FROM public.organizations WHERE created_by = %L))', outsider), 'dono de outra empresa nao ve');
  INSERT INTO public.ai_usage_daily (organization_id, day, provider, source, calls)
  SELECT id, current_date, 'openai', 'plataforma', 3000 FROM public.organizations WHERE created_by = outsider;
  PERFORM pg_temp.expect(NOT public.service_ai_take((SELECT id FROM public.organizations WHERE created_by = outsider)), 'franquia mensal de IA esgotada bloqueia');
  PERFORM pg_temp.expect(public.service_ai_take(A), 'empresa sem plano continua com IA');

  -- 85. Cobranca da assinatura: so o servidor grava; aviso processado uma vez e so na assinatura certa; rotina diaria.
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.service_billing_link(%L, %L, %L, %L, NULL, NULL)', A, 'cus_x', 'sub_x', 'completo'), 'navegador nao liga assinatura');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.service_billing_event(%L, %L, %L, current_date)', 'evt_x', 'sub_x', 'PAYMENT_RECEIVED'), 'navegador nao confirma pagamento');
  PERFORM pg_temp.expect_error(owner_a, 'SELECT public.platform_billing_status()', 'cliente nao ve o Asaas da Clubetec');
  PERFORM public.service_billing_link((SELECT id FROM public.organizations WHERE created_by = outsider), 'cus_iso', 'sub_iso', 'essencial', NULL, NULL);
  PERFORM pg_temp.expect(public.service_billing_event('evt_iso_1', 'sub_iso', 'PAYMENT_RECEIVED', current_date) = 'ok', 'pagamento confirmado');
  PERFORM pg_temp.expect((SELECT status = 'active' AND current_period_end > now() + interval '25 days' FROM public.subscriptions WHERE asaas_subscription_id = 'sub_iso'), 'assinatura ativa por um mes');
  PERFORM pg_temp.expect(public.service_billing_event('evt_iso_1', 'sub_iso', 'PAYMENT_RECEIVED', current_date) = 'repetido', 'aviso repetido nao reprocessa');
  PERFORM pg_temp.expect(public.service_billing_event('evt_iso_2', 'sub_desconhecida', 'PAYMENT_RECEIVED', current_date) = 'ignorado', 'assinatura desconhecida ignorada');
  PERFORM pg_temp.expect(NOT EXISTS (SELECT 1 FROM public.subscriptions WHERE organization_id = A), 'pagamento de outra empresa nao cria assinatura em A');
  -- Rotina diaria: teste vencido para a empresa e desliga os modulos (dados ficam).
  UPDATE public.subscriptions SET status = 'trial', trial_ends_at = now() - interval '1 day' WHERE asaas_subscription_id = 'sub_iso';
  PERFORM private.billing_tick();
  PERFORM pg_temp.expect((SELECT status FROM public.subscriptions WHERE asaas_subscription_id = 'sub_iso') = 'expired', 'teste vencido vira vencida');
  PERFORM pg_temp.expect(NOT EXISTS (SELECT 1 FROM public.org_modules m JOIN public.subscriptions s ON s.organization_id = m.organization_id
    WHERE s.asaas_subscription_id = 'sub_iso' AND m.enabled), 'vencida desliga os modulos');
  PERFORM pg_temp.expect(pg_temp.t(outsider, format('SELECT public.org_access_state((SELECT id FROM public.organizations WHERE created_by = %L)) ->> %L', outsider, 'status')) = 'expired', 'membro ve que esta vencida');
  PERFORM pg_temp.expect(pg_temp.t(owner_b, format('SELECT coalesce(public.org_access_state((SELECT id FROM public.organizations WHERE created_by = %L))::text, %L)', outsider, 'nada')) = 'nada', 'outra org nao ve a situacao');
  PERFORM pg_temp.expect(public.service_billing_event('evt_iso_3', 'sub_iso', 'PAYMENT_CONFIRMED', current_date) = 'ok', 'pagou depois de vencida');
  PERFORM pg_temp.expect((SELECT count(*) FROM public.org_modules m JOIN public.subscriptions s ON s.organization_id = m.organization_id
    WHERE s.asaas_subscription_id = 'sub_iso' AND m.enabled) = 2, 'pagar religa os modulos do plano');

  -- 94. Messenger/Instagram: Pagina so da propria empresa; conversa nao cruza empresas.
  INSERT INTO public.meta_pages (id, organization_id, page_id, name) VALUES
    ('aaaaaaaa-0000-0000-0094-000000000001', A, '111111111111', 'Pagina A'),
    ('bbbbbbbb-0000-0000-0094-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '222222222222', 'Pagina B');
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT count(*) FROM public.meta_pages') = 1, 'membro ve so a Pagina da empresa');
  PERFORM pg_temp.expect(pg_temp.q(outsider, 'SELECT count(*) FROM public.meta_pages') = 0, 'quem nao e de empresa nenhuma nao ve');
  PERFORM pg_temp.expect_error(owner_a, format('INSERT INTO public.meta_pages (organization_id, page_id, name) VALUES (%L, %L, %L)', A, '333333333333', 'x'), 'navegador nao conecta Pagina direto');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.set_meta_page(%L, NULL, true, true, false)', 'aaaaaaaa-0000-0000-0094-000000000001'), 'outra org nao muda a Pagina');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.set_meta_page(%L, NULL, true, true, false)', 'aaaaaaaa-0000-0000-0094-000000000001'), 'atendente nao muda a Pagina');
  PERFORM pg_temp.run(owner_a, format('SELECT public.set_meta_page(%L, NULL, true, true, true)', 'aaaaaaaa-0000-0000-0094-000000000001'));
  PERFORM pg_temp.expect((SELECT ai_reply AND NOT instagram FROM public.meta_pages WHERE id = 'aaaaaaaa-0000-0000-0094-000000000001'), 'Instagram so liga com conta ligada');
  PERFORM pg_temp.expect(pg_temp.run(NULL, format('INSERT INTO public.conversations (organization_id, channel, meta_page_id, contact_external_id) VALUES (%L, %L, %L, %L)',
    A, 'messenger', 'bbbbbbbb-0000-0000-0094-000000000001', '5555555555')) LIKE 'err:%', 'conversa de A nao usa a Pagina de B');
  INSERT INTO public.conversations (id, channel, meta_page_id, contact_external_id) VALUES ('aaaaaaaa-0000-0000-0094-000000000011', 'messenger', 'aaaaaaaa-0000-0000-0094-000000000001', '5555555555');
  PERFORM pg_temp.expect((SELECT organization_id FROM public.conversations WHERE id = 'aaaaaaaa-0000-0000-0094-000000000011') = A, 'conversa herda a empresa da Pagina');
  PERFORM pg_temp.expect((SELECT status FROM public.service_ticket_for_inbound('aaaaaaaa-0000-0000-0094-000000000011', false)) IN ('bot', 'queued'), 'atendimento nasce pela regra da Pagina');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.conversations WHERE id = ''aaaaaaaa-0000-0000-0094-000000000011''') = 0, 'outra org nao ve a conversa do Messenger');
  PERFORM pg_temp.expect_error(owner_a, 'SELECT public.service_meta_page_forget(''aaaaaaaa-0000-0000-0094-000000000001'')', 'navegador nao apaga token');

  -- 95. Marca no INPI: so a Clubetec ve e mexe; o registro da revista so pelo servidor.
  PERFORM pg_temp.expect(pg_temp.q(owner_a, 'SELECT count(*) FROM public.inpi_processes') = 0, 'cliente nao ve os processos da Clubetec');
  PERFORM pg_temp.expect(pg_temp.q(outsider, 'SELECT count(*) FROM public.inpi_conflicts') = 0, 'cliente nao ve marcas parecidas');
  PERFORM pg_temp.expect(pg_temp.q(operator, 'SELECT count(*) FROM public.inpi_processes') >= 3, 'operador ve os processos');
  PERFORM pg_temp.expect_error(owner_a, 'SELECT public.platform_inpi_save_process(''123456789'', ''x'', NULL, NULL)', 'cliente nao cadastra processo');
  PERFORM pg_temp.expect_error(owner_a, 'SELECT public.platform_inpi_set_watch(ARRAY[''abcd''], ARRAY[''abcd''])', 'cliente nao muda a vigilancia');
  PERFORM pg_temp.expect_error(owner_a, 'SELECT public.platform_inpi_set_email(true, ARRAY[''x@y.com''])', 'cliente nao muda o e-mail do INPI');
  PERFORM pg_temp.expect_error(operator, 'SELECT public.service_inpi_recipients()', 'navegador nao le os destinatarios');
  PERFORM pg_temp.expect_error(operator, 'SELECT public.platform_inpi_set_email(true, ARRAY[''nao-e-email''])', 'e-mail invalido recusado');
  PERFORM pg_temp.expect_error(operator, 'SELECT public.service_inpi_record(1, current_date, ''[]'', ''[]'', NULL)', 'navegador nao grava revista');
  PERFORM pg_temp.expect_error(owner_a, 'INSERT INTO public.inpi_conflicts (numero, rpi, rpi_date, marca) VALUES (''123456789'', 1, current_date, ''x'')', 'ninguem grava direto');
  PERFORM pg_temp.run(operator, 'SELECT public.platform_inpi_save_process(''900000095'', ''Teste'', NULL, current_date)');
  PERFORM public.service_inpi_record(99095, '2026-10-06',
    '[{"numero":"900000095","despachos":[{"codigo":"IPAS136","nome":"Exigência de mérito","nivel":"urgente","orientacao":"x","dias":60}]}]',
    '[{"numero":"900000095","marca":"nossa"},{"numero":"900000096","marca":"Deixe com a IA","despacho":"Publicação de pedido de registro para oposição"}]', NULL);
  PERFORM pg_temp.expect((SELECT prazo FROM public.inpi_events WHERE numero = '900000095' AND rpi = 99095) = '2026-12-05', 'despacho grava o prazo');
  PERFORM pg_temp.expect((SELECT last_status FROM public.inpi_processes WHERE numero = '900000095') = 'Exigência de mérito', 'processo mostra o ultimo despacho');
  PERFORM pg_temp.expect((SELECT count(*) FROM public.inpi_conflicts WHERE rpi = 99095) = 1, 'marca parecida entra; processo nosso nao vira conflito');
  PERFORM pg_temp.expect((SELECT prazo FROM public.inpi_conflicts WHERE numero = '900000096') = '2026-12-05', 'prazo de oposicao de 60 dias');

  -- 96. Diagnostico: rascunho salvo sozinho so na propria empresa; anexo de outra empresa nao entra.
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.save_step_draft(%L, %L, %L, NULL)', A, 'empresa', 'texto de B'), 'outra org nao grava rascunho');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.save_step_draft(%L, %L, %L, NULL)', A, 'empresa', 'x'), 'atendente nao grava rascunho');
  INSERT INTO public.knowledge_docs (id, organization_id, title) VALUES ('bbbbbbbb-0000-0000-0096-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'doc de B');
  PERFORM pg_temp.run(owner_a, format('SELECT public.save_step_draft(%L, %L, %L, %L)', A, 'cultura', 'missao e valores',
    '[{"id":"bbbbbbbb-0000-0000-0096-000000000001","name":"doc de B"}]'));
  PERFORM pg_temp.expect((SELECT steps -> 'cultura' ->> 'raw' FROM public.company_profiles WHERE organization_id = A) = 'missao e valores', 'rascunho gravado');
  PERFORM pg_temp.expect((SELECT jsonb_array_length(steps -> 'cultura' -> 'attachments') FROM public.company_profiles WHERE organization_id = A) = 0, 'anexo de outra org nao entra');
  PERFORM pg_temp.expect((SELECT last_page FROM public.company_profiles WHERE organization_id = A) = 'cultura', 'lembra a etapa onde parou');

  -- 97. Chamados de suporte: so da propria empresa; origem/conversa/resposta so pelo servidor.
  PERFORM pg_temp.expect_error(owner_b, format('INSERT INTO public.service_requests (organization_id, topic, message, created_by) VALUES (%L, %L, %L, %L)', A, 'x', 'y', owner_b), 'outra org nao abre chamado em A');
  PERFORM pg_temp.expect_error(agent_a, format('INSERT INTO public.service_requests (organization_id, topic, message, created_by) VALUES (%L, %L, %L, %L)', A, 'x', 'y', agent_a), 'atendente nao abre chamado direto');
  PERFORM pg_temp.expect_error(owner_a, format('INSERT INTO public.service_requests (organization_id, topic, message, created_by, source) VALUES (%L, %L, %L, %L, %L)', A, 'x', 'y', owner_a, 'assistente'), 'navegador nao forja a origem');
  PERFORM pg_temp.expect_error(owner_a, format('INSERT INTO public.service_requests (organization_id, topic, message, created_by, transcript) VALUES (%L, %L, %L, %L, %L)', A, 'x', 'y', owner_a, '[]'), 'navegador nao grava conversa');
  PERFORM pg_temp.run(owner_a, format('INSERT INTO public.service_requests (organization_id, topic, message, created_by, urgency, page) VALUES (%L, %L, %L, %L, %L, %L)', A, 'Teste 97', 'ajuda', owner_a, 'urgente', '/x'));
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.service_requests WHERE topic = ''Teste 97''') = 0, 'outra org nao ve o chamado');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.platform_set_request_status((SELECT id FROM public.service_requests WHERE topic = %L), %L, %L)', 'Teste 97', 'done', 'x'), 'cliente nao muda a situacao');
  PERFORM pg_temp.run(operator, format('SELECT public.platform_set_request_status((SELECT id FROM public.service_requests WHERE topic = %L), %L, %L)', 'Teste 97', 'done', 'Resolvido'));
  PERFORM pg_temp.expect((SELECT count(*) FROM public.notifications WHERE kind = 'support_status' AND user_id = owner_a AND ref ->> 'reply' = 'Resolvido') = 1, 'quem abriu recebe a resposta');

  -- 92. Rede de franquias: unidade entra por codigo; matriz ve so numeros; padrao so configuracao.
  UPDATE public.organizations SET status = 'active' WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001'; -- um grupo anterior suspende B
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.platform_create_network(%L, %L)', A, 'Rede X'), 'so a Clubetec cria rede');
  PERFORM pg_temp.run(operator, format('SELECT public.platform_create_network(%L, %L)', A, 'Rede Teste'));
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.network_invite((SELECT id FROM public.networks WHERE hq_org_id = %L))', A), 'atendente da matriz nao convida');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.network_invite((SELECT id FROM public.networks WHERE hq_org_id = %L))', A), 'quem nao e da matriz nao convida');
  PERFORM set_config('test.code', pg_temp.t(owner_a, format('SELECT public.network_invite((SELECT id FROM public.networks WHERE hq_org_id = %L))', A)), false);
  PERFORM pg_temp.expect(current_setting('test.code') LIKE 'REDE-%', 'matriz gera codigo');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, 'SELECT code_hash FROM public.network_invites LIMIT 1') LIKE 'err:%', 'navegador nao le o hash do convite');
  PERFORM pg_temp.expect_error(agent_b, format('SELECT public.network_join(%L, %L)', 'bbbbbbbb-0000-0000-0000-000000000001', current_setting('test.code')), 'atendente nao coloca a empresa na rede');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.network_join(%L, %L)', 'bbbbbbbb-0000-0000-0000-000000000001', 'REDE-0000000000'), 'codigo errado recusado');
  PERFORM pg_temp.run(owner_b, format('SELECT public.network_join(%L, %L)', 'bbbbbbbb-0000-0000-0000-000000000001', lower(current_setting('test.code'))));
  PERFORM pg_temp.expect((SELECT count(*) FROM public.network_units WHERE organization_id = 'bbbbbbbb-0000-0000-0000-000000000001') = 1, 'dono da unidade entra com o codigo');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.network_join(%L, %L)', 'bbbbbbbb-0000-0000-0000-000000000001', current_setting('test.code')), 'codigo vale uma vez');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.network_dashboard((SELECT id FROM public.networks WHERE hq_org_id = %L), now() - interval %L, now())', A, '30 days'), 'unidade nao ve o painel da rede');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.network_dashboard((SELECT id FROM public.networks WHERE hq_org_id = %L), now() - interval %L, now())', A, '30 days'), 'atendente da matriz nao ve o painel');
  PERFORM pg_temp.expect(pg_temp.t(owner_a, format('SELECT jsonb_array_length(public.network_dashboard((SELECT id FROM public.networks WHERE hq_org_id = %L), now() - interval %L, now()))', A, '30 days')) = '1', 'matriz ve uma linha por unidade');
  PERFORM pg_temp.expect(pg_temp.t(owner_a, format('SELECT (public.network_dashboard((SELECT id FROM public.networks WHERE hq_org_id = %L), now() - interval %L, now()) -> 0) ?| ARRAY[%L, %L, %L]', A, '30 days', 'phone', 'contact_name', 'content')) = 'false', 'painel sem dados de clientes');
  PERFORM pg_temp.expect(pg_temp.q(owner_a, 'SELECT count(*) FROM public.conversations WHERE organization_id = ''bbbbbbbb-0000-0000-0000-000000000001''') = 0, 'matriz nao le conversas da unidade');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, format('SELECT count(*) FROM public.conversations WHERE organization_id = %L', A)) = 0, 'unidade nao le conversas da matriz');
  INSERT INTO public.pipeline_stages (organization_id, name, color, position) VALUES (A, 'Etapa da Rede', '#123456', 99);
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.network_publish_standard((SELECT id FROM public.networks WHERE hq_org_id = %L), false)', A), 'unidade nao publica padrao');
  PERFORM pg_temp.expect(pg_temp.t(owner_a, format('SELECT public.network_publish_standard((SELECT id FROM public.networks WHERE hq_org_id = %L), false)', A)) = '1', 'matriz publica versao 1');
  PERFORM pg_temp.expect(pg_temp.q(agent_b, 'SELECT count(*) FROM public.network_standards') = 0, 'atendente da unidade nao ve o padrao');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.network_standards') = 1, 'dono da unidade ve o padrao');
  PERFORM pg_temp.expect(EXISTS (SELECT 1 FROM public.notifications WHERE organization_id = 'bbbbbbbb-0000-0000-0000-000000000001' AND user_id = owner_b AND kind = 'network_standard'), 'unidade e avisada do padrao');
  PERFORM pg_temp.run(owner_b, format('SELECT public.network_apply_standard(%L)', 'bbbbbbbb-0000-0000-0000-000000000001'));
  PERFORM pg_temp.expect(EXISTS (SELECT 1 FROM public.pipeline_stages WHERE organization_id = 'bbbbbbbb-0000-0000-0000-000000000001' AND name = 'Etapa da Rede'), 'padrao aplicado na unidade');
  PERFORM pg_temp.expect(pg_temp.t(outsider, format('SELECT coalesce(public.my_network(%L)::text, %L)', A, 'nulo')) = 'nulo', 'quem nao e da empresa nao ve a rede');
  PERFORM pg_temp.expect(pg_temp.t(agent_b, format('SELECT public.my_network(%L) ->> %L', 'bbbbbbbb-0000-0000-0000-000000000001', 'role')) = 'unit', 'pessoa da unidade ve a marca da rede');
  PERFORM pg_temp.run(owner_b, format('SELECT public.network_leave(%L)', 'bbbbbbbb-0000-0000-0000-000000000001'));
  PERFORM pg_temp.expect(pg_temp.t(owner_a, format('SELECT jsonb_array_length(public.network_dashboard((SELECT id FROM public.networks WHERE hq_org_id = %L), now() - interval %L, now()))', A, '30 days')) = '0', 'unidade sai quando quer');

  -- 93. Implantacao: antes x depois so para quem gerencia.
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.start_implantation(%L)', A), 'atendente nao inicia implantacao');
  PERFORM pg_temp.run(owner_a, format('SELECT public.start_implantation(%L)', A));
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.implantation_compare(%L)', A), 'outra org nao ve o antes e depois');
  PERFORM pg_temp.expect(pg_temp.t(owner_a, format('SELECT public.implantation_compare(%L) ? %L', A, 'antes')) = 'true', 'dono ve antes e depois');

  -- 91. Telefonia generica: dono cadastra a propria central; outra empresa nao mexe.
  INSERT INTO public.org_modules (organization_id, module, enabled) VALUES (A, 'telefonia', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.save_extension(%L, NULL, %L, %L, %L, %L, %L, %L, %L)', A, '7101', '7101', 'pbx.exemplo.com', 'wss://pbx.exemplo.com/ws', '3cx', 'Teste', 'senha123'), 'atendente nao cadastra ramal');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.save_extension(%L, NULL, %L, %L, %L, %L, %L, %L, %L)', A, '7101', '7101', 'pbx.exemplo.com', 'wss://pbx.exemplo.com/ws', '3cx', 'Teste', 'senha123'), 'outra org nao cadastra em A');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.save_extension(%L, NULL, %L, %L, %L, %L, %L, %L, %L)', A, '7102', '7102', 'pbx.exemplo.com', 'wss://pbx.exemplo.com/ws', 'qualquer', 'Teste', ''), 'central fora da lista recusada');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('SELECT public.save_extension(%L, NULL, %L, %L, %L, %L, %L, %L, %L)', A, '7101', '7101', 'pbx.exemplo.com', 'wss://pbx.exemplo.com/ws', '3cx', 'Teste', 'senha123')) LIKE 'ok:%', 'dono cadastra ramal da propria central');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, 'SELECT has_password FROM public.pbx_extensions WHERE number = ''7101''') LIKE 'ok:%', 'senha marcada sem voltar ao navegador');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.delete_extension((SELECT id FROM public.pbx_extensions WHERE organization_id = %L AND number = %L))', A, '7101'), 'outra org nao apaga ramal de A');
  PERFORM pg_temp.expect(pg_temp.t(owner_a, format('SELECT public.create_api_key(%L, %L, %L) ->> %L LIKE %L', A, 'central', '{calls:write}', 'key', 'dca_%')) = 'true', 'chave com permissao de ligacoes');

  -- 90. Campanhas: arquivo so da propria empresa; resultado so para quem gerencia.
  PERFORM pg_temp.expect_error(owner_b, format('INSERT INTO public.campaigns (organization_id, name, library_file_id) VALUES (%L, %L, %L)',
    'bbbbbbbb-0000-0000-0000-000000000001', 'Promo B', 'aaaaaaaa-0000-0000-0012-000000000001'), 'campanha de B nao usa arquivo de A');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('INSERT INTO public.campaigns (organization_id, name, library_file_id, message, message_b) VALUES (%L, %L, %L, %L, %L)',
    A, 'Promo AB', 'aaaaaaaa-0000-0000-0012-000000000001', 'Versao A', 'Versao B')) = 'ok:1', 'dono cria campanha A/B com arquivo');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.campaign_results(%L)', 'aaaaaaaa-0000-0000-0043-000000000021'), 'outra org nao ve resultado');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.campaign_results(%L)', 'aaaaaaaa-0000-0000-0043-000000000021'), 'atendente nao ve resultado');
  PERFORM pg_temp.expect(pg_temp.t(owner_a, format('SELECT jsonb_typeof(public.campaign_results(%L))', 'aaaaaaaa-0000-0000-0043-000000000021')) = 'array', 'dono ve resultado');

  -- 89. Chat: grupos so para os membros; reacoes so em canal visivel.
  PERFORM pg_temp.run(agent_a, format('SELECT public.save_team_group(%L, NULL, %L, ARRAY[%L, %L]::uuid[])', A, 'Projeto Teste', agent2_a, owner_b));
  PERFORM pg_temp.expect(pg_temp.q(agent2_a, format('SELECT count(*) FROM public.team_channels WHERE kind = %L AND name = %L', 'grupo', 'Projeto Teste')) = 1, 'membro ve o grupo');
  PERFORM pg_temp.expect(pg_temp.q(sup_a, format('SELECT count(*) FROM public.team_channels WHERE kind = %L', 'grupo')) = 0, 'quem nao e do grupo nao ve');
  PERFORM pg_temp.expect(pg_temp.q(owner_a, format('SELECT count(*) FROM public.team_channels WHERE kind = %L', 'grupo')) = 0, 'nem o dono ve grupo de que nao participa');
  PERFORM pg_temp.expect(NOT EXISTS (SELECT 1 FROM public.team_channel_members m JOIN public.team_channels c ON c.id = m.channel_id
    WHERE c.name = 'Projeto Teste' AND m.user_id = owner_b), 'pessoa de outra empresa nao entra no grupo');
  PERFORM pg_temp.expect_error(agent2_a, format('SELECT public.save_team_group(%L, (SELECT id FROM public.team_channels WHERE name = %L), %L, ARRAY[%L]::uuid[])', A, 'Projeto Teste', 'Renomeado', agent2_a), 'so quem criou muda o grupo');
  INSERT INTO public.team_messages (organization_id, channel_id, author_id, content)
  VALUES (A, (SELECT id FROM public.team_channels WHERE name = 'Projeto Teste'), agent2_a, 'mensagem do grupo');
  PERFORM pg_temp.expect(pg_temp.t(agent_a, format('SELECT public.team_react((SELECT id FROM public.team_messages WHERE content = %L), %L)', 'mensagem do grupo', '👍')) = 'true', 'membro reage');
  PERFORM pg_temp.expect_error(sup_a, format('SELECT public.team_react((SELECT id FROM public.team_messages WHERE content = %L), %L)', 'mensagem do grupo', '👍'), 'quem nao ve nao reage');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.team_react((SELECT id FROM public.team_messages WHERE content = %L), %L)', 'mensagem do grupo', 'x'), 'emoji fora da lista recusado');
  PERFORM pg_temp.expect(pg_temp.q(sup_a, 'SELECT count(*) FROM public.team_reactions') = 0, 'quem nao ve o canal nao ve reacoes');
  PERFORM pg_temp.expect(pg_temp.q(sup_a, format('SELECT count(*) FROM public.team_messages WHERE content = %L', 'mensagem do grupo')) = 0, 'busca nao acha mensagem de grupo alheio');
  PERFORM pg_temp.run(agent2_a, format('SELECT public.leave_team_group((SELECT id FROM public.team_channels WHERE name = %L))', 'Projeto Teste'));
  PERFORM pg_temp.expect(pg_temp.q(agent2_a, format('SELECT count(*) FROM public.team_channels WHERE kind = %L', 'grupo')) = 0, 'quem saiu deixa de ver');

  -- 88. Diagnostico: convite ao responsavel do setor ve so o proprio convite.
  INSERT INTO public.org_modules (organization_id, module, enabled) VALUES (A, 'diagnostico', true)
  ON CONFLICT (organization_id, module) DO UPDATE SET enabled = true;
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.diag_invite_sector(%L, %L, %L)', A, 'Vendas', agent2_a), 'atendente nao convida');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.diag_invite_sector(%L, %L, %L)', A, 'Vendas', agent_a), 'outra org nao convida em A');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.diag_invite_sector(%L, %L, %L)', A, 'Vendas', owner_b), 'so convida gente da equipe');
  PERFORM pg_temp.run(owner_a, format('SELECT public.diag_invite_sector(%L, %L, %L)', A, 'Vendas', agent_a));
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT count(*) FROM public.diag_delegations') = 1, 'convidado ve o proprio convite');
  PERFORM pg_temp.expect(pg_temp.q(agent2_a, 'SELECT count(*) FROM public.diag_delegations') = 0, 'outro atendente nao ve');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.diag_delegations') = 0, 'outra org nao ve');
  PERFORM pg_temp.expect_error(agent2_a, format('SELECT public.diag_submit_sector(%L, %L)', (SELECT id FROM public.diag_delegations WHERE organization_id = A AND user_id = agent_a), 'texto de outra pessoa aqui'), 'outro nao envia pelo convidado');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.diag_submit_sector(%L, %L)', (SELECT id FROM public.diag_delegations WHERE organization_id = A AND user_id = agent_a), 'curto'), 'texto curto recusado');
  PERFORM pg_temp.run(agent_a, format('SELECT public.diag_submit_sector(%L, %L)', (SELECT id FROM public.diag_delegations WHERE organization_id = A AND user_id = agent_a), '1. Cliente pede orcamento. 2. Vendedor responde.'));
  PERFORM pg_temp.expect(EXISTS (SELECT 1 FROM public.notifications WHERE organization_id = A AND user_id = owner_a AND kind = 'diag_submitted'), 'dono e avisado do envio');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.diag_close_delegation(%L, true)', (SELECT id FROM public.diag_delegations WHERE organization_id = A AND user_id = agent_a)), 'convidado nao fecha');
  PERFORM pg_temp.run(owner_a, format('SELECT public.diag_close_delegation(%L, true)', (SELECT id FROM public.diag_delegations WHERE organization_id = A AND user_id = agent_a)));
  PERFORM pg_temp.expect(pg_temp.q(agent_a, 'SELECT count(*) FROM public.diag_delegations') = 0, 'depois de usado some para o convidado');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.diag_submit_sector(%L, %L)', (SELECT id FROM public.diag_delegations WHERE organization_id = A AND user_id = agent_a), 'mudando depois de usado'), 'nao reenvia depois de usado');

  -- 87. Relatorio por e-mail: cada um assina o proprio; calculado com o escopo da pessoa.
  PERFORM pg_temp.expect_error(outsider, format('SELECT public.set_report_email(%L, %L, %L)', A, 'weekly', '{operacao}'), 'quem nao e da empresa nao assina');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.set_report_email(%L, %L, %L)', A, 'weekly', '{operacao}'), 'outra org nao assina em A');
  PERFORM pg_temp.run(agent_a, format('SELECT public.set_report_email(%L, %L, %L)', A, 'weekly', '{operacao,atendentes,comercial}'));
  PERFORM pg_temp.expect((SELECT kinds FROM public.report_emails WHERE organization_id = A AND user_id = agent_a) = '{atendentes}', 'atendente so recebe o que ve na tela');
  PERFORM pg_temp.run(owner_a, format('SELECT public.set_report_email(%L, %L, %L)', A, 'monthly', '{operacao,ia}'));
  PERFORM pg_temp.expect(pg_temp.q(owner_a, 'SELECT count(*) FROM public.report_emails') = 1, 'cada um ve so a propria assinatura');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.report_emails') = 0, 'outra org nao ve assinaturas de A');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, format('INSERT INTO public.report_emails (organization_id, user_id, frequency, kinds) VALUES (%L, %L, %L, %L)', A, agent2_a, 'weekly', '{operacao}')) LIKE 'err:%', 'navegador nao assina por outra pessoa');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.service_report_as(%L, %L, %L, now() - interval %L, now())', A, owner_a, 'operacao', '7 days'), 'navegador nao gera relatorio como outro');
  PERFORM pg_temp.expect(public.service_report_as(A, agent_a, 'operacao', now() - interval '7 days', now()) IS NULL, 'atendente nao recebe operacao');
  PERFORM pg_temp.expect(public.service_report_as(A, agent_a, 'atendentes', now() - interval '7 days', now()) ->> 'escopo' = 'self', 'atendente recebe so os proprios numeros');
  PERFORM pg_temp.expect(public.service_report_as(A, owner_b, 'operacao', now() - interval '7 days', now()) IS NULL, 'quem nao e de A nao recebe relatorio de A');
  PERFORM pg_temp.run(agent_a, format('SELECT public.set_report_email(%L, NULL, NULL)', A));
  PERFORM pg_temp.expect(NOT EXISTS (SELECT 1 FROM public.report_emails WHERE organization_id = A AND user_id = agent_a), 'desligar remove a assinatura');

  -- 86. API e webhooks: chave so do dono, guardada por hash; eventos so para os enderecos da propria empresa.
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.create_api_key(%L, %L, %L)', A, 'n8n', '{contacts:read}'), 'atendente nao cria chave');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.create_api_key(%L, %L, %L)', A, 'n8n', '{contacts:read}'), 'outra org nao cria chave em A');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.create_api_key(%L, %L, %L)', A, 'n8n', '{admin:all}'), 'permissao fora da lista recusada');
  PERFORM pg_temp.expect(pg_temp.t(owner_a, format('SELECT public.create_api_key(%L, %L, %L) ->> %L LIKE %L', A, 'n8n', '{contacts:read,messages:send}', 'key', 'dca_%')) = 'true', 'dono cria chave');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.api_keys') = 0, 'outra org nao ve chaves de A');
  PERFORM pg_temp.expect(pg_temp.run(owner_a, 'SELECT key_hash FROM public.api_keys LIMIT 1') LIKE 'err:%', 'navegador nao le o hash da chave');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.service_api_key_lookup(%L)', repeat('a', 64)), 'navegador nao valida chave');
  PERFORM pg_temp.expect(public.service_api_key_lookup((SELECT key_hash FROM public.api_keys WHERE organization_id = A LIMIT 1)) ->> 'organization_id' = A::text, 'servidor acha a empresa da chave');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.revoke_api_key(%L)', (SELECT id FROM public.api_keys WHERE organization_id = A LIMIT 1)), 'outra org nao revoga chave de A');
  UPDATE public.api_keys SET revoked_at = now() WHERE organization_id = A;
  PERFORM pg_temp.expect(public.service_api_key_lookup((SELECT key_hash FROM public.api_keys WHERE organization_id = A LIMIT 1)) IS NULL, 'chave revogada nao vale');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.save_webhook_endpoint(%L, NULL, %L, %L, true)', A, 'http://x.com/h', '{contact.created}'), 'webhook sem https recusado');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.save_webhook_endpoint(%L, NULL, %L, %L, true)', A, 'https://10.0.0.5/h', '{contact.created}'), 'webhook para IP interno recusado');
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.save_webhook_endpoint(%L, NULL, %L, %L, true)', A, 'https://localhost/h', '{contact.created}'), 'webhook para localhost recusado');
  PERFORM pg_temp.expect(pg_temp.t(owner_a, format('SELECT public.save_webhook_endpoint(%L, NULL, %L, %L, true) ->> %L LIKE %L', A, 'https://hooks.exemplo.com/a', '{contact.created,message.received}', 'secret', 'whsec_%')) = 'true', 'dono cadastra webhook');
  PERFORM pg_temp.expect_error(agent_a, format('SELECT public.save_webhook_endpoint(%L, NULL, %L, %L, true)', A, 'https://hooks.exemplo.com/b', '{contact.created}'), 'atendente nao cadastra webhook');
  INSERT INTO public.contacts (organization_id, name, phone) VALUES (A, 'Cliente Webhook', '5511977776666');
  PERFORM pg_temp.expect((SELECT count(*) FROM public.webhook_deliveries WHERE organization_id = A AND event = 'contact.created') = 1, 'novo contato entra na fila do webhook de A');
  INSERT INTO public.contacts (organization_id, name, phone) VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'Cliente de B', '5511977775555');
  PERFORM pg_temp.expect(NOT EXISTS (SELECT 1 FROM public.webhook_deliveries WHERE payload::text LIKE '%Cliente de B%'), 'evento de B nao vai para o webhook de A');
  PERFORM pg_temp.expect(pg_temp.q(owner_b, 'SELECT count(*) FROM public.webhook_deliveries') = 0, 'outra org nao ve as entregas de A');
  PERFORM pg_temp.expect_error(owner_a, 'SELECT * FROM public.service_webhook_claim(10)', 'navegador nao pega a fila');
  PERFORM pg_temp.expect((SELECT count(*) FROM public.service_webhook_claim(10)) >= 1, 'servidor pega a fila');
  PERFORM pg_temp.expect((SELECT count(*) FROM public.service_webhook_claim(10)) = 0, 'cada entrega so uma vez');

  -- 82. Consumo do cerebro por empresa: so o operador Clubetec.
  PERFORM pg_temp.expect_error(owner_a, format('SELECT public.platform_brain_usage(%L)', current_date), 'dono nao ve consumo das outras empresas');
  PERFORM pg_temp.expect(pg_temp.t(operator, format('SELECT jsonb_typeof(public.platform_brain_usage(%L))', current_date)) = 'array', 'operador ve o consumo');

  -- 81. Historico por area: dono e responsavel da area; outros nao.
  PERFORM pg_temp.expect(pg_temp.t(agent_a, format('SELECT jsonb_array_length(public.area_activity(%L, (SELECT id FROM public.org_areas WHERE organization_id = %L AND name = %L), NULL)) >= 1',
    A, A, 'Vendas')) = 'true', 'responsavel ve o que a area fez');
  PERFORM pg_temp.expect_error(agent2_a, format('SELECT public.area_activity(%L, (SELECT id FROM public.org_areas WHERE organization_id = %L AND name = %L), NULL)', A, A, 'Vendas'), 'outro atendente nao ve');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.area_activity(%L, (SELECT id FROM public.org_areas WHERE organization_id = %L AND name = %L), NULL)', A, A, 'Vendas'), 'outra org nao ve historico de A');
  PERFORM pg_temp.expect_error(owner_b, format('SELECT public.area_activity(%L, (SELECT id FROM public.org_areas WHERE organization_id = %L AND name = %L), NULL)', 'bbbbbbbb-0000-0000-0000-000000000001', A, 'Vendas'), 'area de A pedida em nome de B recusada');
  PERFORM pg_temp.expect(pg_temp.run(NULL, format('UPDATE public.conversations SET stage_id = (SELECT id FROM public.pipeline_stages WHERE organization_id = %L AND name = %L) WHERE id = %L',
    A, 'Qualificado', 'aaaaaaaa-0000-0000-0004-000000000001')) = 'ok:1', 'etapa da propria org aceita');

  RAISE NOTICE 'ISOLATION OK';
END $$;

ROLLBACK;
