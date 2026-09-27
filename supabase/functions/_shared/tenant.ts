/**
 * Acesso às tabelas de organização com service_role.
 *
 * O service_role ignora a RLS. Por isso toda leitura e escrita de tabela de
 * organização feita pelas funções passa por aqui, com organization_id
 * injetado — é a principal defesa contra vazamento entre clientes (spec §8.1).
 * Fora deste arquivo, só é aceito acessar por `id` um registro cuja
 * organização já foi conferida.
 */
type Row = Record<string, unknown>;
// Aceita o client de qualquer origem (npm:/esm.sh). As colunas são dinâmicas,
// então os builders saem como `any` de propósito.
// deno-lint-ignore no-explicit-any
type AnyClient = { from: (table: string) => any };

// deno-lint-ignore no-explicit-any
export function forOrg(admin: AnyClient, orgId: string): Record<string, any> & { orgId: string } {
  if (!orgId) throw new Error("forOrg: organização obrigatória");
  return {
    orgId,
    select(table: string, columns = "*") {
      return admin.from(table).select(columns).eq("organization_id", orgId);
    },
    insert(table: string, rows: Row | Row[]) {
      const withOrg = Array.isArray(rows)
        ? rows.map((r) => ({ ...r, organization_id: orgId }))
        : { ...rows, organization_id: orgId };
      return admin.from(table).insert(withOrg);
    },
    update(table: string, patch: Row) {
      const { organization_id: _ignored, ...rest } = patch;
      return admin.from(table).update(rest).eq("organization_id", orgId);
    },
    delete(table: string) {
      return admin.from(table).delete().eq("organization_id", orgId);
    },
  };
}

export type OrgScope = ReturnType<typeof forOrg>;
