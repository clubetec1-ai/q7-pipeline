import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { EquipeData } from "./useEquipeData";

interface Ext { id: string; number: string; label: string | null; wss_url: string | null; has_password: boolean; user_id: string | null; mode: string }
const MODES: [string, string][] = [["webrtc", "Navegador (WebRTC)"], ["sip", "MicroSIP / aparelho"], ["off", "Desligado"]];

/**
 * Ramais que a Clubetec entregou: o dono/admin escolhe o atendente de cada um e
 * o modo (o atendente também troca o modo no próprio telefone).
 */
export function RamaisTab({ orgId, data }: { orgId: string; data: EquipeData }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Ext[]>([]);
  const load = useCallback(async () => {
    const { data: r } = await supabase.from("pbx_extensions")
      .select("id, number, label, wss_url, has_password, user_id, mode").eq("organization_id", orgId).order("number");
    setRows((r as Ext[]) ?? []);
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);

  const act = async (p: PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    const { error } = await p;
    if (error) toast({ variant: "destructive", title: "Não salvou", description: error.message });
    else toast({ title: ok });
    void load();
  };
  const active = data.members.filter((m) => m.status === "active");

  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">Nenhum ramal ainda. Ao contratar o PBX com a Clubetec, os ramais aparecem aqui prontos para escolher o atendente.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader><TableRow><TableHead>Ramal</TableHead><TableHead>Atendente</TableHead><TableHead>Como usa</TableHead><TableHead>Situação</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="font-medium">{e.number}{e.label ? ` · ${e.label}` : ""}</TableCell>
              <TableCell>
                <select className="h-8 rounded-md border bg-background px-2 text-sm" value={e.user_id ?? ""}
                  onChange={(ev) => act(supabase.rpc("assign_extension", { ext: e.id, member: (ev.target.value || null) as string }), "Atendente do ramal salvo")}>
                  <option value="">— livre —</option>
                  {active.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
                </select>
              </TableCell>
              <TableCell>
                <select className="h-8 rounded-md border bg-background px-2 text-sm" value={e.mode}
                  onChange={(ev) => act(supabase.rpc("set_extension_mode", { ext: e.id, p_mode: ev.target.value }), "Modo salvo")}>
                  {MODES.map(([k, l]) => <option key={k} value={k} disabled={k === "webrtc" && !e.wss_url}>{l}</option>)}
                </select>
              </TableCell>
              <TableCell>
                {!e.has_password ? <Badge variant="outline">Aguardando Clubetec</Badge>
                  : !e.wss_url ? <Badge variant="outline">Só MicroSIP/aparelho</Badge> : <Badge>Pronto</Badge>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground mt-2">Cada pessoa tem um ramal. No MicroSIP/aparelho, o ClubeCRM identifica o cliente pelo número e continua o atendimento no WhatsApp.</p>
    </div>
  );
}
