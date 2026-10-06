/**
 * Desenho de processo do Arquiteto (desenho 07, fatia 3): o processo contado no Diagnóstico vira dado
 * estruturado, com a decisão de automação de cada passo (matriz §2.4). A saída da IA é dado: listas
 * fechadas, tamanhos máximos e travas fixas que a IA não consegue desligar:
 *  - decisão que envolve dinheiro, contrato, saúde ou assunto jurídico fica com uma pessoa;
 *  - dado sensível do cliente (LGPD art. 5º II e afins) é sempre marcado;
 *  - dado do cliente sem base legal vira risco.
 */
export type Decisao = "fluxo" | "modelo" | "ia" | "pessoa";
export type Quem = "fluxo" | "agente" | "pessoa";
export interface Passo { n: number; o_que: string; quem: Quem; quem_detalhe: string; ferramenta: string; dados: string[]; prazo: string; decisao: Decisao; motivo: string }
export interface ProcessDesign {
  gatilho: string; objetivo: string; passos: Passo[];
  excecoes: { quando: string; o_que_fazer: string }[];
  dados_cliente: { dado: string; sensivel: boolean }[];
  base_legal: string; sla: string; indicadores: string[]; riscos: string[]; dono_do_processo: string;
}

const DECISOES = new Set<Decisao>(["fluxo", "modelo", "ia", "pessoa"]);
const QUEM_DE: Record<Decisao, Quem> = { fluxo: "fluxo", modelo: "fluxo", ia: "agente", pessoa: "pessoa" };
const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
const list = (v: unknown) => (Array.isArray(v) ? v : []);

// Decisões que nunca saem de uma pessoa (a IA pode preparar o resumo).
const SO_PESSOA = /(desconto|reembols|estorn|negocia|contrat|jur[ií]dic|advog|processo judicial|m[eé]dic|sa[uú]de|diagn[oó]stico m|cancelament|multa|cr[eé]dito|isen[çc][ãa]o|dados? de cart[ãa]o|senha)/i;
const SENSIVEL = /(cpf|\brg\b|documento|sa[uú]de|doen[çc]a|religi|biom|digital|cart[ãa]o|senha|conta banc|renda|sal[áa]rio|filia[çc][ãa]o|sindic|sexual|ra[çc]a|etnia|crian[çc]a|menor de idade|antecedente)/i;

export function parseDesign(raw: unknown, metricKeys: string[]): ProcessDesign | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const passos: Passo[] = [];
  for (const x of list(o.passos)) {
    if (passos.length >= 20) break;
    const p = (x ?? {}) as Record<string, unknown>;
    const oQue = clip(p.o_que, 300);
    if (!oQue) continue;
    let decisao = (DECISOES.has(String(p.decisao) as Decisao) ? String(p.decisao) : "pessoa") as Decisao;
    let motivo = clip(p.motivo, 300);
    if (decisao !== "pessoa" && SO_PESSOA.test(oQue)) {
      decisao = "pessoa";
      motivo = "Regra fixa: decisão que envolve dinheiro, contrato, saúde ou assunto jurídico fica com uma pessoa (a IA pode preparar o resumo).";
    }
    passos.push({
      n: passos.length + 1, o_que: oQue, quem: QUEM_DE[decisao], quem_detalhe: clip(p.quem_detalhe, 120),
      ferramenta: clip(p.ferramenta, 120), dados: list(p.dados).map((d) => clip(d, 80)).filter(Boolean).slice(0, 10),
      prazo: clip(p.prazo, 80), decisao, motivo,
    });
  }
  if (!passos.length) return null;
  const dados_cliente = list(o.dados_cliente).map((x) => {
    const d = (x ?? {}) as Record<string, unknown>;
    const dado = clip(d.dado, 80);
    return { dado, sensivel: d.sensivel === true || SENSIVEL.test(dado) };
  }).filter((d) => d.dado).slice(0, 20);
  const base_legal = clip(o.base_legal, 300);
  const riscos = list(o.riscos).map((r) => clip(r, 300)).filter(Boolean).slice(0, 8);
  if (dados_cliente.length && !base_legal) riscos.push("Falta a base legal (LGPD) para usar os dados do cliente neste processo.");
  const metrics = new Set(metricKeys);
  return {
    gatilho: clip(o.gatilho, 300), objetivo: clip(o.objetivo, 300), passos,
    excecoes: list(o.excecoes).map((x) => {
      const e = (x ?? {}) as Record<string, unknown>;
      return { quando: clip(e.quando, 200), o_que_fazer: clip(e.o_que_fazer, 300) };
    }).filter((e) => e.quando && e.o_que_fazer).slice(0, 10),
    dados_cliente, base_legal, sla: clip(o.sla, 120),
    indicadores: list(o.indicadores).map(String).filter((k) => metrics.has(k)).slice(0, 5),
    riscos, dono_do_processo: clip(o.dono_do_processo, 120),
  };
}

/** Indicadores que o cérebro sabe medir (mesma lista de private.area_metric_keys no banco). */
export const METRIC_KEYS = [
  "atendimentos", "fila_min", "resposta_min", "satisfeitos_pct", "nota_media", "resolvidos_ia_pct", "fila_30min",
  "leads_novos", "clientes_novos", "conversao_pct", "leads_sem_origem_pct",
  "valor_emitido", "valor_recebido", "valor_em_atraso", "cobrancas_em_atraso",
  "novos_contatos", "campanha_enviados", "fora_da_lista",
  "fluxo_execucoes", "fluxo_concluidas_pct", "fluxo_erros", "numeros_com_problema",
  "registros_criados", "processos_implantados", "melhorias_paradas",
  "equipe_ativa", "nota_media_equipe", "atendimentos_por_pessoa_media",
];
