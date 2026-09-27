import { createContext } from "react";

/** O que o canvas mostra por cima dos blocos: contagens e bloco do simulador. */
export interface Overlay {
  stats: Record<string, Record<string, number>> | null;
  active: string | null;
}
export const OverlayContext = createContext<Overlay>({ stats: null, active: null });
