import { useCallback, useEffect, useState } from "react";
import { Building2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { callFunction } from "@/lib/callFunction";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Official {
  razao_social?: string; nome_fantasia?: string; cnpj?: string; situacao?: string; porte?: string;
  endereco?: { logradouro?: string; numero?: string; complemento?: string; bairro?: string; municipio?: string; uf?: string; cep?: string };
  cnae_principal?: { codigo: string; descricao: string }; cnaes_secundarios?: { codigo: string; descricao: string }[];
}
type Extra = Record<"site" | "email_contato" | "email_encarregado" | "nome_encarregado" | "telefone_suporte", string>;
const EXTRA: [keyof Extra, string][] = [
  ["site", "Site"], ["email_contato", "E-mail de contato"], ["telefone_suporte", "Telefone de suporte"],
  ["nome_encarregado", "Encarregado de dados (LGPD)"], ["email_encarregado", "E-mail do encarregado"],
];
const cnpjFmt = (c = "") => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

/** Plataforma → Dados da Clubetec: o que a Receita mostra do CNPJ (atualiza toda semana) + dados próprios. */
export function CompanyPanel() {
  const { toast } = useToast();
  const [row, setRow] = useState<{ official: Official; extra: Partial<Extra>; refreshed_at: string | null; refresh_error: string | null } | null>(null);
  const [extra, setExtra] = useState<Partial<Extra>>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const { data } = await supabase.from("platform_company").select("official, extra, refreshed_at, refresh_error").maybeSingle();
    const r = data as unknown as typeof row;
    setRow(r);
    setExtra(r?.extra ?? {});
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!row) return null;
  const o = row.official ?? {};
  const e = o.endereco ?? {};

  const refresh = async () => {
    setBusy(true);
    const r = await callFunction("platform-company", { action: "refresh" });
    setBusy(false);
    if (!r.ok) return toast({ variant: "destructive", title: "Não atualizou", description: r.message });
    toast({ title: "Dados atualizados pela Receita" });
    void load();
  };
  const saveExtra = async () => {
    const { error } = await supabase.rpc("platform_set_company_extra", { p_extra: extra as never });
    if (error) return toast({ variant: "destructive", title: "Não salvo", description: error.message });
    toast({ title: "Dados da Clubetec salvos" });
    void load();
  };

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold flex items-center gap-2"><Building2 className="w-4 h-4" /> Dados da Clubetec (fornecedora do software)</h2>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}><RefreshCw className="w-4 h-4 mr-1" /> {busy ? "Atualizando..." : "Atualizar pela Receita"}</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Vem da consulta pública do CNPJ e se atualiza sozinho toda segunda-feira. É o que aparece em termos, privacidade, cobranças e e-mails.
        {row.refreshed_at && ` Última atualização: ${new Date(row.refreshed_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.`}
        {row.refresh_error && <span className="text-danger-text"> {row.refresh_error}</span>}
      </p>
      <div className="grid gap-1 text-sm sm:grid-cols-2">
        <p><b>Razão social:</b> {o.razao_social ?? "—"}</p>
        <p><b>CNPJ:</b> {cnpjFmt(o.cnpj)} · {o.situacao ?? "—"}</p>
        <p><b>Porte:</b> {o.porte ?? "—"}</p>
        <p><b>Endereço:</b> {[e.logradouro, e.numero, e.complemento, e.bairro].filter(Boolean).join(", ")} — {e.municipio}/{e.uf} · CEP {e.cep}</p>
        <p className="sm:col-span-2"><b>Atividade principal:</b> {o.cnae_principal ? `${o.cnae_principal.codigo} — ${o.cnae_principal.descricao}` : "—"}</p>
        {!!o.cnaes_secundarios?.length && (
          <details className="sm:col-span-2 text-xs">
            <summary className="cursor-pointer">{o.cnaes_secundarios.length} atividade(s) secundária(s)</summary>
            <ul className="mt-1 space-y-0.5">{o.cnaes_secundarios.map((c) => <li key={c.codigo}>{c.codigo} — {c.descricao}</li>)}</ul>
          </details>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {EXTRA.map(([k, l]) => (
          <Input key={k} placeholder={l} value={extra[k] ?? ""} maxLength={200} onChange={(ev) => setExtra({ ...extra, [k]: ev.target.value })} aria-label={l} />
        ))}
        <Button variant="outline" onClick={() => void saveExtra()}>Salvar</Button>
      </div>
    </section>
  );
}
