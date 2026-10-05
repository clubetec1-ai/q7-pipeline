import { useCallback, useEffect, useState } from "react";
import { Network } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Net {
  id: string; name: string; hq_org_id: string; hq: string; unidades: number; logo_matriz: string | null;
  brand: { app_name?: string; primary?: string; secondary?: string; logo?: string };
}
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Plataforma → Redes (só a Clubetec): criar a rede de uma matriz e definir o white label
 * (nome do produto, cores e logo — o logo é o da própria matriz, em Logo e cores).
 */
export function NetworksPanel({ orgs }: { orgs: { id: string; name: string }[] }) {
  const { toast } = useToast();
  const [list, setList] = useState<Net[]>([]);
  const [hq, setHq] = useState("");
  const [name, setName] = useState("");
  const [edit, setEdit] = useState<{ id: string; app_name: string; primary: string; secondary: string; useLogo: boolean; logo: string | null } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("platform_networks");
    setList((data as unknown as Net[]) ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const fail = (m: string) => toast({ variant: "destructive", title: "Não deu certo", description: m });

  const create = async () => {
    const { error } = await supabase.rpc("platform_create_network", { hq, p_name: name.trim() });
    if (error) return fail(error.message);
    toast({ title: "Rede criada", description: "A matriz já vê Configurações → Rede de franquias." });
    setHq(""); setName("");
    void load();
  };
  const saveBrand = async () => {
    if (!edit) return;
    const { error } = await supabase.rpc("platform_set_network_brand", {
      net: edit.id, p_brand: { app_name: edit.app_name.trim(), primary: edit.primary, secondary: edit.secondary, logo: edit.useLogo ? edit.logo : null },
    });
    if (error) return fail(error.message);
    toast({ title: "Marca da rede salva" });
    setEdit(null);
    void load();
  };
  const free = orgs.filter((o) => !list.some((n) => n.hq_org_id === o.id));

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="font-semibold flex items-center gap-2"><Network className="w-4 h-4" /> Redes de franquias e revenda (white label)</h2>
      <p className="text-xs text-muted-foreground">
        A matriz convida as unidades com um código e vê só números somados. Com o white label, o nome do produto, as cores e o logo da rede aparecem para todas as pessoas da rede no lugar de “Deixa com a IA”.
      </p>
      <div className="flex flex-wrap gap-2">
        <select className="h-9 rounded-md border bg-background px-2 text-sm" value={hq} onChange={(e) => setHq(e.target.value)} aria-label="Matriz">
          <option value="">Empresa matriz…</option>
          {free.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <Input className="h-9 max-w-xs" placeholder="Nome da rede" value={name} onChange={(e) => setName(e.target.value)} />
        <Button size="sm" disabled={!hq || name.trim().length < 2} onClick={() => void create()}>Criar rede</Button>
      </div>
      {list.map((n) => (
        <div key={n.id} className="rounded-md border p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span><b>{n.name}</b> · matriz {n.hq} · {n.unidades} unidade(s){n.brand.app_name ? ` · marca: ${n.brand.app_name}` : ""}</span>
            <Button size="sm" variant="outline" onClick={() => setEdit({ id: n.id, app_name: n.brand.app_name ?? "", primary: n.brand.primary ?? "#22C1A4",
              secondary: n.brand.secondary ?? "#215371", useLogo: !!n.brand.logo, logo: n.logo_matriz })}>White label</Button>
          </div>
          {edit?.id === n.id && (
            <div className="grid gap-2 sm:grid-cols-4 items-center">
              <Input placeholder="Nome do produto (vazio = Deixa com a IA)" value={edit.app_name} onChange={(e) => setEdit({ ...edit, app_name: e.target.value })} className="sm:col-span-2" />
              <label className="flex items-center gap-2 text-xs">Principal <input type="color" value={edit.primary} onChange={(e) => setEdit({ ...edit, primary: e.target.value })} /></label>
              <label className="flex items-center gap-2 text-xs">Secundária <input type="color" value={edit.secondary} onChange={(e) => setEdit({ ...edit, secondary: e.target.value })} /></label>
              <label className="flex items-center gap-2 text-xs sm:col-span-3">
                <input type="checkbox" checked={edit.useLogo} disabled={!edit.logo} onChange={(e) => setEdit({ ...edit, useLogo: e.target.checked })} />
                {edit.logo ? "Usar o logo da matriz (o de Configurações → Logo e cores)" : "A matriz ainda não enviou logo em Configurações → Logo e cores"}
              </label>
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button>
                <Button size="sm" disabled={!HEX.test(edit.primary) || !HEX.test(edit.secondary)} onClick={() => void saveBrand()}>Salvar</Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
