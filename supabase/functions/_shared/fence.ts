/**
 * Cerca dos dados nos prompts: o texto de dentro (do dono, do cliente, de documento ou de outra IA) não consegue
 * fechar o bloco <dados> nem abrir outro — assim nenhuma instrução escrita ali sai da cerca.
 */
export const fence = (v: unknown): string => String(v ?? "").replace(/<(\s*\/?\s*dados)/gi, "‹$1");
