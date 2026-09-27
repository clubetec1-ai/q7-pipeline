-- =============================================================================
-- Correção: o Supabase dá ALL em tabelas novas para authenticated (default
-- privileges). Nas tabelas abaixo o navegador só pode gravar as colunas de
-- configuração — estado interno (senha configurada, sincronização, saúde,
-- caminho do arquivo) é só do backend. Achado pelo teste de isolamento (caso 32).
-- Idempotente.
-- =============================================================================

REVOKE INSERT, UPDATE ON public.email_accounts FROM authenticated;
GRANT INSERT (id, organization_id, name, address, username, imap_host, imap_port, smtp_host, smtp_port,
              department_id, signature, status) ON public.email_accounts TO authenticated;
GRANT UPDATE (name, address, username, imap_host, imap_port, smtp_host, smtp_port, department_id, signature, status)
  ON public.email_accounts TO authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.email_accounts FROM authenticated;

REVOKE INSERT, UPDATE ON public.library_files FROM authenticated;
GRANT INSERT (id, organization_id, name, description, media_path, mime, size, created_by) ON public.library_files TO authenticated;
GRANT UPDATE (name, description) ON public.library_files TO authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.library_files FROM authenticated;
