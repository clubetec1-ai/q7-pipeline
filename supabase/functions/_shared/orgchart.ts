/**
 * Organograma de IA (desenho 07, fatia 4): o cérebro monta o time de agentes da empresa POR REGRA,
 * sem IA — a partir de setores, áreas, tamanho da equipe e processos aprovados. Nada é inventado:
 * cada especialista nasce de um processo aprovado e cada executor de um setor com passo automatizável.
 * Empresa pequena (até 5 pessoas e até 2 setores) junta os níveis: sem diretores nem coordenadores.
 * O crachá de cada agente só usa itens do catálogo; só o executor vê a conversa e fala com o cliente.
 */
export type Level = "cerebro" | "diretor" | "coordenador" | "especialista" | "executor" | "apoio";
export type Autonomia = "A0" | "A1" | "A2" | "A3" | "A4";
export interface Cracha { dados: string[]; acoes: string[] }
export interface Agent {
  key: string; level: Level; parent: string | null; papel: string;
  department_id: string | null; process_id: string | null; area_key: string | null;
  cracha: Cracha; autonomia: Autonomia;
}

/** Itens que só o executor pode ter (o mesmo catálogo é conferido no banco). */
export const EXECUTOR_ONLY = new Set(["conversa_em_andamento", "responder_cliente", "passar_para_pessoa", "enviar_modelo", "agendar"]);

const DIRETORES: Record<string, string> = {
  comercial: "Diretor Comercial e de Marketing (IA)",
  atendimento: "Diretor de Atendimento e Pós-venda (IA)",
  financeiro: "Diretor Financeiro (IA)",
  pessoas: "Diretor de Pessoas (IA)",
  administrativo: "Diretor Administrativo e de Conformidade (IA)",
  tecnologia: "Diretor de Tecnologia e Dados (IA)",
  operacoes: "Diretor de Operações (IA)",
};
// Área do cérebro (org_areas.key) → diretoria.
const AREA_DIR: Record<string, string> = {
  vendas: "comercial", marketing: "comercial", atendimento: "atendimento", pos_venda: "atendimento",
  financeiro: "financeiro", rh: "pessoas", administrativo: "administrativo", operacao: "operacoes", outra: "operacoes",
};
// Sem área cadastrada: pelo nome do setor.
const byName = (n: string) => {
  const s = n.toLowerCase();
  if (/vend|comerc|market|loja|neg[oó]cio/.test(s)) return "comercial";
  if (/atend|suporte|sac|p[oó]s|relacionamento|recep/.test(s)) return "atendimento";
  if (/financ|cobran|fatur|contas|tesour/.test(s)) return "financeiro";
  if (/\brh\b|pessoas|recursos humanos|departamento pessoal/.test(s)) return "pessoas";
  if (/\bti\b|tecnolog|sistema|dados|desenvolv/.test(s)) return "tecnologia";
  if (/adm|jur[ií]d|compliance|qualidade|cart[oó]rio|registro/.test(s)) return "administrativo";
  return "operacoes";
};

const APOIO: [string, string, Cracha, Autonomia][] = [
  ["apoio:analista_diagnostico", "Analista de Diagnóstico (IA)", { dados: ["diagnostico", "base_conhecimento"], acoes: ["pedir_informacao"] }, "A1"],
  ["apoio:revisor", "Revisor de área (IA)", { dados: ["diagnostico", "processos"], acoes: ["revisar"] }, "A1"],
  ["apoio:arquiteto", "Arquiteto de processos (IA)", { dados: ["diagnostico", "processos"], acoes: ["propor_melhoria"] }, "A1"],
  ["apoio:implementador", "Implementador (IA)", { dados: ["processos"], acoes: ["preparar_rascunho"] }, "A2"],
  ["apoio:guardiao", "Guardião de segurança e LGPD (IA)", { dados: ["processos", "diagnostico"], acoes: ["revisar"] }, "A1"],
  ["apoio:auditor", "Auditor de qualidade (IA)", { dados: ["avaliacoes_anonimas", "numeros_agregados"], acoes: ["revisar"] }, "A1"],
  ["apoio:analista_dados", "Analista de dados (IA)", { dados: ["numeros_agregados"], acoes: [] }, "A0"],
];

interface Input {
  members: number;
  departments: { id: string; name: string }[];
  areas: { key: string; department_id: string | null }[];
  processes: { id: string; setor: string; nome: string; status: string; design: { passos?: { decisao?: string }[] } }[];
}

export function buildOrgChart(inp: Input): Agent[] {
  const small = inp.members <= 5 && inp.departments.length <= 2;
  const out: Agent[] = [];
  const add = (a: Omit<Agent, "department_id" | "process_id" | "area_key"> & Partial<Agent>) =>
    out.push({ department_id: null, process_id: null, area_key: null, ...a });

  add({ key: "cerebro", level: "cerebro", parent: null, papel: "Cérebro — visão de CEO (IA)",
    cracha: { dados: ["numeros_agregados", "diagnostico", "processos"], acoes: ["delegar", "cobrar", "propor_melhoria"] }, autonomia: "A1" });

  const dirOfDept = new Map<string, string>();
  for (const d of inp.departments) {
    const area = inp.areas.find((a) => a.department_id === d.id);
    dirOfDept.set(d.id, area ? (AREA_DIR[area.key] ?? "operacoes") : byName(d.name));
  }
  if (!small) {
    for (const dir of new Set(dirOfDept.values())) {
      add({ key: `dir:${dir}`, level: "diretor", parent: "cerebro", papel: DIRETORES[dir], area_key: dir,
        cracha: { dados: ["numeros_agregados", "diagnostico", "processos"], acoes: ["delegar", "cobrar", "revisar", "propor_melhoria"] }, autonomia: "A1" });
    }
    for (const d of inp.departments) {
      add({ key: `coord:${d.id}`, level: "coordenador", parent: `dir:${dirOfDept.get(d.id)}`, papel: `Coordenador do setor ${d.name} (IA)`,
        department_id: d.id, cracha: { dados: ["numeros_agregados", "processos"], acoes: ["delegar", "revisar", "propor_melhoria"] }, autonomia: "A1" });
    }
  }
  const norm = (s: string) => s.trim().toLowerCase();
  const deptOf = (setor: string) => inp.departments.find((d) => norm(d.name) === norm(setor)) ?? null;
  const automatizavel = new Set<string>();
  for (const p of inp.processes.filter((x) => x.status === "aprovado")) {
    const d = deptOf(p.setor);
    add({ key: `esp:${p.id}`, level: "especialista", parent: !small && d ? `coord:${d.id}` : "cerebro",
      papel: `Especialista em ${p.nome.trim()} (IA)`, department_id: d?.id ?? null, process_id: p.id,
      cracha: { dados: ["processos", "base_conhecimento"], acoes: ["propor_melhoria", "pedir_informacao"] }, autonomia: "A1" });
    if (d && (p.design.passos ?? []).some((s) => s.decisao && s.decisao !== "pessoa")) automatizavel.add(d.id);
  }
  for (const d of inp.departments.filter((x) => automatizavel.has(x.id))) {
    add({ key: `exec:${d.id}`, level: "executor", parent: small ? "cerebro" : `coord:${d.id}`, papel: `Atendente do setor ${d.name} (IA)`,
      department_id: d.id,
      cracha: { dados: ["conversa_em_andamento", "base_conhecimento", "processos"], acoes: ["responder_cliente", "passar_para_pessoa", "enviar_modelo", "pedir_informacao"] },
      autonomia: "A1" }); // sombra: a IA sugere e a pessoa envia (decisão 1 do dono)
  }
  // O Assistente principal da empresa (Configurações → Assistente de IA) também é um executor: passa pela prova e
  // pelos degraus de publicação (fatias 6 e 7) mesmo sem processos desenhados.
  add({ key: "exec:geral", level: "executor", parent: !small && dirOfDept.size && [...dirOfDept.values()].includes("atendimento") ? "dir:atendimento" : "cerebro",
    papel: "Atendente geral (IA)",
    cracha: { dados: ["conversa_em_andamento", "base_conhecimento", "diagnostico"], acoes: ["responder_cliente", "passar_para_pessoa", "enviar_modelo"] },
    autonomia: "A1" });
  for (const [key, papel, cracha, autonomia] of APOIO) add({ key, level: "apoio", parent: "cerebro", papel, cracha, autonomia });
  return out;
}
