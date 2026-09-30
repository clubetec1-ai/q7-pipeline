import { HttpError } from "./auth.ts";

/** Módulos por empresa (org_modules). A base "Atendimento" não tem módulo: sempre ativa. */
export type Module = "diagnostico" | "ia" | "canais" | "telefonia" | "campanhas" | "cobrancas" | "gestao";
export const MODULE_LABEL: Record<Module, string> = {
  diagnostico: "Diagnóstico e Plano", ia: "Agentes de IA e Automação", canais: "Canais extras", telefonia: "Telefonia",
  campanhas: "Campanhas e Marca", cobrancas: "Cobranças", gestao: "Qualidade e Gestão",
};

// deno-lint-ignore no-explicit-any
export async function moduleOn(admin: any, orgId: string, m: Module): Promise<boolean> {
  const { data, error } = await admin.rpc("service_module_on", { org: orgId, m });
  if (error) { console.error("[modules] leitura falhou", { m, code: error.code }); return false; }
  return data === true;
}

/** Recusa (403) quando o módulo não está ativo para a empresa. */
// deno-lint-ignore no-explicit-any
export async function requireModule(admin: any, orgId: string, m: Module) {
  if (!(await moduleOn(admin, orgId, m))) {
    throw new HttpError(403, `O módulo "${MODULE_LABEL[m]}" não está ativo para a sua empresa. Fale com a Clubetec para ativar.`);
  }
}
