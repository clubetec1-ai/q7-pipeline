import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowLeft, Plus, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { memberNames, type MemberName } from "@/lib/memberNames";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const AREA_KEYS: Record<string, string> = {
  vendas: "Vendas", atendimento: "Atendimento", financeiro: "Financeiro", administrativo: "Administrativo",
  marketing: "Marketing", rh: "RH (pessoas)", operacao: "Operação", pos_venda: "Pós-venda", outra: "Outra",
};

interface Area {
  id: string; key: string; name: string; department_id: string | null; approver_id: string | null; backup_approver_id: string | null;
  approval_mode: string; agent_enabled: boolean; enabled: boolean;
}
interface Dept { id: string; name: string }

const sel = "h-9 w-full rounded-md border bg-background px-2 text-sm";

/**
 * Configurações → Áreas e responsáveis (dono/admin). Cada área de gestão (Vendas,
 * Financeiro…) tem um responsável que aprova as propostas da área — o cérebro e os
 * agentes só propõem. Agentes de IA e integrações continuam só com o dono.
 */
export default function ConfigAreas() {
  const { org, can } = useOrg();
  const { toast } = useToast();
  const [areas, setAreas] = useState<Area[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [people, setPeople] = useState<Map<string, MemberName>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newKey, setNewKey] = useState("vendas");

  const load = useCallback(async () => {
    if (!org) return;
    const [{ data: a }, { data: d }, names] = await Promise.all([
      supabase.from("org_areas").select("id, key, name, department_id, approver_id, backup_approver_id, approval_mode, agent_enabled, enabled")
        .eq("organization_id", org.id).order("name"),
      supabase.from("departments").select("id, name").eq("organization_id", org.id).order("name"),
      memberNames(org.id),
    ]);
    setAreas((a as Area[]) ?? []);
    setDepts((d as Dept[]) ?? []);
    setPeople(names);
  }, [org]);
  useEffect(() => { void load(); }, [load]);

  if (!org) return null;
  if (!can("org.settings")) return <Navigate to="/configuracoes" replace />;

  const save = async (a: Area, patch: Partial<Area>) => {
    const n = { ...a, ...patch };
    setBusy(a.id);
    const { error } = await supabase.rpc("set_org_area", {
      org: org.id, area: a.id, p_key: n.key, p_name: n.name, department: n.department_id, approver: n.approver_id,
      backup: n.backup_approver_id, mode: n.approval_mode, agent_on: n.agent_enabled, on_off: n.enabled,
    });
    setBusy(null);
    if (error) return toast({ variant: "destructive", title: "Não salvou", description: error.message });
    setAreas((xs) => xs.map((x) => (x.id === a.id ? n : x)));
  };
  const add = async () => {
    if (newName.trim().length < 2) return;
    setBusy("new");
    const { error } = await supabase.rpc("set_org_area", {
      org: org.id, area: null, p_key: newKey, p_name: newName.trim(), department: null, approver: null, backup: null,
      mode: "responsavel", agent_on: false, on_off: true,
    });
    setBusy(null);
    if (error) return toast({ variant: "destructive", title: "Não criou", description: error.message });
    setNewName("");
    void load();
  };
  const seed = async () => {
    setBusy("seed");
    const { data, error } = await supabase.rpc("seed_org_areas", { org: org.id });
    setBusy(null);
    if (error) return toast({ variant: "destructive", title: "Não foi possível sugerir", description: error.message });
    toast({ title: data ? `${data} área(s) sugerida(s)` : "Nenhuma área nova", description: data ? "Confira o responsável e ligue as que for usar." : undefined });
    void load();
  };
  const peopleList = [...people.entries()].sort((x, y) => x[1].name.localeCompare(y[1].name));

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="configuracoes" />
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6 sm:px-6 space-y-6">
        <div>
          <Link to="/configuracoes" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"><ArrowLeft className="w-4 h-4" /> Configurações</Link>
          <h1 className="font-brand text-2xl leading-tight mt-1">Áreas e responsáveis</h1>
          <p className="text-sm text-muted-foreground max-w-3xl">
            O cérebro acompanha cada área da empresa e sugere melhorias. Quem aprova as sugestões de cada área é o responsável
            que você escolher aqui (você sempre pode aprovar tudo). Agentes de IA e ligações com outros sistemas só você aprova.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy === "seed"} onClick={() => void seed()}><Sparkles className="w-4 h-4 mr-1" /> Sugerir áreas pelos setores</Button>
          <div className="flex gap-2">
            <select className={`${sel} w-40`} value={newKey} onChange={(e) => setNewKey(e.target.value)} aria-label="Tipo da área">
              {Object.entries(AREA_KEYS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <Input className="h-9 w-48" placeholder="Nome da área" value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} />
            <Button disabled={busy === "new" || newName.trim().length < 2} onClick={() => void add()}><Plus className="w-4 h-4 mr-1" /> Criar</Button>
          </div>
        </div>

        {!areas.length ? (
          <div className="rounded-xl border bg-card p-10 text-center">
            <p className="font-medium">Nenhuma área ainda</p>
            <p className="text-sm text-muted-foreground mt-1">Clique em "Sugerir áreas pelos setores" para começar pelas áreas que a empresa já tem.</p>
          </div>
        ) : (
          <div className="rounded-xl border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr className="text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Área</th>
                  <th className="px-4 py-2.5 font-medium">Setor da fila</th>
                  <th className="px-4 py-2.5 font-medium">Responsável</th>
                  <th className="px-4 py-2.5 font-medium">Substituto</th>
                  <th className="px-4 py-2.5 font-medium">Quem aprova</th>
                  <th className="px-4 py-2.5 font-medium" title="O agente da área sugere melhorias quando o cérebro pedir">Agente sugere</th>
                  <th className="px-4 py-2.5 font-medium">Ligada</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {areas.map((a) => (
                  <tr key={a.id} className={a.enabled ? "" : "opacity-60"}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{a.name}</p>
                      <p className="text-xs text-muted-foreground">{AREA_KEYS[a.key] ?? a.key}</p>
                    </td>
                    <td className="px-4 py-3 min-w-[10rem]">
                      <select className={sel} value={a.department_id ?? ""} disabled={busy === a.id} onChange={(e) => void save(a, { department_id: e.target.value || null })}>
                        <option value="">Nenhum</option>
                        {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3 min-w-[10rem]">
                      <select className={sel} value={a.approver_id ?? ""} disabled={busy === a.id} onChange={(e) => void save(a, { approver_id: e.target.value || null })}>
                        <option value="">Só o dono</option>
                        {peopleList.map(([id, p]) => <option key={id} value={id}>{p.name}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3 min-w-[10rem]">
                      <select className={sel} value={a.backup_approver_id ?? ""} disabled={busy === a.id} onChange={(e) => void save(a, { backup_approver_id: e.target.value || null })}>
                        <option value="">Nenhum</option>
                        {peopleList.map(([id, p]) => <option key={id} value={id}>{p.name}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3 min-w-[10rem]">
                      <select className={sel} value={a.approval_mode} disabled={busy === a.id} onChange={(e) => void save(a, { approval_mode: e.target.value })}>
                        <option value="responsavel">Responsável ou dono</option>
                        <option value="dono">Só o dono</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <input type="checkbox" className="h-4 w-4" checked={a.agent_enabled} disabled={busy === a.id}
                        aria-label={`Agente da área ${a.name} sugere melhorias`} onChange={(e) => void save(a, { agent_enabled: e.target.checked })} />
                    </td>
                    <td className="px-4 py-3">
                      <input type="checkbox" className="h-4 w-4" checked={a.enabled} disabled={busy === a.id}
                        aria-label={`Ligar a área ${a.name}`} onChange={(e) => void save(a, { enabled: e.target.checked })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          "Agente sugere": toda segunda o cérebro analisa os números e pode pedir ao agente da área até 3 sugestões, sempre com
          os números que as justificam. Nada vai ao ar sem a aprovação do responsável ou sua.
        </p>
        <p className="text-xs text-muted-foreground">Recomendado: peça aos responsáveis que liguem a verificação em duas etapas (menu da pessoa → Segurança).</p>
      </main>
    </div>
  );
}
