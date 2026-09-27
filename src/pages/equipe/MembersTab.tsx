import { useState } from "react";
import { MoreHorizontal, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EquipeData, Member, ROLE_LABEL, STATUS_LABEL } from "./useEquipeData";

/** Chama a Edge Function manage-members e devolve a mensagem de erro legível. */
async function membersAction(orgId: string, action: string, payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("manage-members", {
    body: { action, organization_id: orgId, ...payload },
  });
  if (!error && data?.ok) return { ok: true as const, data };
  let message = data?.error as string | undefined;
  if (!message && error && "context" in error) {
    try {
      message = (await (error as { context: Response }).context.json())?.error;
    } catch {
      // resposta sem corpo JSON
    }
  }
  return { ok: false as const, message: message || "Não foi possível concluir a ação" };
}

export function MembersTab({
  orgId, data, canManage, myRole,
}: { orgId: string; data: EquipeData; canManage: boolean; myRole: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { members, departments, deptMembers, reload } = data;
  const isOwner = myRole === "owner";
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("agent");
  const [depts, setDepts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);

  const run = async (action: string, payload: Record<string, unknown>, success: string) => {
    setBusy(true);
    const r = await membersAction(orgId, action, payload);
    setBusy(false);
    if (!r.ok) {
      toast({ variant: "destructive", title: r.message });
      return false;
    }
    toast({ title: success });
    await reload();
    return true;
  };

  const invite = async () => {
    const ok = await run("invite", { email, role, department_ids: depts }, "Convite enviado");
    if (ok) {
      setInviteOpen(false);
      setEmail("");
      setRole("agent");
      setDepts([]);
    }
  };

  const deptNames = (uid: string) =>
    deptMembers
      .filter((l) => l.user_id === uid)
      .map((l) => departments.find((d) => d.id === l.a)?.name)
      .filter(Boolean)
      .join(", ");

  // Só owner atribui ou altera o papel de owner (o servidor também confere).
  const roleOptions = isOwner ? ["owner", "admin", "supervisor", "agent"] : ["admin", "supervisor", "agent"];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {members.filter((m) => m.status === "active").length} ativos ·{" "}
          {members.filter((m) => m.status === "invited").length} convites pendentes
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus className="w-4 h-4 mr-2" /> Convidar pessoa
          </Button>
        )}
      </div>

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pessoa</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="hidden md:table-cell">Departamentos</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => {
              const isSelf = m.user_id === user?.id;
              const lockedOwner = m.role === "owner" && !isOwner;
              return (
                <TableRow key={m.user_id}>
                  <TableCell>
                    <div className="font-medium">{m.name}{isSelf && <span className="text-muted-foreground"> (você)</span>}</div>
                    <div className="text-xs text-muted-foreground">{m.email}</div>
                  </TableCell>
                  <TableCell>
                    {canManage && !lockedOwner && !isSelf ? (
                      <Select value={m.role} disabled={busy}
                        onValueChange={(v) => run("change_role", { user_id: m.user_id, role: v }, "Papel alterado")}>
                        <SelectTrigger className="h-8 w-[150px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {roleOptions.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-sm">{ROLE_LABEL[m.role] ?? m.role}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={m.status === "active" ? "secondary" : m.status === "invited" ? "outline" : "destructive"}>
                      {STATUS_LABEL[m.status] ?? m.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                    {deptNames(m.user_id) || "—"}
                  </TableCell>
                  <TableCell>
                    {canManage && !lockedOwner && !isSelf && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Ações">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {m.status === "invited" && (
                            <DropdownMenuItem onClick={() => run("resend", { user_id: m.user_id }, "Convite reenviado")}>
                              Reenviar convite
                            </DropdownMenuItem>
                          )}
                          {m.status === "active" && (
                            <DropdownMenuItem onClick={() => run("disable", { user_id: m.user_id }, "Acesso desativado")}>
                              Desativar acesso
                            </DropdownMenuItem>
                          )}
                          {m.status === "disabled" && (
                            <DropdownMenuItem onClick={() => run("enable", { user_id: m.user_id }, "Acesso reativado")}>
                              Reativar acesso
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem className="text-destructive" onClick={() => setRemoving(m)}>
                            Remover da equipe
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convidar pessoa</DialogTitle>
            <DialogDescription>
              A pessoa recebe um e-mail para criar a senha. Se já tiver conta, o convite aparece quando ela entrar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="convite-email">E-mail</Label>
              <Input id="convite-email" type="email" placeholder="nome@empresa.com.br" value={email}
                onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Papel</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roleOptions.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Atendente vê as conversas dele e a fila dos departamentos dele. Supervisor vê o departamento
                inteiro. Administrador vê tudo e configura a empresa.
              </p>
            </div>
            {departments.length > 0 && (
              <div className="space-y-2">
                <Label>Departamentos</Label>
                <div className="grid grid-cols-2 gap-2">
                  {departments.map((d) => (
                    <label key={d.id} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={depts.includes(d.id)}
                        onCheckedChange={(c) => setDepts((cur) => (c ? [...cur, d.id] : cur.filter((x) => x !== d.id)))} />
                      {d.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancelar</Button>
            <Button onClick={invite} disabled={busy || !email.trim()}>{busy ? "Enviando..." : "Enviar convite"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover {removing?.name} da equipe?</AlertDialogTitle>
            <AlertDialogDescription>
              A pessoa perde o acesso a esta empresa. As conversas que ela atendeu continuam no sistema.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (removing) await run("remove", { user_id: removing.user_id }, "Removido da equipe");
                setRemoving(null);
              }}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
