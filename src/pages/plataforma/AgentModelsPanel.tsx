import { useCallback, useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

/**
 * Plataforma → IA → Modelo por tipo de agente (pedido do dono, 07/10). Espelho do catálogo em
 * supabase/functions/_shared/ai-agents-models.ts: o sistema sugere o modelo pela capacidade de cada agente (qualidade,
 * segurança e menos tokens); a equipe Clubetec pode trocar por fornecedor. "Automático" = sugerido.
 */
type Nivel = "rapido" | "capaz" | "maxima";
const AGENTS: { key: string; label: string; para: string; nivel: Nivel; teto?: number }[] = [
  { key: "atendimento", label: "Atendimento ao cliente", para: "WhatsApp, Facebook, Instagram, e-mail e bloco de IA dos fluxos", nivel: "rapido", teto: 700 },
  { key: "guardiao", label: "Guardião de segurança (leitura)", para: "pontos de atenção (as regras fixas é que bloqueiam)", nivel: "rapido", teto: 400 },
  { key: "avaliacao_atendimento", label: "Avaliação dos atendimentos", para: "nota e motivo de cada atendimento (alto volume)", nivel: "rapido", teto: 800 },
  { key: "avaliador", label: "Avaliador da prova", para: "cenários e conferência das respostas dos agentes", nivel: "capaz", teto: 900 },
  { key: "entrevista", label: "Entrevista do Diagnóstico", para: "perguntas, revisão e organização", nivel: "capaz" },
  { key: "arquiteto", label: "Arquiteto de processos", para: "processos passo a passo e textos dos fluxos prontos", nivel: "capaz" },
  { key: "relatorios", label: "Relatórios, melhorias e propostas", para: "relatórios de avaliações, melhorias e propostas comerciais", nivel: "capaz" },
  { key: "cerebro", label: "Cérebro e rede de agentes", para: "análise semanal e perguntas entre agentes (decide pela rede: o mais robusto)", nivel: "maxima" },
  { key: "plataforma", label: "Cérebro da plataforma", para: "diagnóstico de incidentes (só metadados)", nivel: "maxima" },
  { key: "integracoes", label: "Integrações", para: "guia para ligar outros sistemas", nivel: "capaz" },
];
const SUGERIDO: Record<string, Record<Nivel, string>> = {
  openai: { rapido: "gpt-4o-mini", capaz: "gpt-4.1-mini", maxima: "gpt-4.1" }, groq: { rapido: "auto", capaz: "auto", maxima: "auto" },
  gemini: { rapido: "gemini-2.5-flash", capaz: "gemini-2.5-flash", maxima: "gemini-2.5-pro" }, anthropic: { rapido: "claude-haiku-4-5", capaz: "claude-haiku-4-5", maxima: "claude-haiku-4-5" },
  openrouter: { rapido: "openai/gpt-4o-mini", capaz: "openai/gpt-4.1-mini", maxima: "openai/gpt-4.1" }, deepseek: { rapido: "deepseek-chat", capaz: "deepseek-chat", maxima: "deepseek-chat" },
};
const NIVEL: Record<Nivel, string> = { rapido: "rápido", capaz: "capaz", maxima: "máximo" };
const OPCOES: Record<string, string[]> = {
  openai: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1", "gpt-4o"],
  groq: ["auto", "llama-3.1-8b-instant", "llama-3.3-70b-versatile", "openai/gpt-oss-20b", "openai/gpt-oss-120b"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro"], anthropic: ["claude-haiku-4-5"], openrouter: ["openai/gpt-4o-mini", "openai/gpt-4.1-mini"], deepseek: ["deepseek-chat"],
};

export function AgentModelsPanel({ providers }: { providers: string[] }) {
  const { toast } = useToast();
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    const { data } = await supabase.from("platform_ai_agent_models").select("agent, provider, model");
    setChosen(Object.fromEntries((data ?? []).map((r) => [`${r.agent}:${r.provider}`, r.model])));
  }, []);
  useEffect(() => { void load(); }, [load]);
  const save = async (agent: string, provider: string, model: string) => {
    const { error } = await supabase.rpc("platform_ai_agent_model_set", { p_agent: agent, p_provider: provider, p_model: model });
    if (error) return toast({ variant: "destructive", title: "Não salvo", description: error.message });
    toast({ title: model ? `Modelo trocado: ${model}` : "Voltou para o automático (sugerido)" });
    void load();
  };
  const provs = [...new Set(providers.filter((p) => OPCOES[p]))];
  if (!provs.length) return null;

  return (
    <section className="rounded-xl border bg-card p-4 space-y-3">
      <h2 className="font-semibold flex items-center gap-2"><Cpu className="w-4 h-4" /> Modelo por tipo de agente</h2>
      <p className="text-xs text-muted-foreground">
        Cada agente usa o modelo de acordo com o que o trabalho exige: os de alto volume (atendimento, avaliações, Guardião) vão no modelo
        rápido e barato, com teto de tamanho de resposta; os que pensam mais (entrevista, Arquiteto, prova, relatórios) no capaz; o <b>cérebro</b>,
        que decide pela rede de agentes, no mais robusto. Versão nova de modelo só entra depois de testada. <b>Automático</b> usa o sugerido. Se o modelo escolhido não existir ou falhar, o sistema volta sozinho para o padrão do fornecedor.
        Empresa com chave própria e modelo escolhido continua com o dela.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr><th className="py-1 pr-3">Agente</th>{provs.map((p) => <th key={p} className="pr-3">{p}</th>)}</tr>
          </thead>
          <tbody>
            {AGENTS.map((a) => (
              <tr key={a.key} className="border-t align-top">
                <td className="py-2 pr-3">
                  <p className="font-medium">{a.label} <Badge variant="outline" className="ml-1 text-[10px]">{NIVEL[a.nivel]}</Badge></p>
                  <p className="text-xs text-muted-foreground">{a.para}{a.teto ? ` · resposta até ${a.teto} tokens` : ""}</p>
                </td>
                {provs.map((p) => {
                  const sug = SUGERIDO[p]?.[a.nivel] ?? "";
                  const cur = chosen[`${a.key}:${p}`] ?? "";
                  return (
                    <td key={p} className="py-2 pr-3">
                      <select className="h-8 rounded-md border bg-background px-1 text-xs" value={cur} onChange={(e) => void save(a.key, p, e.target.value)}>
                        <option value="">Automático ({sug})</option>
                        {(OPCOES[p] ?? []).filter((m) => m !== sug).map((m) => <option key={m} value={m}>{m}</option>)}
                        {cur && !(OPCOES[p] ?? []).includes(cur) && <option value={cur}>{cur}</option>}
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
