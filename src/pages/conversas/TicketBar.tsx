import { useEffect, useState } from "react";
import { ArrowRightLeft, Bot, CheckCircle2, Hand, Hash } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { STATUS_LABEL, Ticket } from "./useTickets";
import { callFunction } from "@/lib/callFunction";
import { DEFAULT_GREETING } from "../equipe/GreetingSetting";

interface Option { id: string; name: string }

/**
 * Situação e ações do atendimento no cabeçalho da conversa: assumir,
 * transferir, finalizar e devolver para a IA. As regras de quem pode o quê
 * ficam no banco (RPCs); aqui só se escondem botões.
 */
export function TicketBar({ ticket, onChanged }: { ticket: Ticket | undefined; onChanged: () => void }) {
  const { user } = useAuth();
  const { org, can } = useOrg();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"transfer" | "close" | "take" | null>(null);
  const [owner, setOwner] = useState("");
  const [departments, setDepartments] = useState<Option[]>([]);
  const [people, setPeople] = useState<Option[]>([]);
  const [reasons, setReasons] = useState<Option[]>([]);
  const [toDept, setToDept] = useState("");
  const [toUser, setToUser] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  // Nome de quem está com o atendimento (quando não sou eu).
  const assignedTo = ticket?.assigned_to ?? null;
  useEffect(() => {
    setOwner("");
    if (!assignedTo || assignedTo === user?.id) return;
    supabase.from("profiles").select("full_name, email").eq("user_id", assignedTo).maybeSingle()
      .then(({ data }) => setOwner(data?.full_name || data?.email || "outra pessoa"));
  }, [assignedTo, user?.id]);

  useEffect(() => {
    if (!dialog || !org || dialog === "take") return;
    setNote("");
    if (dialog === "transfer") {
      setToDept(""); setToUser("");
      Promise.all([
        supabase.from("departments").select("id, name").eq("organization_id", org.id).order("name"),
        supabase.from("organization_members").select("user_id").eq("organization_id", org.id).eq("status", "active"),
      ]).then(async ([d, m]) => {
        setDepartments((d.data as Option[]) ?? []);
        const ids = (m.data ?? []).map((r) => r.user_id).filter((id) => id !== user?.id);
        const { data: profs } = ids.length
          ? await supabase.from("profiles").select("user_id, full_name, email").in("user_id", ids)
          : { data: [] as { user_id: string; full_name: string | null; email: string | null }[] };
        setPeople((profs ?? []).map((p) => ({ id: p.user_id, name: p.full_name || p.email || "Sem nome" })));
      });
    } else {
      setReason("");
      supabase.from("close_reasons").select("id, name").eq("organization_id", org.id).eq("active", true).order("name")
        .then(({ data }) => setReasons((data as Option[]) ?? []));
    }
  }, [dialog, org, user?.id]);

  if (!ticket) return null;

  /** Assume e avisa o cliente de quem está atendendo agora. */
  const claim = async () => {
    if (!(await rpc("claim_ticket", { ticket: ticket.id }, "Atendimento assumido"))) return;
    const [{ data: me }, { data: o }] = await Promise.all([
      supabase.from("profiles").select("full_name, email").eq("user_id", user!.id).maybeSingle(),
      supabase.from("organizations").select("settings").eq("id", org!.id).maybeSingle(),
    ]);
    const saved = (o?.settings as Record<string, unknown> | null)?.claim_greeting;
    const template = typeof saved === "string" ? saved : DEFAULT_GREETING;
    if (!template.trim()) return; // aviso desligado pela empresa
    const first = (me?.full_name || me?.email?.split("@")[0] || "").trim().split(/\s+/)[0] || "um atendente";
    const text = template.split("{nome}").join(first);
    const r = await callFunction("send-message", { conversation_id: ticket.conversation_id, text });
    if (!r.ok) toast({ variant: "destructive", title: "Assumido, mas o aviso ao cliente não foi enviado", description: r.message });
  };

  const mine = ticket.assigned_to === user?.id;
  const canAct = mine || can("conversations.reassign") || !ticket.assigned_to;
  // Atendimento de outra pessoa só se assume com permissão (fica registrado e quem estava atendendo recebe um aviso).
  const canTake = !mine && (!ticket.assigned_to || can("conversations.reassign"));

  const sendProtocol = async () => {
    setBusy(true);
    const r = await callFunction("send-message", {
      conversation_id: ticket.conversation_id, text: `Seu protocolo de atendimento é ${ticket.protocol}.`,
    });
    setBusy(false);
    toast(r.ok ? { title: "Protocolo enviado ao cliente" } : { variant: "destructive", title: r.message });
    if (r.ok) onChanged();
  };

  const rpc = async (fn: string, args: Record<string, unknown>, success: string) => {
    setBusy(true);
    const { error } = await supabase.rpc(fn as never, args as never);
    setBusy(false);
    if (error) {
      toast({ variant: "destructive", title: error.message });
      return false;
    }
    toast({ title: success });
    onChanged();
    return true;
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Badge variant={ticket.status === "bot" ? "default" : "secondary"} className="text-[10px]">
        {STATUS_LABEL[ticket.status]}{ticket.external_reply && !ticket.assigned_to ? " · pelo celular" : ""}
      </Badge>
      <span className="text-[11px] text-muted-foreground">#{ticket.protocol}</span>
      {owner && <span className="text-[11px] text-muted-foreground">· com {owner}</span>}
      {canTake && (
        <Button size="sm" variant="outline" className="h-8" disabled={busy}
          onClick={() => (ticket.assigned_to ? setDialog("take") : claim())}>
          <Hand className="w-3.5 h-3.5 mr-1" /> Assumir
        </Button>
      )}
      {mine && (
        <Button size="sm" variant="ghost" className="h-8" disabled={busy} onClick={sendProtocol}
          title="Envia o número do protocolo para o cliente">
          <Hash className="w-3.5 h-3.5 mr-1" /> Enviar protocolo
        </Button>
      )}
      {canAct && (
        <>
          <Button size="sm" variant="ghost" className="h-8" disabled={busy} onClick={() => setDialog("transfer")}>
            <ArrowRightLeft className="w-3.5 h-3.5 mr-1" /> Transferir
          </Button>
          {ticket.status !== "bot" && (
            <Button size="sm" variant="ghost" className="h-8" disabled={busy}
              onClick={() => rpc("return_ticket_to_ai", { ticket: ticket.id }, "Atendimento devolvido para a IA")}>
              <Bot className="w-3.5 h-3.5 mr-1" /> Devolver à IA
            </Button>
          )}
          <Button size="sm" className="h-8" disabled={busy} onClick={() => setDialog("close")}>
            <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Finalizar
          </Button>
        </>
      )}

      <Dialog open={dialog === "take"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assumir o atendimento de {owner || "outra pessoa"}?</DialogTitle>
            <DialogDescription>
              Fica registrado que você assumiu. {owner || "Quem estava atendendo"} recebe um aviso, e o cliente recebe a mensagem de quem vai atender.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancelar</Button>
            <Button disabled={busy} onClick={async () => {
              if (await rpc("take_over_ticket", { ticket: ticket.id }, "Atendimento assumido")) setDialog(null);
            }}>Assumir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "transfer"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transferir atendimento</DialogTitle>
            <DialogDescription>Para um departamento (vai para a fila dele) ou direto para uma pessoa.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Departamento</Label>
              <Select value={toDept} onValueChange={setToDept}>
                <SelectTrigger><SelectValue placeholder="Manter o atual" /></SelectTrigger>
                <SelectContent>{departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="space-y-1.5"><Label>Pessoa (opcional)</Label>
              <Select value={toUser} onValueChange={setToUser}>
                <SelectTrigger><SelectValue placeholder="Deixar na fila do departamento" /></SelectTrigger>
                <SelectContent>{people.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="space-y-1.5"><Label>Nota para quem recebe (opcional)</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                placeholder="Ex.: cliente quer orçamento para 3 unidades" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancelar</Button>
            <Button disabled={busy || (!toDept && !toUser)}
              onClick={async () => {
                if (await rpc("transfer_ticket", {
                  ticket: ticket.id, to_department: toDept || null, to_user: toUser || null, note: note || null,
                }, "Atendimento transferido")) setDialog(null);
              }}>Transferir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "close"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Finalizar atendimento #{ticket.protocol}</DialogTitle>
            <DialogDescription>Se o cliente escrever de novo, abre um novo atendimento.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Motivo</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger><SelectValue placeholder="Escolha o motivo" /></SelectTrigger>
                <SelectContent>{reasons.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
              </Select></div>
            <div className="space-y-1.5"><Label>Observação (opcional)</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancelar</Button>
            <Button disabled={busy || !reason}
              onClick={async () => {
                if (await rpc("close_ticket", { ticket: ticket.id, reason, note: note || null }, "Atendimento finalizado"))
                  setDialog(null);
              }}>Finalizar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
