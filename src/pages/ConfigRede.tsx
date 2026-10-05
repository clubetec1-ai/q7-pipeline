import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowLeft, Copy, Network, Send, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface MyNet {
  id: string; name: string; role: "hq" | "unit"; brand: { app_name?: string };
  applied_version: number | null; latest_version: number | null; latest_mandatory: boolean | null; units: number | null;
}
interface UnitRow {
  unidade: string; organization_id: string; desde: string; versao_padrao: number;
  conversas_novas: number; finalizados: number; resposta_min: number | null; avaliacoes: number; nota_media: number | null;
}
interface Std { version: number; mandatory: boolean; created_at: string; payload: { pipeline_stages?: unknown[]; departments?: unknown[]; tags?: unknown[]; agent_prompt?: string | null; sections?: Record<string, string> } }

const fmt = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR"));
const summary = (p: Std["payload"]) => [
  `${p.pipeline_stages?.length ?? 0} etapa(s) do funil`, `${p.departments?.length ?? 0} setor(es)`, `${p.tags?.length ?? 0} etiqueta(s)`,
  p.agent_prompt ? "instruções do assistente" : "", Object.keys(p.sections ?? {}).length ? "regras, tom de voz, políticas e perguntas frequentes" : "",
].filter(Boolean).join(" · ");

/**
 * Configurações → Rede de franquias. Matriz: painel só com números por unidade, convites
 * e padrão da rede. Unidade: aplicar o padrão e sair. Sem rede: entrar com o código.
 */
export default function ConfigRede() {
  const { org, can } = useOrg();
  const { toast } = useToast();
  const [net, setNet] = useState<MyNet | null | undefined>(undefined);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [stds, setStds] = useState<Std[]>([]);
  const [days, setDays] = useState(30);
  const [code, setCode] = useState("");
  const [newCode, setNewCode] = useState<string | null>(null);
  const [mandatory, setMandatory] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!org) return;
    const { data } = await supabase.rpc("my_network", { org: org.id });
    const n = (data as unknown as MyNet) ?? null;
    setNet(n);
    if (!n) return;
    const { data: s } = await supabase.from("network_standards").select("version, mandatory, created_at, payload").eq("network_id", n.id).order("version", { ascending: false }).limit(10);
    setStds((s as unknown as Std[]) ?? []);
    if (n.role === "hq") {
      const until = new Date(), since = new Date(until.getTime() - days * 86_400_000);
      const { data: d } = await supabase.rpc("network_dashboard", { net: n.id, since: since.toISOString(), until: until.toISOString() });
      setUnits((d as unknown as UnitRow[]) ?? []);
    }
  }, [org, days]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setNewCode(null); }, [org?.id]);

  if (!org) return null;
  if (!can("org.settings")) return <Navigate to="/configuracoes" replace />;
  const fail = (m: string) => toast({ variant: "destructive", title: "Não deu certo", description: m });

  const join = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("network_join", { org: org.id, p_code: code.trim() });
    setBusy(false);
    if (error) return fail(error.message);
    toast({ title: "Sua empresa entrou na rede" });
    window.dispatchEvent(new Event("clubecrm:theme-changed")); // marca da rede (white label)
    setCode("");
    void load();
  };
  const leave = async () => {
    if (!window.confirm("Sair da rede? A matriz deixa de ver os números da sua empresa e você deixa de receber o padrão. O que já foi aplicado continua.")) return;
    const { error } = await supabase.rpc("network_leave", { org: org.id });
    if (error) return fail(error.message);
    window.dispatchEvent(new Event("clubecrm:theme-changed")); // volta à marca padrão
    void load();
  };
  const apply = async () => {
    if (!window.confirm("Aplicar o padrão da rede? Acrescenta etapas, setores e etiquetas que faltam (nada é apagado) e troca as instruções do assistente e as regras pelas da rede.")) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("network_apply_standard", { org: org.id });
    setBusy(false);
    if (error) return fail(error.message);
    toast({ title: `Padrão da rede aplicado (versão ${data})` });
    void load();
  };
  const invite = async () => {
    if (!net) return;
    const { data, error } = await supabase.rpc("network_invite", { net: net.id });
    if (error) return fail(error.message);
    setNewCode(data as unknown as string);
  };
  const publish = async () => {
    if (!net) return;
    if (!window.confirm(mandatory
      ? "Publicar como OBRIGATÓRIO? O padrão é aplicado agora em todas as unidades."
      : "Publicar o padrão? As unidades recebem um aviso e aplicam quando quiserem.")) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("network_publish_standard", { net: net.id, p_mandatory: mandatory });
    setBusy(false);
    if (error) return fail(error.message);
    toast({ title: `Versão ${data} do padrão publicada` });
    void load();
  };
  const remove = async (u: UnitRow) => {
    if (!net || !window.confirm(`Tirar ${u.unidade} da rede? A empresa continua funcionando normalmente, só sai da rede.`)) return;
    const { error } = await supabase.rpc("network_remove_unit", { net: net.id, unit: u.organization_id });
    if (error) return fail(error.message);
    void load();
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="configuracoes" />
      <main className="flex-1 w-full max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
        <div>
          <Link to="/configuracoes" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"><ArrowLeft className="w-4 h-4" /> Configurações</Link>
          <h1 className="font-brand text-2xl leading-tight mt-1">Rede de franquias</h1>
          <p className="text-sm text-muted-foreground">
            Cada unidade continua sendo uma empresa separada: a matriz vê <b>só números somados por unidade</b> (nunca nomes, telefones ou mensagens de clientes) e envia o padrão da rede.
          </p>
        </div>

        {net === null && (
          <section className="rounded-xl border bg-card p-5 space-y-3">
            <p className="font-medium inline-flex items-center gap-2"><Network className="w-4 h-4" /> Entrar em uma rede</p>
            <p className="text-sm text-muted-foreground">Recebeu um código da matriz da sua rede? Digite abaixo. Você pode sair quando quiser. Para criar uma rede (sua empresa como matriz), fale com a Clubetec.</p>
            <div className="flex flex-wrap gap-2">
              <Input className="max-w-xs font-mono uppercase" placeholder="REDE-XXXXXXXXXX" value={code} onChange={(e) => setCode(e.target.value)} />
              <Button disabled={busy || code.trim().length < 8} onClick={() => void join()}>Entrar na rede</Button>
            </div>
          </section>
        )}

        {net && net.role === "unit" && (
          <section className="rounded-xl border bg-card p-5 space-y-3">
            <p className="font-medium inline-flex items-center gap-2"><Network className="w-4 h-4" /> {net.name}</p>
            {net.latest_version ? (
              <p className="text-sm">
                Padrão da rede: versão <b>{net.latest_version}</b>{net.latest_mandatory ? " (obrigatória)" : ""} · sua empresa usa a versão <b>{net.applied_version || "nenhuma"}</b>.
              </p>
            ) : <p className="text-sm text-muted-foreground">A matriz ainda não publicou o padrão da rede.</p>}
            {stds[0] && <p className="text-xs text-muted-foreground">O padrão traz: {summary(stds[0].payload)}.</p>}
            <div className="flex flex-wrap gap-2">
              {!!net.latest_version && (net.applied_version ?? 0) < net.latest_version && (
                <Button disabled={busy} onClick={() => void apply()}><Upload className="w-4 h-4 mr-1" /> Aplicar o padrão da rede</Button>
              )}
              <Button variant="outline" onClick={() => void leave()}>Sair da rede</Button>
            </div>
          </section>
        )}

        {net && net.role === "hq" && (
          <>
            <section className="rounded-xl border bg-card p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium inline-flex items-center gap-2"><Network className="w-4 h-4" /> {net.name} — {units.length} unidade(s)</p>
                <div className="flex rounded-md border overflow-hidden">
                  {[7, 30, 90].map((d) => (
                    <button key={d} type="button" onClick={() => setDays(d)}
                      className={`px-3 py-1 text-sm ${days === d ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{d} dias</button>
                  ))}
                </div>
              </div>
              {!units.length && <p className="text-sm text-muted-foreground">Nenhuma unidade ainda. Gere um código de convite abaixo e envie ao dono de cada unidade.</p>}
              {units.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-muted-foreground border-b">
                      <th className="p-2 font-normal">Unidade</th><th className="p-2 font-normal">Conversas novas</th><th className="p-2 font-normal">Atendimentos finalizados</th>
                      <th className="p-2 font-normal">1ª resposta (min)</th><th className="p-2 font-normal">Nota média</th><th className="p-2 font-normal">Avaliações</th>
                      <th className="p-2 font-normal">Padrão</th><th />
                    </tr></thead>
                    <tbody>
                      {units.map((u) => (
                        <tr key={u.organization_id} className="border-b last:border-0">
                          <td className="p-2 font-medium">{u.unidade}</td><td className="p-2">{fmt(u.conversas_novas)}</td><td className="p-2">{fmt(u.finalizados)}</td>
                          <td className="p-2">{fmt(u.resposta_min)}</td><td className="p-2">{fmt(u.nota_media)}</td><td className="p-2">{fmt(u.avaliacoes)}</td>
                          <td className="p-2">{u.versao_padrao ? `v${u.versao_padrao}` : "—"}</td>
                          <td className="p-2 text-right"><Button size="sm" variant="ghost" onClick={() => void remove(u)}>Tirar da rede</Button></td>
                        </tr>
                      ))}
                      <tr className="font-medium">
                        <td className="p-2">Rede inteira</td>
                        <td className="p-2">{fmt(units.reduce((a, u) => a + u.conversas_novas, 0))}</td>
                        <td className="p-2">{fmt(units.reduce((a, u) => a + u.finalizados, 0))}</td>
                        <td colSpan={5} />
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="rounded-xl border bg-card p-5 space-y-3">
              <p className="font-medium inline-flex items-center gap-2"><Send className="w-4 h-4" /> Convidar unidade</p>
              <p className="text-sm text-muted-foreground">Cada código vale para uma unidade, por 7 dias. O dono da unidade digita em Configurações → Rede de franquias.</p>
              {newCode ? (
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-muted px-3 py-2 font-mono">{newCode}</code>
                  <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(newCode); toast({ title: "Copiado" }); }}><Copy className="w-4 h-4" /></Button>
                  <span className="text-xs text-muted-foreground">Copie agora: ele não aparece de novo.</span>
                </div>
              ) : <Button variant="outline" onClick={() => void invite()}>Gerar código de convite</Button>}
            </section>

            <section className="rounded-xl border bg-card p-5 space-y-3">
              <p className="font-medium inline-flex items-center gap-2"><Upload className="w-4 h-4" /> Padrão da rede</p>
              <p className="text-sm text-muted-foreground">
                Leva a configuração da matriz para as unidades: etapas do funil, setores, etiquetas, instruções do assistente, regras da IA, tom de voz, políticas e perguntas frequentes. Nunca leva dados de clientes. Nas unidades, só acrescenta o que falta (não apaga nada).
              </p>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} />
                Obrigatório (aplica agora em todas as unidades; sem isso, cada unidade aplica quando quiser)
              </label>
              <Button disabled={busy} onClick={() => void publish()}>Publicar o padrão a partir desta empresa</Button>
              {stds.length > 0 && (
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {stds.map((s) => <li key={s.version}>v{s.version}{s.mandatory ? " (obrigatória)" : ""} — {new Date(s.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} — {summary(s.payload)}</li>)}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
