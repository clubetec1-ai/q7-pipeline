import { Component, type ReactNode } from "react";

/**
 * Nunca mais tela branca (relato do dono, 07/10: "Organizar com IA" → tela branca até o F5).
 *  - Versão nova do site publicada com a aba aberta: falta um pedaço da versão antiga → recarrega UMA vez sozinho.
 *  - Qualquer outro erro ao montar a tela: mensagem clara com "Recarregar" e "Voltar ao início" (os dados já salvos ficam).
 */
const RELOAD_KEY = "clubecrm:recarregou-versao";
export const isStaleBundle = (msg: string) =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk/i.test(msg);

export function reloadOnceForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 60_000) return false; // já recarregou há pouco: não entra em laço
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch { /* sem sessionStorage: recarrega mesmo assim */ }
  window.location.reload();
  return true;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) {
    console.error("[Deixa com a IA] erro na tela", error);
    if (isStaleBundle(String(error?.message ?? ""))) reloadOnceForNewVersion();
  }
  render() {
    if (!this.state.error) return this.props.children;
    const stale = isStaleBundle(String(this.state.error.message ?? ""));
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md rounded-xl border bg-card p-6 text-center space-y-3">
          <p className="font-brand text-xl">{stale ? "O sistema foi atualizado" : "Algo deu errado nesta tela"}</p>
          <p className="text-sm text-muted-foreground">
            {stale
              ? "Saiu uma versão nova enquanto a página estava aberta. Recarregue para continuar — o que você já salvou continua lá."
              : "O que você já salvou continua guardado. Recarregue a página; se o erro voltar, use o ? no topo para pedir ajuda ao suporte."}
          </p>
          <div className="flex justify-center gap-2">
            <button type="button" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={() => window.location.reload()}>Recarregar a página</button>
            <button type="button" className="rounded-md border px-4 py-2 text-sm" onClick={() => { window.location.href = "/"; }}>Voltar ao início</button>
          </div>
        </div>
      </div>
    );
  }
}
