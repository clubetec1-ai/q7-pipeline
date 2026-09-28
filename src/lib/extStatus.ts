/**
 * Situação do ramal para a tela (Plataforma e Equipe). O telefone do navegador
 * manda um sinal a cada 2 min enquanto está registrado na central; sem sinal há
 * mais de 5 min, o ramal aparece como desconectado. MicroSIP/aparelho não é
 * monitorado pelo navegador.
 */
export interface ExtStatusRow { mode: string; wss_url: string | null; has_password: boolean; user_id: string | null; reg_state: string | null; reg_detail: string | null; reg_at: string | null }
export interface ExtStatus { dot: string; label: string; hint?: string }

const ago = (d: string) => {
  const min = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (min < 60) return `há ${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `há ${h} h` : `em ${new Date(d).toLocaleDateString("pt-BR")}`;
};

export function extStatus(e: ExtStatusRow): ExtStatus {
  if (!e.has_password) return { dot: "bg-amber-400", label: "Falta a senha", hint: "Clubetec: edite o ramal e informe a senha." };
  if (!e.user_id) return { dot: "bg-muted-foreground", label: "Sem atendente", hint: "O dono escolhe o atendente em Configurar → Ramais." };
  if (e.mode === "off") return { dot: "bg-muted-foreground", label: "Desligado pelo atendente" };
  if (e.mode === "sip" || !e.wss_url) return { dot: "bg-sky-500", label: "MicroSIP / aparelho", hint: "Funciona fora do navegador; o ClubeCRM não enxerga se está conectado." };
  const fresh = e.reg_at && Date.now() - new Date(e.reg_at).getTime() < 5 * 60_000;
  if (e.reg_state === "online" && fresh) return { dot: "bg-emerald-500", label: "Online", hint: `Registrado na central (sinal ${ago(e.reg_at!)})` };
  if (e.reg_state === "error" && fresh) return { dot: "bg-red-500", label: "Com erro", hint: e.reg_detail ?? "A central recusou" };
  if (!e.reg_at) return { dot: "bg-muted-foreground", label: "Nunca conectou", hint: "Aparece online quando o atendente abrir o ClubeCRM." };
  return { dot: "bg-muted-foreground", label: "Desconectado", hint: `Último sinal ${ago(e.reg_at)}${e.reg_state === "error" && e.reg_detail ? ` · ${e.reg_detail}` : ""}` };
}
