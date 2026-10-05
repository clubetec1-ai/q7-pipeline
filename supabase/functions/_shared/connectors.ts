/**
 * Conectores prontos: login OAuth por organização + "receitas" (várias
 * chamadas encadeadas) descritas como DADOS — corrigir um parâmetro de API é
 * mudar a receita, não o código. Tokens no Vault (conn:<org>:<conector>:*),
 * renovados sozinhos; aplicativo da plataforma em platform:<conector>:client_*.
 */
import { getSecret, putSecret } from "./secrets.ts";
import { forOrg } from "./tenant.ts";
import { checkUrl } from "./flow/http.ts";
import { pickPath } from "./flow/engine.ts";
import { book, freeSlots } from "./gcal.ts";

export interface Step {
  /** Caminho relativo à API; aceita {telefone}, {telefone_local}, {var.x} (codificados na URL). */
  path: string;
  /** Lista na resposta e como achar o item: telefone do cliente (fim do número) ou o primeiro. */
  list?: string;
  match?: { phoneFields: string[] } | "first";
  /** Campos do item escolhido (ou da resposta) → variáveis para os próximos passos e para a mensagem. */
  pick: Record<string, string>;
}
export interface ActionInput { phone: string; name?: string | null; vars: Record<string, string> }
export interface Action {
  label: string; description: string; outputs: Record<string, string>;
  /** Receita de consultas (GET) — ou, quando a API pede mais que isso, uma ação em código. */
  steps?: Step[];
  run?: (token: string, input: ActionInput) => Promise<ActionResult>;
}
export interface Connector {
  name: string; beta?: boolean; description: string;
  oauth: { authorize: string; token: string; basicAuth: boolean; scope?: string; extraAuth?: Record<string, string> };
  api: string;
  actions: Record<string, Action>;
}

export const CONNECTORS: Record<string, Connector> = {
  google_agenda: {
    name: "Google Agenda", description: "Horários livres e agendamento na agenda do Google de quem conectar.",
    oauth: {
      authorize: "https://accounts.google.com/o/oauth2/v2/auth",
      token: "https://oauth2.googleapis.com/token",
      basicAuth: false,
      // Só eventos e livre/ocupado: não lê nem apaga e-mails, contatos ou outras agendas.
      scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy",
      extraAuth: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    },
    api: "https://www.googleapis.com/calendar/v3",
    actions: {
      horarios_livres: {
        label: "Horários livres",
        description: "Próximos horários livres em dias úteis (padrão: 6 horários de 1 h, das 9h às 18h, nos próximos 7 dias). Ajuste com as variáveis duracao_min, inicio_h, fim_h, dias e quantos.",
        outputs: { horarios: "Lista para mostrar ao cliente", horarios_iso: "Lista técnica (usada pelo Agendar)" },
        run: (token, input) => freeSlots(token, input),
      },
      agendar: {
        label: "Agendar",
        description: "Marca o horário que o cliente escolheu (o número da lista dos horários livres, ou dd/mm hh:mm), se ainda estiver livre. Use a variável horario com a resposta do cliente.",
        outputs: { evento_inicio: "Dia e hora marcados", evento_link: "Link do compromisso (para a equipe)" },
        run: (token, input) => book(token, input),
      },
    },
  },
  bling: {
    name: "Bling", beta: true, description: "ERP: pedidos, contatos e situações (API v3).",
    oauth: {
      authorize: "https://www.bling.com.br/Api/v3/oauth/authorize",
      token: "https://www.bling.com.br/Api/v3/oauth/token",
      basicAuth: true,
    },
    api: "https://api.bling.com.br/Api/v3",
    actions: {
      ultimo_pedido: {
        label: "Último pedido pelo telefone do cliente",
        description: "Acha o cliente no Bling pelo telefone do WhatsApp e traz o último pedido de venda e a situação.",
        outputs: { pedido_numero: "Número do pedido", pedido_data: "Data", pedido_total: "Total", pedido_situacao: "Situação" },
        steps: [
          { path: "/contatos?pesquisa={telefone_local}&limite=100", list: "data",
            match: { phoneFields: ["telefone", "celular"] }, pick: { contato_id: "id", contato_nome: "nome" } },
          { path: "/pedidos/vendas?idContato={var.contato_id}&limite=1", list: "data", match: "first",
            pick: { pedido_numero: "numero", pedido_data: "data", pedido_total: "total", situacao_id: "situacao.id" } },
          { path: "/situacoes/{var.situacao_id}", pick: { pedido_situacao: "data.nome" } },
        ],
      },
    },
  },
};

// deno-lint-ignore no-explicit-any
type Admin = any;

export async function appCredentials(admin: Admin, key: string) {
  const [id, secret] = await Promise.all([getSecret(admin, `platform:${key}:client_id`), getSecret(admin, `platform:${key}:client_secret`)]);
  return id && secret ? { id, secret } : null;
}

/** Troca de código/refresh por tokens e guarda no Vault. */
export async function tokenRequest(admin: Admin, orgId: string, key: string, params: Record<string, string>): Promise<{ ok: boolean; error?: string }> {
  const c = CONNECTORS[key];
  const app = await appCredentials(admin, key);
  if (!c || !app) return { ok: false, error: "aplicativo do conector não configurado pela plataforma" };
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  const body = new URLSearchParams(params);
  if (c.oauth.basicAuth) headers.Authorization = `Basic ${btoa(`${app.id}:${app.secret}`)}`;
  else { body.set("client_id", app.id); body.set("client_secret", app.secret); }
  try {
    const res = await fetch(c.oauth.token, { method: "POST", headers, body, signal: AbortSignal.timeout(15_000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.access_token) return { ok: false, error: `login recusado (HTTP ${res.status})` };
    await putSecret(admin, `conn:${orgId}:${key}:access`, String(data.access_token));
    if (data.refresh_token) await putSecret(admin, `conn:${orgId}:${key}:refresh`, String(data.refresh_token));
    const exp = new Date(Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60_000).toISOString();
    await admin.from("org_connections").upsert({ organization_id: orgId, connector: key, status: "connected", error: null, token_expires_at: exp },
      { onConflict: "organization_id,connector" });
    return { ok: true };
  } catch {
    return { ok: false, error: "não consegui falar com o sistema" };
  }
}

/** Token válido (renova se estiver vencendo). null = precisa conectar de novo. */
async function accessToken(admin: Admin, orgId: string, key: string): Promise<string | null> {
  const { data: conn } = await forOrg(admin, orgId).select("org_connections", "status, token_expires_at").eq("connector", key).maybeSingle();
  if (!conn || conn.status === "disconnected") return null;
  if (conn.token_expires_at && new Date(conn.token_expires_at).getTime() < Date.now()) {
    const refresh = await getSecret(admin, `conn:${orgId}:${key}:refresh`);
    const r = refresh ? await tokenRequest(admin, orgId, key, { grant_type: "refresh_token", refresh_token: refresh }) : { ok: false, error: "sem refresh" };
    if (!r.ok) {
      await forOrg(admin, orgId).update("org_connections", { status: "error", error: "Conexão expirou: conecte de novo." }).eq("connector", key);
      return null;
    }
    return await getSecret(admin, `conn:${orgId}:${key}:access`); // putSecret já limpou o cache
  }
  return await getSecret(admin, `conn:${orgId}:${key}:access`);
}

export interface ActionResult { ok: boolean; vars?: Record<string, string>; error?: string }

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/** Executa uma ação (receita) do conector para o telefone do cliente. */
export async function runConnectorAction(admin: Admin, orgId: string, key: string, actionKey: string, input: ActionInput): Promise<ActionResult> {
  const c = CONNECTORS[key];
  const action = c?.actions[actionKey];
  if (!c || !action) return { ok: false, error: "ação desconhecida" };
  const token = await accessToken(admin, orgId, key);
  if (!token) return { ok: false, error: `${c.name} não conectado` };
  if (action.run) return await action.run(token, input);
  const phone = digits(input.phone);
  const local = phone.replace(/^55(?=\d{10,11}$)/, "");
  const tail = phone.slice(-8);
  const vars: Record<string, string> = { ...input.vars };

  for (const step of action.steps ?? []) {
    const path = step.path
      .replace(/\{telefone_local\}/g, encodeURIComponent(local))
      .replace(/\{telefone\}/g, encodeURIComponent(phone))
      .replace(/\{var\.([a-z0-9_]{1,40})\}/g, (_, k) => encodeURIComponent(vars[k] ?? ""));
    const url = `${c.api}${path}`;
    if (checkUrl(url).error) return { ok: false, error: "endereço do conector inválido" };
    let data: unknown;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(10_000) });
      if (res.status === 401) {
        await forOrg(admin, orgId).update("org_connections", { status: "error", error: "Acesso recusado: conecte de novo." }).eq("connector", key);
        return { ok: false, error: `${c.name} recusou o acesso` };
      }
      if (!res.ok) return { ok: false, error: `${c.name} respondeu HTTP ${res.status}` };
      const text = await res.text();
      if (text.length > 512 * 1024) return { ok: false, error: "resposta grande demais" };
      data = text ? JSON.parse(text) : null;
    } catch {
      return { ok: false, error: `não consegui falar com o ${c.name}` };
    }
    let item: unknown = data;
    if (step.list) {
      const arr = pickPath(data, step.list);
      const list = Array.isArray(arr) ? arr : [];
      item = step.match === "first" || !step.match ? list[0]
        : list.find((x) => step.match && step.match !== "first" && step.match.phoneFields.some((f) => tail.length === 8 && digits(pickPath(x, f)).endsWith(tail)));
      if (!item) return { ok: false, error: "não encontrado" };
    }
    for (const [name, p] of Object.entries(step.pick)) {
      const v = pickPath(item, p);
      if (v !== undefined && v !== null) vars[name] = (typeof v === "object" ? JSON.stringify(v) : String(v)).slice(0, 500);
    }
  }
  const out: Record<string, string> = {};
  for (const k of Object.keys(action.outputs)) if (vars[k] !== undefined) out[k] = vars[k];
  return { ok: true, vars: out };
}
