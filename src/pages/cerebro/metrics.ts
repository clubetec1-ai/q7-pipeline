/** Rótulos do catálogo de indicadores do cérebro (o cálculo é no banco: private.area_metric_values). */
export interface MetricInfo { label: string; unit?: "%" | "min" | "R$"; better: "up" | "down" }

export const METRICS: Record<string, MetricInfo> = {
  atendimentos: { label: "Atendimentos", better: "up" },
  fila_min: { label: "Espera na fila", unit: "min", better: "down" },
  resposta_min: { label: "1ª resposta", unit: "min", better: "down" },
  satisfeitos_pct: { label: "Clientes satisfeitos", unit: "%", better: "up" },
  nota_media: { label: "Nota média", better: "up" },
  resolvidos_ia_pct: { label: "Resolvidos pela IA", unit: "%", better: "up" },
  fila_30min: { label: "Na fila há +30 min (agora)", better: "down" },
  leads_novos: { label: "Leads novos", better: "up" },
  clientes_novos: { label: "Viraram cliente", better: "up" },
  conversao_pct: { label: "Conversão", unit: "%", better: "up" },
  leads_sem_origem_pct: { label: "Leads sem origem", unit: "%", better: "down" },
  valor_emitido: { label: "Cobranças emitidas", unit: "R$", better: "up" },
  valor_recebido: { label: "Recebido", unit: "R$", better: "up" },
  valor_em_atraso: { label: "Em atraso (agora)", unit: "R$", better: "down" },
  cobrancas_em_atraso: { label: "Cobranças em atraso", better: "down" },
  novos_contatos: { label: "Contatos novos", better: "up" },
  campanha_enviados: { label: "Mensagens de campanha", better: "up" },
  fora_da_lista: { label: "Pediram para sair", better: "down" },
  fluxo_execucoes: { label: "Execuções de fluxos", better: "up" },
  fluxo_concluidas_pct: { label: "Fluxos concluídos", unit: "%", better: "up" },
  fluxo_erros: { label: "Erros em fluxos", better: "down" },
  numeros_com_problema: { label: "Números com problema", better: "down" },
  registros_criados: { label: "Registros criados", better: "up" },
  processos_implantados: { label: "Processos implantados", better: "up" },
  melhorias_paradas: { label: "Melhorias paradas", better: "down" },
  equipe_ativa: { label: "Pessoas na equipe", better: "up" },
  nota_media_equipe: { label: "Nota média da equipe", better: "up" },
  atendimentos_por_pessoa_media: { label: "Atendimentos por pessoa", better: "up" },
};

export const AREA_METRICS: Record<string, string[]> = {
  vendas: ["leads_novos", "clientes_novos", "conversao_pct", "leads_sem_origem_pct"],
  financeiro: ["valor_emitido", "valor_recebido", "valor_em_atraso", "cobrancas_em_atraso"],
  marketing: ["novos_contatos", "campanha_enviados", "leads_sem_origem_pct", "fora_da_lista"],
  operacao: ["fluxo_execucoes", "fluxo_concluidas_pct", "fluxo_erros", "numeros_com_problema"],
  administrativo: ["registros_criados", "processos_implantados", "melhorias_paradas"],
  rh: ["equipe_ativa", "nota_media_equipe", "atendimentos_por_pessoa_media"],
};
export const metricsOf = (areaKey: string) =>
  AREA_METRICS[areaKey] ?? ["atendimentos", "fila_min", "resposta_min", "satisfeitos_pct", "nota_media", "resolvidos_ia_pct", "fila_30min"];

export function fmt(key: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const u = METRICS[key]?.unit;
  if (u === "R$") return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const s = n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  return u === "%" ? `${s}%` : u === "min" ? `${s} min` : s;
}

export const LIGHT: Record<string, [string, string]> = {
  no_rumo: ["No rumo", "bg-success-soft text-success-text"],
  atencao: ["Atenção", "bg-warning-soft text-warning-text"],
  fora: ["Fora do rumo", "bg-danger-soft text-danger-text"],
  sem_dados: ["Sem dados ainda", "bg-muted text-muted-foreground"],
};
