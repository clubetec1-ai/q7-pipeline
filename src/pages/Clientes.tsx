import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { useNavigate } from "react-router-dom";
import { LogOut, MessageSquare, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { Logo } from "@/components/Logo";
import { MainNav } from "@/components/MainNav";
import { NumberHealthBanner } from "@/components/NumberHealthBanner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ColorPill } from "@/components/ColorTag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ContactSheet } from "./conversas/ContactSheet";

interface Row { id: string; name: string | null; phone: string | null; email: string | null; created_at: string; opted_out_at: string | null }

/**
 * Lista de clientes: busca, grupos coloridos e acesso à ficha. A RLS decide quem
 * cada pessoa vê (atendente: os clientes das conversas que ele pode ver).
 */
export default function Clientes() {
  const { signOut } = useAuth();
  const { org } = useOrg();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<Map<string, { name: string; color: string | null; icon?: string | null }[]>>(new Map());
  const [convOf, setConvOf] = useState<Map<string, string>>(new Map());
  const [open, setOpen] = useState<{ contact: string; conv: string } | null>(null);

  const load = useCallback(async () => {
    if (!org) return;
    let query = supabase.from("contacts").select("id, name, phone, email, created_at, opted_out_at")
      .eq("organization_id", org.id).is("anonymized_at", null).order("created_at", { ascending: false }).limit(200);
    const s = q.trim().replace(/[%,()]/g, "");
    if (s.length >= 2) query = query.or(`name.ilike.%${s}%,phone.ilike.%${s.replace(/\D/g, "") || s}%,email.ilike.%${s}%`);
    const { data } = await query;
    const list = (data as Row[]) ?? [];
    setRows(list);
    const ids = list.map((r) => r.id);
    if (!ids.length) { setGroups(new Map()); setConvOf(new Map()); return; }
    const [gm, g, cv] = await Promise.all([
      supabase.from("contact_group_members").select("contact_id, group_id").in("contact_id", ids),
      supabase.from("contact_groups").select("id, name, color, icon").eq("organization_id", org.id),
      supabase.from("conversations").select("id, contact_id, last_message_at").in("contact_id", ids).order("last_message_at", { ascending: false }),
    ]);
    const byId = new Map((g.data ?? []).map((x) => [x.id, { name: x.name, color: x.color, icon: x.icon }]));
    const m = new Map<string, { name: string; color: string | null; icon?: string | null }[]>();
    for (const r of gm.data ?? []) {
      const grp = byId.get(r.group_id);
      if (grp) m.set(r.contact_id, [...(m.get(r.contact_id) ?? []), grp]);
    }
    setGroups(m);
    const c = new Map<string, string>();
    for (const r of cv.data ?? []) if (r.contact_id && !c.has(r.contact_id)) c.set(r.contact_id, r.id);
    setConvOf(c);
  }, [org, q]);
  useEffect(() => { const t = window.setTimeout(() => void load(), 300); return () => window.clearTimeout(t); }, [load]);

  if (!org) return null;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="clientes" />
      <NumberHealthBanner />

      <main className="flex-1 w-full max-w-5xl mx-auto p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2"><Users className="w-6 h-6" /> Clientes</h1>
            <p className="text-sm text-muted-foreground">Clique no cliente para abrir a ficha (dados, grupos, registros e notas).</p>
          </div>
          <Input className="w-72" placeholder="Buscar nome, telefone ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        <div className="rounded-lg border divide-y">
          {!rows.length && <p className="p-4 text-sm text-muted-foreground">Nenhum cliente encontrado.</p>}
          {rows.map((r) => {
            const conv = convOf.get(r.id);
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-3 p-3 text-sm hover:bg-muted/50">
                <button type="button" className="text-left min-w-0 flex-1" onClick={() => setOpen({ contact: r.id, conv: conv ?? "" })}>
                  <p className="font-medium truncate">{r.name || r.phone || r.email}</p>
                  <p className="text-xs text-muted-foreground truncate">{[r.phone, r.email].filter(Boolean).join(" · ")}{r.opted_out_at ? " · não recebe mensagens automáticas" : ""}</p>
                </button>
                <div className="flex flex-wrap gap-1">{(groups.get(r.id) ?? []).slice(0, 3).map((g) => <ColorPill key={g.name} color={g.color} icon={g.icon}>{g.name}</ColorPill>)}</div>
                <Button size="sm" variant="outline" onClick={() => setOpen({ contact: r.id, conv: conv ?? "" })}>Ver ficha</Button>
                {conv && <Button size="icon" variant="ghost" title="Abrir conversa" onClick={() => navigate(`/?open=${conv}`)}><MessageSquare className="w-4 h-4" /></Button>}
              </div>
            );
          })}
        </div>
        {rows.length === 200 && <p className="text-xs text-muted-foreground">Mostrando os 200 mais recentes. Use a busca para achar outros.</p>}
      </main>

      {open && <ContactSheet open onClose={() => { setOpen(null); void load(); }} contactId={open.contact} conversationId={open.conv} />}
    </div>
  );
}
