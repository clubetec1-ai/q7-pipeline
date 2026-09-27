import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EquipeData } from "./useEquipeData";
import { MembersPicker } from "./MembersPicker";
import { DistributionSettings } from "./DistributionSettings";

type Kind = "departments" | "teams";

/**
 * Departamentos e grupos têm a mesma cara: lista, criar, renomear, apagar e
 * escolher pessoas. Grupos vivem dentro de um departamento e só aceitam quem
 * é do departamento (o banco também confere).
 */
export function GroupsTab({
  kind, orgId, data, canManage,
}: { kind: Kind; orgId: string; data: EquipeData; canManage: boolean }) {
  const { toast } = useToast();
  const { members, departments, deptMembers, teams, teamMembers, reload } = data;
  const isTeams = kind === "teams";
  const [deptFilter, setDeptFilter] = useState<string>(departments[0]?.id ?? "");
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [picking, setPicking] = useState<{ id: string; name: string } | null>(null);

  const deptId = deptFilter || departments[0]?.id || "";
  const items = isTeams
    ? teams.filter((t) => t.department_id === deptId).map((t) => ({ id: t.id, name: t.name }))
    : departments.map((d) => ({ id: d.id, name: d.name }));
  const links = isTeams ? teamMembers : deptMembers;
  const activeMembers = members.filter((m) => m.status !== "disabled");
  const candidates = useMemo(
    () => (isTeams
      ? activeMembers.filter((m) => deptMembers.some((l) => l.a === deptId && l.user_id === m.user_id))
      : activeMembers),
    [isTeams, activeMembers, deptMembers, deptId],
  );

  const fail = (msg: string) => {
    toast({ variant: "destructive", title: msg });
  };
  const label = isTeams ? "grupo" : "departamento";

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    const { error } = isTeams
      ? await supabase.from("teams").insert({ organization_id: orgId, department_id: deptId, name })
      : await supabase.from("departments").insert({ organization_id: orgId, name });
    if (error) return fail(error.code === "23505" ? `Já existe um ${label} com esse nome` : `Não foi possível criar o ${label}`);
    setNewName("");
    await reload();
  };

  const rename = async () => {
    if (!renaming?.name.trim()) return;
    const { error } = await supabase.from(kind).update({ name: renaming.name.trim() }).eq("id", renaming.id);
    if (error) return fail(`Não foi possível renomear o ${label}`);
    setRenaming(null);
    await reload();
  };

  const remove = async () => {
    if (!deleting) return;
    const { error } = await supabase.from(kind).delete().eq("id", deleting.id);
    if (error) fail(`Não foi possível apagar o ${label}`);
    setDeleting(null);
    await reload();
  };

  const saveMembers = async (added: string[], removed: string[]) => {
    if (!picking) return;
    const table = isTeams ? "team_members" : "department_members";
    const col = isTeams ? "team_id" : "department_id";
    if (added.length) {
      const rows = added.map((user_id) => ({ [col]: picking.id, user_id, organization_id: orgId }));
      const { error } = await supabase.from(table).insert(rows as never);
      if (error) return fail("Não foi possível adicionar as pessoas");
    }
    if (removed.length) {
      const { error } = await supabase.from(table).delete().eq(col as never, picking.id).in("user_id", removed);
      if (error) return fail("Não foi possível retirar as pessoas");
    }
    setPicking(null);
    await reload();
  };

  if (isTeams && departments.length === 0) {
    return <p className="text-sm text-muted-foreground">Crie um departamento primeiro: os grupos ficam dentro dele.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {isTeams
          ? "Grupos dividem um departamento em equipes menores (ex.: Vendas → Varejo e Atacado)."
          : "Departamentos organizam quem atende o quê. Atendentes veem a fila dos departamentos deles."}
      </p>

      {isTeams && (
        <Select value={deptId} onValueChange={setDeptFilter}>
          <SelectTrigger className="w-[240px]"><SelectValue placeholder="Departamento" /></SelectTrigger>
          <SelectContent>
            {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}

      {canManage && (
        <div className="flex gap-2 max-w-md">
          <Input placeholder={`Nome do novo ${label}`} value={newName}
            onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
          <Button onClick={create} disabled={!newName.trim()}><Plus className="w-4 h-4 mr-1" /> Criar</Button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.length === 0 && <p className="text-sm text-muted-foreground">Nenhum {label} ainda.</p>}
        {items.map((it) => {
          const count = links.filter((l) => l.a === it.id).length;
          return (
            <div key={it.id} className="rounded-lg border p-4 space-y-3">
              {renaming?.id === it.id ? (
                <div className="flex gap-2">
                  <Input value={renaming.name} autoFocus
                    onChange={(e) => setRenaming({ id: it.id, name: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && rename()} />
                  <Button size="sm" onClick={rename}>OK</Button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium truncate">{it.name}</p>
                  {canManage && (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Renomear"
                        onClick={() => setRenaming(it)}><Pencil className="w-4 h-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Apagar"
                        onClick={() => setDeleting(it)}><Trash2 className="w-4 h-4" /></Button>
                    </div>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {count} {count === 1 ? "pessoa" : "pessoas"}
                </span>
                {canManage && (
                  <Button variant="outline" size="sm" onClick={() => setPicking(it)}>
                    <Users className="w-4 h-4 mr-1" /> Pessoas
                  </Button>
                )}
              </div>
              {!isTeams && (
                <DistributionSettings dept={departments.find((d) => d.id === it.id)} canManage={canManage} onSaved={reload} />
              )}
            </div>
          );
        })}
      </div>

      <MembersPicker
        open={!!picking}
        title={`Pessoas em ${picking?.name ?? ""}`}
        description={isTeams ? "Só aparecem pessoas do departamento deste grupo." : "Marque quem faz parte deste departamento."}
        candidates={candidates}
        selected={picking ? links.filter((l) => l.a === picking.id).map((l) => l.user_id) : []}
        onClose={() => setPicking(null)}
        onSave={saveMembers}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar {label} “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {isTeams
                ? "As pessoas continuam no departamento; só o grupo deixa de existir."
                : "As conversas deste departamento voltam para a fila geral e os grupos dele são apagados."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Apagar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
