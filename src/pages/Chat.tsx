import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { useNavigate } from "react-router-dom";
import { AtSign, Hash, LogOut, MessageSquare, MessagesSquare, Paperclip, Plus, Send, Share2, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { memberNames } from "@/lib/memberNames";
import { Logo } from "@/components/Logo";
import { MainNav } from "@/components/MainNav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface Channel { id: string; kind: "geral" | "setor" | "direto"; name: string; dm_key: string | null }
interface Msg {
  id: number; channel_id: string; author_id: string; content: string | null; mentions: string[];
  attachment_path: string | null; attachment_name: string | null; conversation_id: string | null; created_at: string;
}

/** Chat interno da equipe: Geral (todos), um canal por setor e conversas diretas. */
export default function Chat() {
  const { signOut, user } = useAuth();
  const { org } = useOrg();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [unread, setUnread] = useState<Map<string, number>>(new Map());
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [panel, setPanel] = useState<"mention" | "direct" | "share" | null>(null);
  const [q, setQ] = useState("");
  const [convs, setConvs] = useState<{ id: string; contact_name: string | null; contact_phone: string | null }[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);

  const loadChannels = useCallback(async () => {
    if (!org) return;
    await supabase.rpc("ensure_team_channels", { org: org.id } as never);
    const [c, u, m] = await Promise.all([
      supabase.from("team_channels").select("id, kind, name, dm_key").eq("organization_id", org.id).order("name"),
      supabase.rpc("team_unread", { org: org.id } as never),
      memberNames(org.id),
    ]);
    const list = (c.data as Channel[]) ?? [];
    setChannels(list);
    setUnread(new Map(((u.data as { channel_id: string; unread: number }[]) ?? []).map((x) => [x.channel_id, Number(x.unread)])));
    setNames(new Map([...m].map(([k, v]) => [k, v.name])));
    setActive((a) => a ?? list.find((x) => x.kind === "geral")?.id ?? list[0]?.id ?? null);
  }, [org]);
  useEffect(() => { void loadChannels(); }, [loadChannels]);

  // Mensagens do canal + tempo real + marcar como lido.
  useEffect(() => {
    if (!active || !org) return;
    let alive = true;
    void supabase.from("team_messages").select("*").eq("channel_id", active).order("id", { ascending: false }).limit(100)
      .then(({ data }) => { if (alive) setMsgs(((data as Msg[]) ?? []).reverse()); });
    const ch = supabase.channel(`team-${active}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "team_messages", filter: `channel_id=eq.${active}` },
        (p) => setMsgs((m) => (m.some((x) => x.id === (p.new as Msg).id) ? m : [...m, p.new as Msg])))
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [active, org]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
    const last = msgs[msgs.length - 1];
    if (last && active && org && user) {
      void supabase.from("team_reads").upsert({ organization_id: org.id, channel_id: active, user_id: user.id, last_read_id: last.id } as never, { onConflict: "channel_id,user_id" });
      setUnread((u) => { const n = new Map(u); n.delete(active); return n; });
    }
  }, [msgs, active, org, user]);

  const label = useCallback((c: Channel) => {
    if (c.kind !== "direto" || !user) return c.name;
    const other = (c.dm_key ?? "").split(":").find((id) => id !== user.id);
    return names.get(other ?? "") ?? "Conversa direta";
  }, [names, user]);
  const groups = useMemo(() => ({
    geral: channels.filter((c) => c.kind === "geral"),
    setor: channels.filter((c) => c.kind === "setor"),
    direto: channels.filter((c) => c.kind === "direto"),
  }), [channels]);

  if (!org || !user) return null;
  const current = channels.find((c) => c.id === active);
  const fail = (t: string) => toast({ variant: "destructive", title: t });

  const send = async (extra: Partial<Msg> = {}) => {
    if (!active || (!text.trim() && !extra.attachment_path && !extra.conversation_id)) return;
    setBusy(true);
    const { error } = await supabase.from("team_messages").insert({
      organization_id: org.id, channel_id: active, author_id: user.id, content: text.trim() || extra.content || null,
      mentions: mentions.filter((m) => text.includes(`@${names.get(m)}`)), ...extra,
    } as never);
    setBusy(false);
    if (error) return fail("Não enviado");
    setText(""); setMentions([]); setPanel(null);
  };
  const attach = async (file: File) => {
    if (!active) return;
    if (file.size > 15 * 1024 * 1024) return fail("Arquivo acima de 15 MB");
    const safe = file.name.replace(/[^A-Za-z0-9._() -]/g, "_").slice(0, 120);
    const path = `${org.id}/${active}/${crypto.randomUUID().slice(0, 8)}-${safe}`;
    setBusy(true);
    const { error } = await supabase.storage.from("team").upload(path, file, { contentType: file.type || undefined });
    setBusy(false);
    if (error) return fail("Não foi possível anexar");
    await send({ attachment_path: path, attachment_name: file.name, content: text.trim() || null });
  };
  const openFile = async (path: string) => {
    const { data } = await supabase.storage.from("team").createSignedUrl(path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  };
  const searchConvs = async (v: string) => {
    setQ(v);
    const s = v.trim().replace(/[%,()]/g, "");
    if (s.length < 2) return setConvs([]);
    const digits = s.replace(/\D/g, "");
    const { data } = await supabase.from("conversations").select("id, contact_name, contact_phone").eq("organization_id", org.id)
      .or(digits.length >= 4 ? `contact_phone.ilike.%${digits}%,contact_name.ilike.%${s}%` : `contact_name.ilike.%${s}%`).limit(8);
    setConvs(data ?? []);
  };
  const openDirect = async (other: string) => {
    const { data, error } = await supabase.rpc("open_direct_chat", { org: org.id, other } as never);
    if (error) return fail("Não foi possível abrir");
    setPanel(null);
    await loadChannels();
    setActive(data as unknown as string);
  };

  const people = [...names].filter(([id]) => id !== user.id);
  const chBtn = (c: Channel, icon: JSX.Element) => (
    <button key={c.id} type="button" onClick={() => setActive(c.id)}
      className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left ${active === c.id ? "bg-muted font-medium text-foreground" : "hover:bg-muted"}`}>
      {icon}<span className="truncate flex-1">{label(c)}</span>
      {!!unread.get(c.id) && active !== c.id && <span className="rounded-full bg-primary text-primary-foreground text-xs px-1.5">{unread.get(c.id)}</span>}
    </button>
  );

  return (
    <div className="h-screen flex flex-col bg-background">
      <AppHeader active="chat" />

      <div className="flex-1 min-h-0 grid md:grid-cols-[240px_1fr]">
        <aside className="border-r p-2 space-y-3 overflow-y-auto">
          <p className="px-2 text-sm font-semibold flex items-center gap-2"><MessagesSquare className="w-4 h-4" /> Chat da equipe</p>
          <div className="space-y-0.5">{groups.geral.map((c) => chBtn(c, <Hash className="w-4 h-4 shrink-0" />))}</div>
          {groups.setor.length > 0 && <div className="space-y-0.5"><p className="px-2 text-xs text-muted-foreground">Setores</p>{groups.setor.map((c) => chBtn(c, <Hash className="w-4 h-4 shrink-0" />))}</div>}
          <div className="space-y-0.5">
            <div className="flex items-center justify-between px-2">
              <p className="text-xs text-muted-foreground">Diretas</p>
              <button type="button" title="Nova conversa direta" onClick={() => setPanel(panel === "direct" ? null : "direct")}><Plus className="w-4 h-4" /></button>
            </div>
            {panel === "direct" && (
              <div className="rounded-md border p-1 space-y-0.5 max-h-48 overflow-y-auto">
                {people.map(([id, n]) => (
                  <button key={id} type="button" className="w-full text-left text-sm px-2 py-1 rounded hover:bg-muted" onClick={() => openDirect(id)}>{n}</button>
                ))}
              </div>
            )}
            {groups.direto.map((c) => chBtn(c, <User className="w-4 h-4 shrink-0" />))}
          </div>
        </aside>

        <section className="flex flex-col min-h-0">
          <div className="border-b px-4 py-2 text-sm font-medium flex items-center gap-2">
            {current?.kind === "direto" ? <User className="w-4 h-4" /> : <Hash className="w-4 h-4" />}{current ? label(current) : ""}
            <span className="text-xs text-muted-foreground font-normal">
              {current?.kind === "geral" ? "todos da empresa" : current?.kind === "setor" ? "pessoas do setor + gestão" : current?.kind === "direto" ? "só vocês dois" : ""}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {!msgs.length && <p className="text-sm text-muted-foreground">Nenhuma mensagem ainda.</p>}
            {msgs.map((m) => {
              const mine = m.author_id === user.id;
              return (
                <div key={m.id} className={mine ? "text-right" : ""}>
                  <div className={`inline-block max-w-[80%] px-3 py-2 text-sm text-left ${mine ? "rounded-2xl rounded-br-md bg-primary/10 ring-1 ring-inset ring-primary/20" : "rounded-2xl rounded-bl-md border bg-card"}`}>
                    {!mine && <p className="text-xs font-medium opacity-80">{names.get(m.author_id) ?? "Alguém"}</p>}
                    {m.content && <p className="whitespace-pre-wrap">{m.content}</p>}
                    {m.attachment_path && (
                      <button type="button" className="mt-1 inline-flex items-center gap-1 underline text-xs" onClick={() => openFile(m.attachment_path!)}>
                        <Paperclip className="w-3 h-3" />{m.attachment_name ?? "anexo"}
                      </button>
                    )}
                    {m.conversation_id && (
                      <button type="button" className="mt-1 flex items-center gap-1 underline text-xs" onClick={() => navigate(`/?open=${m.conversation_id}`)}>
                        <MessageSquare className="w-3 h-3" /> Abrir atendimento compartilhado
                      </button>
                    )}
                    <p className="text-xs opacity-60 mt-0.5">{new Date(m.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</p>
                  </div>
                </div>
              );
            })}
            <div ref={end} />
          </div>

          {panel === "mention" && (
            <div className="border-t p-2 flex flex-wrap gap-1">
              {people.map(([id, n]) => (
                <Button key={id} size="sm" variant="outline" onClick={() => { setText((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}@${n} `); setMentions((m) => [...new Set([...m, id])]); setPanel(null); }}>@{n}</Button>
              ))}
            </div>
          )}
          {panel === "share" && (
            <div className="border-t p-2 space-y-1">
              <Input className="max-w-sm h-8" placeholder="Buscar atendimento por nome ou telefone" value={q} onChange={(e) => void searchConvs(e.target.value)} />
              <div className="flex flex-wrap gap-1">
                {convs.map((c) => (
                  <Button key={c.id} size="sm" variant="outline"
                    onClick={() => send({ conversation_id: c.id, content: text.trim() || `Atendimento: ${c.contact_name || c.contact_phone}` })}>
                    {c.contact_name || c.contact_phone}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <div className="border-t p-2 flex items-end gap-2">
            <div className="flex gap-1">
              <Button size="icon" variant="ghost" title="Mencionar alguém" onClick={() => setPanel(panel === "mention" ? null : "mention")}><AtSign className="w-4 h-4" /></Button>
              <Button size="icon" variant="ghost" title="Anexar arquivo" disabled={busy} onClick={() => fileInput.current?.click()}><Paperclip className="w-4 h-4" /></Button>
              <Button size="icon" variant="ghost" title="Compartilhar atendimento" onClick={() => setPanel(panel === "share" ? null : "share")}><Share2 className="w-4 h-4" /></Button>
              <input ref={fileInput} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void attach(f); }} />
            </div>
            <Textarea rows={1} className="min-h-9" value={text} placeholder={current ? `Mensagem para ${label(current)}` : ""} maxLength={4000}
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
            <Button size="icon" disabled={busy || !text.trim()} onClick={() => send()} title="Enviar"><Send className="w-4 h-4" /></Button>
          </div>
        </section>
      </div>
    </div>
  );
}
