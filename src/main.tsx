import { createRoot } from "react-dom/client";
import "./index.css";
import { isConfigured, envProblems } from "@/lib/env";
import SetupRequired from "@/pages/SetupRequired";
import { AppErrorBoundary, reloadOnceForNewVersion } from "@/components/AppErrorBoundary";

function Broken(): JSX.Element { throw new Error("Failed to fetch dynamically imported module"); }

const root = createRoot(document.getElementById("root")!);

// Sem as variáveis do Supabase o app não tem como funcionar. Em vez de quebrar
// com tela branca, mostramos exatamente o que está faltando.
if (!isConfigured) {
  console.error(
    "[Deixa com a IA] Configuração do Supabase ausente ou inválida:",
    envProblems.map((p) => `${p.variable}: ${p.message}`).join(" | ")
  );
  root.render(<SetupRequired problems={envProblems} />);
} else {
  // Import dinâmico: o App puxa o client do Supabase, que não deve ser
  // carregado enquanto a configuração estiver inválida.
  // Versão nova publicada com a aba aberta: o pedaço antigo some do servidor → recarrega uma vez (sem tela branca).
  window.addEventListener("vite:preloadError", (e) => { e.preventDefault(); reloadOnceForNewVersion(); });
  import("./App.tsx")
    .then(({ default: App }) => root.render(<AppErrorBoundary><App /></AppErrorBoundary>))
    .catch(() => { if (!reloadOnceForNewVersion()) root.render(<AppErrorBoundary><Broken /></AppErrorBoundary>); });
}
