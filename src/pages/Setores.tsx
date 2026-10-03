import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { Layers, Plus, Target, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { AppHeader } from "@/components/AppHeader";
import { NumberHealthBanner } from "@/components/NumberHealthBanner";
import { nextColor } from "@/components/ColorTag";
import { Button } from "@/components/ui/button";
import { useEquipeData } from "./equipe/useEquipeData";
import { ImplementationBoard, type BoardProc, type Priority } from "./diagnostico/ImplementationBoard";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/**
 * Setores e processos: onde os setores vivem depois do Diagnóstico. Cada setor
 * (fila de atendimento de verdade) com cor, pessoas e os processos mapeados; os
 * setores mapeados que ainda não existem podem ser criados com um clique; o plano
 * de implementação (agora/depois/não) fica aqui também.
 */
export default function Setores() {
  const { org, can } = useOrg();
  const { toast } = useToast();
  const data = useEquipeData(org?.id);
  const manage = can("org.settings");
  const canDepts = can("departments.manage");
  const [procs, setProcs] = useState<BoardProc[]>([]);
  const [mapped, setMapped] = useState<string[]>([]);
  const [priority, setPriority] = useState<Priority | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    if (!org || !manage) return;
    const { data: p } = await supabase.from("company_profiles").select("processes, steps").eq("organization_id", org.id).maybeSingle();
    const steps = (p?.steps ?? {}) as unknown as { setores?: { setores?: string[] }; prioridade?: Priority };
    setProcs((p?.processes as unknown as BoardProc[]) ?? []);
    setMapped(steps.setores?.setores ?? []);
    setPriority(steps.prioridade ?? null);
  }, [org, manage]);
  useEffect(() => { void loadProfile(); }, [loadProfile]);

  const depts = data.departments;
  const missing = useMemo(() => {
    const have = new Set(depts.map((d) => norm(d.name)));
    const fromProcs = procs.map((p) => p.setor || p.area || "").filter(Boolean);
    return [...new Set([...mapped, ...fromProcs])].filter((n) => !have.has(norm(n)));
  }, [depts, mapped, procs]);

  if (!org) return null;
  if (!manage && !canDepts) return <Navigate to="/" replace />;

  const createMissing = async () => {
    setBusy("create");
    const colors = depts.map((d) => d.color);
    for (const name of missing) {
      const color = nextColor(colors);
      colors.push(color);
      const { error } = await supabase.from("departments").insert({ organization_id: org.id, name: name.slice(0, 80), color });
      if (error && error.code !== "23505") { toast({ variant: "destructive", title: `Não criou "${name}"`, description: error.message }); break; }
    }
    setBusy(null);
    toast({ title: "Setores criados", description: "Agora escolha as pessoas de cada setor." });
    await data.reload();
  };
  const saveProcs = async (next: BoardProc[]) => {
    setProcs(next);
    const { error } = await supabase.from("company_profiles").update({ processes: next } as never).eq("organization_id", org.id);
    if (error) toast({ variant: "destructive", title: "Não salvo", description: error.message });
  };
  const prioritize = async () => {
    setBusy("priority");
    const r = await callFunction("interviewer", { action: "sector_priority", organization_id: org.id });
    setBusy(null);
    if (!r.ok) return toast({ variant: "destructive", title: r.message });
    await loadProfile();
  };
  const procsOf = (name: string) => procs.filter((p) => norm(p.setor || p.area || "") === norm(name));
  const membersOf = (id: string) => data.deptMembers.filter((m) => m.a === id).length;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="setores" />
      <NumberHealthBanner />
      <main className="flex-1 w-full max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2"><Layers className="w-6 h-6" /> Setores e processos</h1>
            <p className="text-sm text-muted-foreground">Cada setor tem sua cor, sua equipe, sua fila de atendimento e os processos mapeados no Diagnóstico.</p>
          </div>
          {manage && <Button asChild variant="outline" size="sm"><Link to="/diagnostico?pagina=setores"><Target className="w-4 h-4 mr-1" /> Mapear no Diagnóstico</Link></Button>}
        </div>

        {missing.length > 0 && canDepts && (
          <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm"><b>Setores mapeados no Diagnóstico que ainda não existem no sistema:</b> {missing.join(", ")}.</p>
            <Button size="sm" disabled={busy === "create"} onClick={createMissing}><Plus className="w-4 h-4 mr-1" /> {busy === "create" ? "Criando…" : "Criar no sistema"}</Button>
          </div>
        )}

        {!data.loading && depts.length === 0 && missing.length === 0 && (
          <div className="rounded-xl border p-6 text-center space-y-2">
            <p className="font-medium">Nenhum setor ainda</p>
            <p className="text-sm text-muted-foreground">Comece pelo Diagnóstico: ele sugere os setores mais comuns e você ajusta.</p>
            {manage && <Button asChild size="sm"><Link to="/diagnostico?pagina=setores">Mapear setores</Link></Button>}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {depts.map((d) => {
            const list = procsOf(d.name);
            const color = d.color ?? "#94A3B8";
            return (
              <div key={d.id} className="rounded-xl border bg-card overflow-hidden">
                <div className="h-1.5" style={{ background: color }} />
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold flex items-center gap-2"><span className="w-3 h-3 rounded-full" style={{ background: color }} />{d.name}</p>
                    <span className="text-xs text-muted-foreground flex items-center gap-1"><Users className="w-3.5 h-3.5" /> {membersOf(d.id)}</span>
                  </div>
                  {manage && (
                    list.length ? (
                      <ul className="text-xs space-y-1">
                        {list.slice(0, 6).map((p, i) => (
                          <li key={`${p.nome}-${i}`} className="flex items-center justify-between gap-2">
                            <span className="truncate">{p.nome}</span>
                            {p.implementar && <span className={`rounded-full px-1.5 text-xs ${p.implementar === "agora" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" : p.implementar === "depois" ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}>{p.implementar === "nao" ? "não" : p.implementar}</span>}
                          </li>
                        ))}
                        {list.length > 6 && <li className="text-muted-foreground">+{list.length - 6} processo(s)</li>}
                      </ul>
                    ) : <p className="text-xs text-muted-foreground">Nenhum processo mapeado.</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {canDepts && <Button asChild size="sm" variant="outline"><Link to="/equipe?tab=departamentos">Pessoas e fila</Link></Button>}
                    {manage && <Button asChild size="sm" variant="ghost"><Link to={`/diagnostico?pagina=${encodeURIComponent(`proc:${d.name}`)}`}>Processos</Link></Button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {manage && procs.length > 0 && (
          <ImplementationBoard processes={procs} sectors={[...new Set(procs.map((p) => p.setor || p.area || "").filter(Boolean))]}
            priority={priority} busy={busy === "priority"} onChange={(n) => void saveProcs(n)} onPrioritize={prioritize} />
        )}
      </main>
    </div>
  );
}
