import type { ReactNode } from "react";

/** Um momento do "vídeo": o estado da miniatura da tela, onde o cursor clica e a legenda. */
export interface Scene { state: string; target?: string; caption: string; ms?: number }

export interface GuideStep {
  title: string;
  body: ReactNode;
  /** Demonstração animada deste passo (usa o `mock` do guia). */
  demo?: Scene[];
  /** Vídeo gravado (mp4/webm). Quando existir, aparece no lugar da demonstração. */
  video?: string;
}

/** Passo a passo de uma tela: abre sozinho na 1ª visita e fica no botão de ajuda. */
export interface Guide {
  id: string;
  title: string;
  /** Telas onde o guia vale (caminho exato). */
  routes: string[];
  steps: GuideStep[];
  /** Miniatura da tela usada nas demonstrações. */
  mock?: (state: string) => ReactNode;
  autoOpen?: boolean;
}

const KEY = (id: string) => `clubecrm:guia:${id}`;
export const guideSeen = (id: string) => {
  try { return localStorage.getItem(KEY(id)) === "1" || (id === "diagnostico" && localStorage.getItem("clubecrm:diag-guia-visto") === "1"); }
  catch { return true; }
};
export const markGuideSeen = (id: string) => { try { localStorage.setItem(KEY(id), "1"); } catch { /* só deste navegador */ } };

/** Abre um guia de qualquer lugar (botão de ajuda, "Como funciona"...). */
export const openGuide = (id: string) => window.dispatchEvent(new CustomEvent("guide:open", { detail: id }));
