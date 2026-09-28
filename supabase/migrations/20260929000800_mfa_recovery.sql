-- =============================================================================
-- Códigos de recuperação do MFA
--  * 10 códigos de uso único por pessoa; só o hash (sha256 com o id da pessoa)
--    fica guardado. Gerar de novo invalida os anteriores.
--  * Tabela só do backend (mfa-recovery): o navegador vê apenas quantos restam.
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.mfa_recovery_codes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, code_hash)
);
ALTER TABLE public.mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mfa_recovery_codes FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.my_recovery_codes_left()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT count(*)::integer FROM public.mfa_recovery_codes
  WHERE user_id = (SELECT auth.uid()) AND used_at IS NULL
$$;
REVOKE ALL ON FUNCTION public.my_recovery_codes_left() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_recovery_codes_left() TO authenticated;
