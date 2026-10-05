import { useCallback, useEffect, useState } from "react";
import { Copy, Send, Sparkles, UserPlus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { memberNames, type MemberName } from "@/lib/memberNames";
import { Button } from "@/components/ui/button";

interface Textos {
  google_descricao: string; google_categorias: string[]; google_posts: string[];
  instagram_bio: string; facebook_sobre: string; ideias_posts: string[];
}

/** Publicar e medir: textos prontos para o perfil no Google e as redes, no tom da marca (o dono copia). */
export function PresenceTexts({ orgId }: { orgId: string }) {
  const { toast } = useToast();
  const [t, setT] = useState<Textos | null>(null);
  const [busy, setBusy] = useState(false);
  const gen = async () => {
    setBusy(true);
    const r = await callFunction<{ textos: Textos }>("interviewer", { action: "presence_texts", organization_id: orgId });
    setBusy(false);
    if (!r.ok) return toast({ variant: "destructive", title: r.message });
    setT(r.data.textos);
  };
  const copy = (s: string) => { void navigator.clipboard.writeText(s); toast({ title: "Copiado" }); };
  const Item = ({ label, text, hint }: { label: string; text: string; hint?: string }) => (
    <div className="rounded-md border p-2 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">{label}{hint && <span className="font-normal text-muted-foreground"> · {hint}</span>}</p>
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => copy(text)} aria-label={`Copiar ${label}`}><Copy className="w-3.5 h-3.5" /></Button>
      </div>
      <p className="text-sm whitespace-pre-wrap">{text}</p>
    </div>
  );
  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Textos para o Google e as redes</p>
          <p className="text-xs text-muted-foreground">Descrição do perfil no Google (Google Meu Negócio), bio do Instagram, “Sobre” do Facebook e ideias de publicação, no tom da sua marca. Onde faltar dado aparece [preencher].</p>
        </div>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void gen()}>
          <Sparkles className="w-4 h-4 mr-1" /> {busy ? "Escrevendo..." : t ? "Escrever de novo" : "Escrever textos"}
        </Button>
      </div>
      {t && (
        <div className="grid gap-2 md:grid-cols-2">
          <Item label="Google — descrição" hint={`${t.google_descricao.length}/750`} text={t.google_descricao} />
          <div className="space-y-2">
            {!!t.google_categorias.length && <Item label="Google — categorias" text={t.google_categorias.join("\n")} />}
            <Item label="Instagram — bio" hint={`${t.instagram_bio.length}/150`} text={t.instagram_bio} />
            <Item label="Facebook — Sobre" hint={`${t.facebook_sobre.length}/255`} text={t.facebook_sobre} />
          </div>
          {t.google_posts.map((p, i) => <Item key={i} label={`Google — publicação ${i + 1}`} text={p} />)}
          {!!t.ideias_posts.length && <Item label="Ideias de publicação para as redes" text={t.ideias_posts.map((x) => `• ${x}`).join("\n")} />}
        </div>
      )}
    </div>
  );
}

interface Delegation { id: string; user_id: string; status: string; raw: string | null; submitted_at: string | null }

/** Página de processos do setor: convidar o responsável a escrever; o texto volta para o dono revisar. */
export function SectorDelegation({ orgId, setor, onUse }: { orgId: string; setor: string; onUse: (text: string) => void }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Delegation[]>([]);
  const [names, setNames] = useState<Map<string, MemberName>>(new Map());
  const [pick, setPick] = useState("");
  const load = useCallback(async () => {
    const [{ data }, n] = await Promise.all([
      supabase.from("diag_delegations").select("id, user_id, status, raw, submitted_at").eq("organization_id", orgId).eq("setor", setor).neq("status", "used"),
      memberNames(orgId),
    ]);
    setRows((data ?? []) as Delegation[]);
    setNames(n);
  }, [orgId, setor]);
  useEffect(() => { void load(); }, [load]);

  const invite = async () => {
    if (!pick) return;
    const { error } = await supabase.rpc("diag_invite_sector", { org: orgId, p_setor: setor, uid: pick });
    if (error) return toast({ variant: "destructive", title: "Não foi possível convidar", description: error.message });
    toast({ title: "Convite enviado", description: "A pessoa recebe um aviso no sino e vê só este setor." });
    setPick("");
    void load();
  };
  const close = async (d: Delegation, used: boolean) => {
    if (used) onUse(d.raw ?? "");
    const { error } = await supabase.rpc("diag_close_delegation", { delegation: d.id, p_used: used });
    if (error) return toast({ variant: "destructive", title: "Não foi possível", description: error.message });
    if (used) toast({ title: "Texto colocado na caixa", description: "Confira e clique em Organizar com IA." });
    void load();
  };
  const name = (id: string) => names.get(id)?.name ?? "Pessoa da equipe";
  const others = [...names.entries()].filter(([id]) => !rows.some((r) => r.user_id === id));

  return (
    <div className="rounded-md border p-3 space-y-2 bg-muted/30">
      <p className="text-xs flex items-center gap-1"><UserPlus className="w-3.5 h-3.5" /> Quem conhece melhor este setor pode escrever os processos. A pessoa vê só o nome do setor e o que ela escrever; o texto volta para você revisar e aprovar.</p>
      {rows.map((d) => (
        <div key={d.id} className="rounded-md border bg-background p-2 space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>{name(d.user_id)} — {d.status === "submitted" ? <b>enviou o texto</b> : <span className="text-muted-foreground">convidado, ainda não enviou</span>}</span>
            <span className="flex gap-1">
              {d.status === "submitted" && <Button size="sm" onClick={() => void close(d, true)}>Usar este texto</Button>}
              <Button size="sm" variant="ghost" onClick={() => void close(d, false)} aria-label="Cancelar convite"><X className="w-4 h-4" /></Button>
            </span>
          </div>
          {d.status === "submitted" && d.raw && <p className="text-xs whitespace-pre-wrap line-clamp-4 text-muted-foreground">{d.raw}</p>}
        </div>
      ))}
      {others.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <select className="h-8 rounded-md border bg-background px-2 text-sm flex-1 min-w-[10rem]" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Pessoa">
            <option value="">Escolha quem vai escrever…</option>
            {others.map(([id, m]) => <option key={id} value={id}>{m.name}</option>)}
          </select>
          <Button size="sm" variant="outline" disabled={!pick} onClick={() => void invite()}><Send className="w-4 h-4 mr-1" /> Convidar</Button>
        </div>
      )}
    </div>
  );
}
