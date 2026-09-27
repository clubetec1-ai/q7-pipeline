import { NumberHealthBanner } from "@/components/NumberHealthBanner";
import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { LogOut, MoreHorizontal, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { Logo } from "@/components/Logo";
import { MainNav } from "@/components/MainNav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AddNumberDialog } from "./numeros/AddNumberDialog";
import { EmailAccounts } from "./numeros/EmailAccounts";

interface NumberRow {
  id: string;
  name: string;
  phone: string | null;
  provider: string;
  status: string;
  color: string | null;
  quality_rating: string | null;
  health_status: string | null;
  health_error: string | null;
  messaging_limit_tier: string | null;
  last_health_check_at: string | null;
}

const COLORS = ["#3FB8BE", "#6C8EF5", "#F5A623", "#E8618C", "#2EB67D", "#8B5CF6"];
const STATUS: Record<string, { label: string; variant: "secondary" | "outline" | "destructive" }> = {
  connected: { label: "Conectado", variant: "secondary" },
  disabled: { label: "Desativado", variant: "outline" },
};
const QUALITY: Record<string, string> = { GREEN: "Qualidade alta", YELLOW: "Qualidade média", RED: "Qualidade baixa" };
const TIER: Record<string, string> = {
  TIER_50: "50", TIER_250: "250", TIER_1K: "1.000", TIER_2K: "2.000", TIER_10K: "10.000", TIER_100K: "100.000", TIER_UNLIMITED: "ilimitadas",
};
const when = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

function formatPhone(p: string | null) {
  if (!p) return "Ainda não conectado";
  const d = p.replace(/\D/g, "");
  return d.length >= 12 ? `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, -4)}-${d.slice(-4)}` : `+${d}`;
}

/** Números de WhatsApp da organização (spec 4 §8). */
export default function Numeros() {
  const { signOut } = useAuth();
  const { org, can } = useOrg();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [rows, setRows] = useState<NumberRow[]>([]);
  const [lastIn, setLastIn] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [reconnectId, setReconnectId] = useState<string | null>(null);
  const [editing, setEditing] = useState<NumberRow | null>(null);
  const [deleting, setDeleting] = useState<NumberRow | null>(null);
  const [confirm, setConfirm] = useState("");
  const canManage = can("org.settings");
  const isOwner = can("org.billing");

  const load = useCallback(async () => {
    if (!org) return;
    const [{ data }, act] = await Promise.all([
      supabase.from("whatsapp_instances")
        .select("id, name, phone, provider, status, color, quality_rating, health_status, health_error, messaging_limit_tier, last_health_check_at")
        .eq("organization_id", org.id).order("created_at"),
      supabase.rpc("number_activity", { org: org.id }),
    ]);
    setRows((data as NumberRow[]) ?? []);
    setLastIn(new Map((act.data ?? []).filter((a) => a.last_inbound_at).map((a) => [a.instance_id, a.last_inbound_at])));
    setLoading(false);
  }, [org]);

  useEffect(() => { load(); }, [load]);

  if (!org) return null;
  if (!canManage) return <Navigate to="/" replace />;

  const setStatus = async (n: NumberRow, disabled: boolean) => {
    const status = disabled ? "disabled" : n.provider === "cloud" ? "connected" : "disconnected";
    const { error } = await supabase.from("whatsapp_instances").update({ status }).eq("id", n.id);
    if (error) return toast({ variant: "destructive", title: "Não foi possível alterar o número" });
    toast({ title: disabled ? "Número desativado: mensagens dele deixam de ser processadas" : "Número reativado" });
    load();
  };

  const saveEdit = async () => {
    if (!editing) return;
    const { error } = await supabase.from("whatsapp_instances")
      .update({ name: editing.name.trim(), color: editing.color }).eq("id", editing.id);
    if (error) return toast({ variant: "destructive", title: "Não foi possível salvar" });
    setEditing(null);
    load();
  };

  const remove = async () => {
    if (!deleting) return;
    const r = await callFunction("manage-instance", { action: "remove", instance_id: deleting.id, confirm });
    if (!r.ok) return toast({ variant: "destructive", title: r.message });
    toast({ title: "Número excluído" });
    setDeleting(null);
    setConfirm("");
    load();
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b px-4 h-14 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Logo horizontal width={26} height={26} />
          <MainNav active="numeros" />
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" size="icon" title="Sair" onClick={async () => { await signOut(); navigate("/login"); }}>
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>
      <NumberHealthBanner />

      <main className="flex-1 w-full max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Números</h1>
            <p className="text-sm text-muted-foreground">Os WhatsApps que atendem pela {org.name}.</p>
          </div>
          <Button onClick={() => { setReconnectId(null); setAdding(true); }}>
            <Plus className="w-4 h-4 mr-1" /> Adicionar número
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum número ainda. Clique em “Adicionar número”.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {rows.map((n) => {
              const st = STATUS[n.status] ?? { label: "Desconectado", variant: "destructive" as const };
              return (
                <div key={n.id} className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ background: n.color ?? "#94a3b8" }} />
                      <div className="min-w-0">
                        <p className="font-medium truncate">{n.name}</p>
                        <p className="text-sm text-muted-foreground">{formatPhone(n.phone)}</p>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Ações"><MoreHorizontal className="w-4 h-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditing({ ...n })}>Editar nome e cor</DropdownMenuItem>
                        {n.provider !== "cloud" && n.status !== "disabled" && (
                          <DropdownMenuItem onClick={() => { setReconnectId(n.id); setAdding(true); }}>Reconectar (QR Code)</DropdownMenuItem>
                        )}
                        {n.status === "disabled"
                          ? <DropdownMenuItem onClick={() => setStatus(n, false)}>Reativar</DropdownMenuItem>
                          : <DropdownMenuItem onClick={() => setStatus(n, true)}>Desativar</DropdownMenuItem>}
                        {isOwner && (
                          <DropdownMenuItem className="text-destructive" onClick={() => { setConfirm(""); setDeleting(n); }}>
                            Excluir definitivamente
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{n.provider === "cloud" ? "Oficial Meta" : "QR Code"}</Badge>
                    <Badge variant={st.variant}>{st.label}</Badge>
                    {n.quality_rating && <Badge variant="outline">{QUALITY[n.quality_rating] ?? n.quality_rating}</Badge>}
                    {n.messaging_limit_tier && (
                      <Badge variant="outline">Até {TIER[n.messaging_limit_tier] ?? n.messaging_limit_tier} conversas/dia</Badge>
                    )}
                  </div>
                  {n.status !== "disabled" && (n.health_status === "warning" || n.health_status === "critical") && (
                    <p className={`text-sm ${n.health_status === "critical" ? "text-destructive" : "text-amber-600 dark:text-amber-400"}`}>
                      {n.health_error ?? "Precisa de atenção"}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Última mensagem recebida: {when(lastIn.get(n.id))} · Verificado: {when(n.last_health_check_at)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
        <EmailAccounts orgId={org.id} />
      </main>

      <AddNumberDialog open={adding} orgId={org.id} reconnectId={reconnectId}
        onClose={() => { setAdding(false); load(); }}
        onDone={() => { setAdding(false); load(); }} />

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar número</DialogTitle><DialogDescription>O nome e a cor aparecem para a equipe no atendimento.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Nome</Label>
              <Input value={editing?.name ?? ""} onChange={(e) => editing && setEditing({ ...editing, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Cor</Label>
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button key={c} type="button" aria-label={`Cor ${c}`} onClick={() => editing && setEditing({ ...editing, color: c })}
                    className={`w-8 h-8 rounded-full border-2 ${editing?.color === c ? "border-foreground" : "border-transparent"}`}
                    style={{ background: c }} />
                ))}
              </div></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={saveEdit} disabled={!editing?.name.trim()}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir “{deleting?.name}” definitivamente?</DialogTitle>
            <DialogDescription>
              Isso apaga todas as conversas e mensagens deste número e não pode ser desfeito. Para só parar de
              atender, use “Desativar”.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Para confirmar, digite {deleting?.phone ? "o telefone do número" : "o nome do número"}</Label>
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)}
              placeholder={deleting?.phone ? formatPhone(deleting.phone) : deleting?.name} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={remove} disabled={!confirm.trim()}>Excluir</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
