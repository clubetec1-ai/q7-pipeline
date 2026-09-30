import { NumberHealthBanner } from "@/components/NumberHealthBanner";
import { AppHeader } from "@/components/AppHeader";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { Logo } from "@/components/Logo";
import { MainNav } from "@/components/MainNav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEquipeData } from "./equipe/useEquipeData";
import { MembersTab } from "./equipe/MembersTab";
import { GroupsTab } from "./equipe/GroupsTab";
import { GreetingSetting } from "./equipe/GreetingSetting";
import { RamaisTab } from "./equipe/RamaisTab";

/** Equipe: membros, departamentos e grupos da organização ativa (spec §9). */
export default function Equipe() {
  const { signOut } = useAuth();
  const { org, can } = useOrg();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const tab = params.get("tab") ?? "";
  const tabParam = ["membros", "departamentos", "grupos", "ramais"].includes(tab) ? tab : "";
  const data = useEquipeData(org?.id);
  const canMembers = can("members.manage");
  const canDepts = can("departments.manage");

  if (!org) return null;
  if (!canMembers && !canDepts) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="equipe" />
      <NumberHealthBanner />

      <main className="flex-1 w-full max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Equipe e permissões</h1>
          <p className="text-sm text-muted-foreground">{org.name}</p>
        </div>

        <GreetingSetting orgId={org.id} canEdit={can("org.settings")} />

        {data.loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <Tabs key={tabParam} defaultValue={tabParam && (canMembers || tabParam !== "ramais" && tabParam !== "membros") ? tabParam : canMembers ? "membros" : "departamentos"}>
            <TabsList>
              <TabsTrigger value="membros">Membros</TabsTrigger>
              <TabsTrigger value="departamentos">Departamentos</TabsTrigger>
              <TabsTrigger value="grupos">Grupos</TabsTrigger>
              {canMembers && <TabsTrigger value="ramais">Ramais</TabsTrigger>}
            </TabsList>
            <TabsContent value="membros" className="pt-4">
              <MembersTab orgId={org.id} data={data} canManage={canMembers} myRole={org.role} />
            </TabsContent>
            <TabsContent value="departamentos" className="pt-4">
              <GroupsTab kind="departments" orgId={org.id} data={data} canManage={canDepts} />
            </TabsContent>
            <TabsContent value="grupos" className="pt-4">
              <GroupsTab kind="teams" orgId={org.id} data={data} canManage={canDepts} />
            </TabsContent>
            {canMembers && (
              <TabsContent value="ramais" className="pt-4">
                <RamaisTab orgId={org.id} data={data} />
              </TabsContent>
            )}
          </Tabs>
        )}
      </main>
    </div>
  );
}
