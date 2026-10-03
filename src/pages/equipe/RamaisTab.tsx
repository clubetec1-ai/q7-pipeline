import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { extStatus } from "@/lib/extStatus";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { EquipeData } from "./useEquipeData";
import { useOrg } from "@/contexts/OrgContext";
import { NvoipCard } from "./NvoipCard";

interface Ext { id: string; number: string; label: string | null; wss_url: string | null; has_password: boolean; user_id: string | null; mode: string; reg_state: string | null; reg_detail: string | null; reg_at: string | null }
const MODES: [string, string][] = [["webrtc", "Navegador (WebRTC)"], ["sip", "MicroSIP / aparelho"], ["off", "Desligado"]];

/**
 * Ramais que a Clubetec entregou: o dono/admin escolhe o atendente de cada um e
 * o modo (o atendente também troca o modo no próprio telefone).
 */
export function RamaisTab({ orgId, data }: { orgId: string; data: EquipeData }) {
  const { toast } = useToast();
  const { can } = useOrg();
  const [rows, setRows] = useState<Ext[]>([]);
  const load = useCallback(async () => {
    const { data: r } = await supabase.from("pbx_extensions")
      .select("id, number, label, wss_url, has_password, user_id, mode, reg_state, reg_detail, reg_at").eq("organization_id", orgId).order("number");
    setRows((r as Ext[]) ?? []);
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = window.setInterval(() => void load(), 30_000); return () => window.clearInterval(t); }, [load]);

  const act = async (p: PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    const { error } = await p;
    if (error) toast({ variant: "destructive", title: "Não salvou", description: error.message });
    else toast({ title: ok });
    void load();
  };
  const active = data.members.filter((m) => m.status === "active");

  const card = can("org.settings") ? <NvoipCard orgId={orgId} /> : null;
  if (!rows.length) {
    return <>{card}<p className="text-sm text-muted-foreground">Nenhum ramal ainda. Ao contratar o PBX com a Clubetec, os ramais chegam aqui prontos e já associados à equipe; você pode trocar o atendente quando quiser.</p></>;
  }
  return (
    <div className="overflow-x-auto">
      {card}
      <Table>
        <TableHeader><TableRow><TableHead>Ramal</TableHead><TableHead>Atendente</TableHead><TableHead>Como usa</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
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
                {(() => { const st = extStatus(e); return (
                  <span className="inline-flex items-center gap-1.5 text-xs" title={st.hint}><span className={`w-2.5 h-2.5 rounded-full ${st.dot}`} />{st.label}</span>
                ); })()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground mt-2">Cada pessoa tem um ramal e vê o botão 📞 no canto da tela. <b>Navegador</b>: liga e atende dentro do sistema
        (precisa do endereço WebRTC da central). <b>MicroSIP/aparelho</b>: liga pelo MicroSIP; o sistema identifica o cliente pelo número e continua o
        atendimento no WhatsApp. 🟢 online · 🔴 erro · ⚪ desconectado · 🔵 MicroSIP (fora do navegador).</p>
    </div>
  );
}
