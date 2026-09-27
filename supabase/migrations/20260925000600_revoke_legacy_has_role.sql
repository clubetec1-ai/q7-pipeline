-- has_role (papéis globais antigos) deixou de ser usado por policies e pelo
-- frontend. Exposto via /rest/v1/rpc, deixava qualquer usuário logado
-- perguntar o papel de outro usuário. Fica só para o service_role.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
