import { useSyncExternalStore } from "react";

/**
 * Ligação entre o telefone (PhoneWidget, montado uma vez no App) e o botão 📞 do
 * cabeçalho: o telefone publica se existe ramal e a situação; o botão pede para
 * abrir/fechar o painel.
 */
export interface PhoneState { available: boolean; dot: string; status: string; ringing: boolean }
let state: PhoneState = { available: false, dot: "", status: "", ringing: false };
const listeners = new Set<() => void>();

export function setPhoneState(next: PhoneState) {
  if (next.available === state.available && next.dot === state.dot && next.status === state.status && next.ringing === state.ringing) return;
  state = next;
  listeners.forEach((l) => l());
}
export function togglePhonePanel() {
  window.dispatchEvent(new Event("clubecrm:phone-toggle"));
}
export function usePhoneState() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state);
}
