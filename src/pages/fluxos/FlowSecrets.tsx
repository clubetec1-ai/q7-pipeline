import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PROVIDER_LABEL } from "./blocks";

/**
 * Chaves de IA por provedor e segredos do bloco HTTP. Os valores vão direto
 * para o Vault (RPCs com org.settings) e nunca voltam para o navegador:
 * a tela só vê se existe e o nome.
 */
export function FlowSecrets({ orgId }: { orgId: string }) {
  const { toast } = useToast();
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const [keyInput, setKeyInput] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [defProvider, setDefProvider] = useState("groq");
  const [defModel, setDefModel] = useState("");
  const [readMedia, setReadMedia] = useState(true);

  const load = useCallback(async () => {
    const [k, s, o] = await Promise.all([
      supabase.rpc("ai_keys_status", { org: orgId }),
      supabase.rpc("list_http_secrets", { org: orgId }),
      supabase.from("organizations").select("settings").eq("id", orgId).maybeSingle(),
    ]);
    const st = (o.data?.settings ?? {}) as Record<string, unknown>;
    setDefProvider(typeof st.ai_provider === "string" ? st.ai_provider : "groq");
    setDefModel(typeof st.ai_model === "string" ? st.ai_model : "");
    setReadMedia(st.ai_read_media !== false);
    setKeys((k.data as Record<string, boolean> | null) ?? {});
    setSecrets((s.data ?? []).map((x) => x.name));
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);

  const saveKey = async (provider: string) => {
    const v = (keyInput[provider] ?? "").trim();
    if (!v) return;
    const { error } = await supabase.rpc("set_org_secret", { org: orgId, secret_key: `${provider}_api_key`, secret_value: v });
    if (error) return toast({ variant: "destructive", title: "Não foi possível salvar a chave" });
    setKeyInput((x) => ({ ...x, [provider]: "" }));
    toast({ title: `Chave ${PROVIDER_LABEL[provider]} salva` });
    void load();
  };

  /** Provedor padrão: vale para todos os agentes que não escolherem outro. */
  const saveDefault = async () => {
    if (!keys[defProvider]) return toast({ variant: "destructive", title: `Cadastre antes a chave ${PROVIDER_LABEL[defProvider]}` });
    const { data } = await supabase.from("organizations").select("settings").eq("id", orgId).maybeSingle();
    const next = { ...((data?.settings ?? {}) as Record<string, unknown>), ai_provider: defProvider, ai_model: defModel.trim() || null };
    const { error } = await supabase.from("organizations").update({ settings: next as never }).eq("id", orgId);
    if (error) return toast({ variant: "destructive", title: "Sem permissão" });
    toast({ title: `Padrão: ${PROVIDER_LABEL[defProvider]}`, description: "Atendimento, fluxos, follow-ups e entrevistador passam a usar este provedor." });
  };

  /** IA lê imagens (com visão) e PDFs (texto) que o cliente envia. */
  const toggleReadMedia = async (v: boolean) => {
    const { data } = await supabase.from("organizations").select("settings").eq("id", orgId).maybeSingle();
    const next = { ...((data?.settings ?? {}) as Record<string, unknown>), ai_read_media: v };
    const { error } = await supabase.from("organizations").update({ settings: next as never }).eq("id", orgId);
    if (error) return toast({ variant: "destructive", title: "Sem permissão" });
    setReadMedia(v);
    toast({ title: v ? "IA vai ler imagens e PDFs" : "IA não lê mais imagens e PDFs" });
  };

  const saveSecret = async () => {
    const n = name.trim().toLowerCase();
    if (!/^[a-z0-9_]{1,40}$/.test(n)) return toast({ variant: "destructive", title: "Nome: letras minúsculas, números e _" });
    if (!value) return toast({ variant: "destructive", title: "Informe o valor" });
    const { error } = await supabase.rpc("set_http_secret", { org: orgId, secret_key: n, secret_value: value });
    if (error) return toast({ variant: "destructive", title: "Não foi possível salvar", description: error.message });
    setName("");
    setValue("");
    toast({ title: "Segredo salvo" });
    void load();
  };

  const removeSecret = async (n: string) => {
    const { error } = await supabase.rpc("delete_http_secret", { org: orgId, secret_key: n });
    if (error) return toast({ variant: "destructive", title: "Não foi possível apagar" });
    void load();
  };

  return (
    <>
      <section className="space-y-3">
        <h2 className="font-semibold">Chaves de IA</h2>
        <p className="text-xs text-muted-foreground">
          Cada bloco “Agente de IA” escolhe o provedor. A chave fica guardada no cofre e não aparece de novo; para trocar, cole outra.
        </p>
        <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
          <input type="checkbox" className="mt-1" checked={readMedia} onChange={(e) => toggleReadMedia(e.target.checked)} />
          <span>
            <b>IA lê imagens e PDFs que o cliente envia</b> (comprovante, boleto, foto do produto). O que ela ler entra no atendimento
            e aparece como “Lido pela IA”. Imagens usam o provedor padrão (precisa de modelo com visão: Groq, OpenAI, Gemini ou
            Claude); PDFs têm o texto extraído sem IA. Desligue se a empresa não quiser enviar documentos à IA.
          </span>
        </label>
        <div className="rounded-md border p-3 space-y-2">
          <p className="text-sm font-medium">Provedor padrão da empresa</p>
          <p className="text-xs text-muted-foreground">
            Usado por todos os agentes (IA do atendimento, blocos de IA sem provedor escolhido, follow-ups e Diagnóstico).
            A transcrição de áudio continua pela Groq.
          </p>
          <div className="flex flex-wrap gap-2">
            <select className="h-8 rounded-md border bg-background px-2 text-sm" value={defProvider} onChange={(e) => setDefProvider(e.target.value)}>
              {Object.entries(PROVIDER_LABEL).map(([id, label]) => (
                <option key={id} value={id}>{label}{keys[id] ? "" : " (sem chave)"}</option>
              ))}
            </select>
            <Input className="h-8 w-56" placeholder="Modelo (vazio = padrão do provedor)" value={defModel} maxLength={80}
              onChange={(e) => setDefModel(e.target.value)} />
            <Button size="sm" variant="outline" onClick={saveDefault}>Salvar padrão</Button>
          </div>
        </div>
        {Object.entries(PROVIDER_LABEL).map(([id, label]) => (
          <div key={id} className="flex items-center gap-2">
            <span className="w-40 text-sm shrink-0">{label}</span>
            {keys[id] ? <Badge variant="secondary">configurada</Badge> : <Badge variant="outline">sem chave</Badge>}
            <Input type="password" autoComplete="off" className="h-8" placeholder={keys[id] ? "Trocar chave" : "Colar chave"}
              value={keyInput[id] ?? ""} onChange={(e) => setKeyInput((x) => ({ ...x, [id]: e.target.value }))} />
            <Button size="sm" variant="outline" disabled={!(keyInput[id] ?? "").trim()} onClick={() => saveKey(id)}>Salvar</Button>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Segredos do bloco “Consultar sistema”</h2>
        <p className="text-xs text-muted-foreground">
          Tokens de outros sistemas. No bloco, use {"{{segredo.nome}}"} na URL, cabeçalhos ou corpo. O valor não aparece de novo.
        </p>
        {secrets.length > 0 && (
          <div className="divide-y rounded-lg border">
            {secrets.map((s) => (
              <div key={s} className="flex items-center justify-between p-2">
                <code className="text-sm">{`{{segredo.${s}}}`}</code>
                <Button variant="ghost" size="icon" title="Apagar" onClick={() => removeSecret(s)}><Trash2 className="w-4 h-4" /></Button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Input className="w-40" placeholder="nome (ex.: erp)" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          <Input type="password" autoComplete="off" placeholder="valor" maxLength={4000} value={value} onChange={(e) => setValue(e.target.value)} />
          <Button variant="outline" onClick={saveSecret}>Salvar</Button>
        </div>
      </section>
    </>
  );
}
