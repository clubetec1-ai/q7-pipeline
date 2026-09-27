import { useOrg } from "@/contexts/OrgContext";

/**
 * Compatibilidade com as telas antigas: "admin" passou a ser quem tem
 * org.settings na organização ativa; a configuração global da Uazapi é só do
 * operador da plataforma. Controle de verdade é a RLS.
 */
export const useAdminRole = () => {
  const { can, isOperator, loading } = useOrg();
  return { isAdmin: can("org.settings"), isOperator, loading };
};
