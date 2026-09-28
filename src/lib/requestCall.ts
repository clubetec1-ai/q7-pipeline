/**
 * Pede ao telefone do ramal (PhoneWidget) para ligar. Sem ramal ativo, abre o
 * programa padrão do sistema pelo link tel:.
 */
export function requestCall(phone: string) {
  const ev = new CustomEvent("clubecrm:call", { detail: { phone, handled: false } });
  window.dispatchEvent(ev);
  if (!ev.detail.handled) window.location.href = `tel:${phone.replace(/[^\d+]/g, "")}`;
}
