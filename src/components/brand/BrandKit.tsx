import { useCallback, useEffect, useState } from "react";
import { BookOpen, Download, FileText, Palette, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { callFunction } from "@/lib/callFunction";
import { logoColors } from "./logoColors";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface BrandColor { name: string; hex: string }
export interface BrandFile { path: string; name: string; kind: "logo" | "manual" }
export interface Brand { colors?: BrandColor[]; fonts?: string; files?: BrandFile[]; use_in_theme?: boolean }
export interface BrandKitData { brand: Brand; voz: string; visual: string }

const HEX = /^#[0-9a-f]{6}$/i;
const NAMES = ["Principal", "Secundária", "Destaque", "Apoio 1", "Apoio 2", "Apoio 3"];

interface Suggest { cores: BrandColor[]; fontes: string; voz: string; notas: string; from: string }
const safeName = (n: string) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._() -]/g, "_").slice(-120);

/** Lê a marca da empresa (dono/admin ou quem cuida de campanhas). */
export function useBrandKit(orgId: string | undefined) {
  const [kit, setKit] = useState<BrandKitData | null>(null);
  const load = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase.rpc("brand_kit", { org: orgId });
    setKit((data as unknown as BrandKitData) ?? { brand: {}, voz: "", visual: "" });
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);
  return { kit, reload: load };
}

/**
 * Manual da marca: cores (nome + código), fontes, logos e o arquivo do manual.
 * Arquivos no bucket privado "brand" ({org}/{arquivo}); links temporários de 1 h.
 * editable: dono/admin no Diagnóstico; sem editable: consulta (Campanhas).
 */
export function BrandKit({ orgId, editable = false, kit, onSaved, onSuggestText }: {
  orgId: string; editable?: boolean; kit: BrandKitData | null; onSaved?: () => void;
  /** Texto sugerido (ex.: tom de voz lido do manual) vai para a caixa da etapa. */
  onSuggestText?: (t: string) => void;
}) {
  const { toast } = useToast();
  const [brand, setBrand] = useState<Brand>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [sug, setSug] = useState<Suggest | null>(null);
  const [reading, setReading] = useState(false);

  // Sugestões: cores do logo (no navegador) + fontes/estilo (IA vendo o logo) + o que o manual define.
  const suggest = async (paths: string[], logoFile?: Blob | string) => {
    setReading(true);
    const local = logoFile ? await logoColors(logoFile) : [];
    const r = await callFunction<{ cores: { nome: string; hex: string }[]; fontes: string; voz: string; notas: string }>("interviewer", {
      action: "brand_suggest", organization_id: orgId, paths,
    });
    setReading(false);
    const fromManual = r.ok ? (r.data.cores ?? []).map((c) => ({ name: c.nome ?? "", hex: c.hex })) : [];
    const cores: BrandColor[] = fromManual.length ? fromManual : local.map((hex, i) => ({ name: NAMES[i] ?? "", hex }));
    if (!cores.length && !(r.ok && (r.data.fontes || r.data.voz))) {
      return toast({ variant: "destructive", title: "Não consegui sugerir agora", description: r.ok ? "Cadastre as cores à mão." : r.message });
    }
    setSug({ cores, fontes: r.ok ? r.data.fontes ?? "" : "", voz: r.ok ? r.data.voz ?? "" : "", notas: r.ok ? r.data.notas ?? "" : "",
      from: fromManual.length ? "do manual da marca" : "do logo" });
  };

  useEffect(() => { setBrand(kit?.brand ?? {}); }, [kit]);
  useEffect(() => {
    const files = kit?.brand?.files ?? [];
    if (!files.length) { setUrls({}); return; }
    void supabase.storage.from("brand").createSignedUrls(files.map((f) => f.path), 3600).then(({ data }) => {
      const m: Record<string, string> = {};
      (data ?? []).forEach((d) => { if (d.path && d.signedUrl) m[d.path] = d.signedUrl; });
      setUrls(m);
    });
  }, [kit]);

  const save = async (next: Brand) => {
    setBrand(next);
    const first = await supabase.from("company_profiles").update({ brand: next as never }, { count: "exact" }).eq("organization_id", orgId);
    let error = first.error;
    if (!error && !first.count) {
      await supabase.from("company_profiles").insert({ organization_id: orgId, sections: {} } as never);
      ({ error } = await supabase.from("company_profiles").update({ brand: next as never }).eq("organization_id", orgId));
    }
    if (error) toast({ variant: "destructive", title: "Não salvou", description: error.message });
    else { onSaved?.(); window.dispatchEvent(new Event("clubecrm:theme-changed")); }
  };
  const upload = async (file: File, kind: BrandFile["kind"]) => {
    if (file.size > 10 * 1024 * 1024) return toast({ variant: "destructive", title: "Arquivo acima de 10 MB" });
    setBusy(true);
    const path = `${orgId}/${Date.now()}-${safeName(file.name)}`;
    const { error } = await supabase.storage.from("brand").upload(path, file, { contentType: file.type });
    setBusy(false);
    if (error) return toast({ variant: "destructive", title: "Não enviou", description: error.message.includes("mime") ? "Use PNG, JPG, WEBP ou PDF" : error.message });
    await save({ ...brand, files: [...(brand.files ?? []), { path, name: file.name.slice(0, 120), kind }] });
    // Assim que chega o logo ou o manual, o sistema já sugere cores e fontes.
    if (editable) void suggest([path], kind === "logo" && file.type.startsWith("image/") ? file : undefined);
  };
  const removeFile = async (f: BrandFile) => {
    if (!window.confirm(`Tirar "${f.name}" da marca?`)) return;
    await supabase.storage.from("brand").remove([f.path]);
    await save({ ...brand, files: (brand.files ?? []).filter((x) => x.path !== f.path) });
  };
  const colors = brand.colors ?? [];
  const setColor = (i: number, patch: Partial<BrandColor>) => setBrand({ ...brand, colors: colors.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const logos = (brand.files ?? []).filter((f) => f.kind === "logo");
  const manuals = (brand.files ?? []).filter((f) => f.kind === "manual");
  const applySug = async () => {
    if (!sug) return;
    const have = new Set(colors.map((c) => c.hex.toUpperCase()));
    const next: Brand = { ...brand, colors: [...colors, ...sug.cores.filter((c) => !have.has(c.hex.toUpperCase()))].slice(0, 12), fonts: brand.fonts || sug.fontes || brand.fonts };
    await save(next);
    if (sug.voz && onSuggestText) onSuggestText(`Tom de voz (do manual da marca): ${sug.voz}`);
    setSug(null);
    toast({ title: "Sugestões aplicadas", description: "Confira e ajuste os nomes e códigos se precisar." });
  };

  const filesBlock = (
    <>
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Logos</p>
        <div className="flex flex-wrap gap-2 items-end">
          {logos.map((f) => (
            <div key={f.path} className="rounded-md border p-1.5 text-center space-y-1 w-28">
              {urls[f.path] && !/\.pdf$/i.test(f.path) ? <img src={urls[f.path]} alt={f.name} className="h-16 w-full object-contain bg-[repeating-conic-gradient(#eee_0_25%,#fff_0_50%)] bg-[length:12px_12px]" /> : <FileText className="w-8 h-8 mx-auto" />}
              <div className="text-xs truncate" title={f.name}>{f.name}</div>
              <div className="flex justify-center gap-1">
                {urls[f.path] && <a href={urls[f.path]} target="_blank" rel="noreferrer" title="Baixar"><Download className="w-3.5 h-3.5" /></a>}
                {editable && <button type="button" title="Tirar" onClick={() => removeFile(f)}><Trash2 className="w-3.5 h-3.5" /></button>}
              </div>
            </div>
          ))}
          {!logos.length && !editable && <span className="text-xs text-muted-foreground">Sem logos.</span>}
          {editable && (
            <label className="inline-flex items-center gap-1 rounded-md border px-2 h-8 text-sm cursor-pointer hover:bg-muted">
              <Upload className="w-4 h-4" /> {busy ? "Enviando…" : "Enviar logo"}
              <input type="file" className="hidden" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f, "logo"); }} />
            </label>
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Manual da marca (se tiver — feito por agência, designer…)</p>
        <div className="flex flex-wrap gap-2 items-center">
          {manuals.map((f) => (
            <span key={f.path} className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs">
              <FileText className="w-3.5 h-3.5" />
              {urls[f.path] ? <a href={urls[f.path]} target="_blank" rel="noreferrer" className="underline">{f.name}</a> : f.name}
              {editable && <button type="button" title="Tirar" onClick={() => removeFile(f)}><Trash2 className="w-3 h-3" /></button>}
            </span>
          ))}
          {!manuals.length && !editable && <span className="text-xs text-muted-foreground">Sem manual anexado.</span>}
          {editable && (
            <label className="inline-flex items-center gap-1 rounded-md border px-2 h-8 text-sm cursor-pointer hover:bg-muted">
              <Upload className="w-4 h-4" /> Enviar manual (PDF)
              <input type="file" className="hidden" accept="application/pdf,image/png,image/jpeg" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f, "manual"); }} />
            </label>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className="rounded-md border p-3 space-y-3">
      <p className="text-sm font-medium flex items-center gap-2"><Palette className="w-4 h-4" /> Kit da marca</p>
      {editable && <p className="text-xs text-muted-foreground"><b>1. Comece pelo logo</b> (e pelo manual da marca, se tiver): o sistema já sugere as cores com os códigos e as fontes. Você só confere.</p>}
      {filesBlock}

      {editable && (reading || sug || logos.length > 0 || manuals.length > 0) && (
        <div className="rounded-md border border-dashed border-primary/50 bg-primary/5 p-2 space-y-2 text-sm">
          {reading && <p className="text-muted-foreground">Lendo o logo/manual para sugerir cores e fontes…</p>}
          {!reading && !sug && (
            <Button size="sm" variant="outline" onClick={() => void suggest([...manuals, ...logos].map((f) => f.path).slice(0, 3), logos[0] && urls[logos[0].path] ? urls[logos[0].path] : undefined)}>
              <Sparkles className="w-4 h-4 mr-1" /> Sugerir cores e fontes a partir do logo/manual
            </Button>
          )}
          {sug && (
            <>
              <p className="font-medium">Sugestões {sug.from} — confira:</p>
              {sug.cores.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {sug.cores.map((c) => (
                    <span key={c.hex} className="inline-flex items-center gap-1 rounded border bg-background px-1.5 py-0.5 text-xs">
                      <span className="h-4 w-4 rounded border" style={{ background: c.hex }} />{c.name && `${c.name} `}<span className="font-mono">{c.hex}</span>
                    </span>
                  ))}
                </div>
              )}
              {sug.fontes && <p className="text-xs"><b>Fontes:</b> {sug.fontes}</p>}
              {sug.voz && <p className="text-xs"><b>Tom de voz (do manual):</b> {sug.voz}</p>}
              {sug.notas && <p className="text-xs text-muted-foreground">{sug.notas}</p>}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void applySug()}>Usar estas sugestões</Button>
                <Button size="sm" variant="ghost" onClick={() => setSug(null)}>Agora não</Button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">{editable ? "2. Cores (ajuste nome e código se precisar)" : "Cores"}</p>
        <div className="flex flex-wrap gap-2">
          {colors.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5 rounded-md border p-1.5">
              {editable
                ? <input type="color" value={HEX.test(c.hex) ? c.hex : "#000000"} onChange={(e) => setColor(i, { hex: e.target.value })} onBlur={() => save(brand)} className="w-7 h-7 rounded cursor-pointer" />
                : <span className="w-7 h-7 rounded border" style={{ background: HEX.test(c.hex) ? c.hex : "#ccc" }} />}
              {editable
                ? <Input className="h-7 w-28 text-xs" value={c.name} placeholder="Nome (ex.: Principal)" onChange={(e) => setColor(i, { name: e.target.value.slice(0, 40) })} onBlur={() => save(brand)} />
                : <span className="text-xs">{c.name}</span>}
              <button type="button" className="text-xs font-mono text-muted-foreground" title="Copiar código" onClick={() => void navigator.clipboard?.writeText(c.hex)}>{c.hex}</button>
              {editable && <button type="button" title="Tirar" onClick={() => save({ ...brand, colors: colors.filter((_, j) => j !== i) })}><Trash2 className="w-3.5 h-3.5" /></button>}
            </div>
          ))}
          {!colors.length && !editable && <span className="text-xs text-muted-foreground">Sem cores cadastradas.</span>}
          {editable && colors.length < 12 && (
            <Button size="sm" variant="outline" onClick={() => save({ ...brand, colors: [...colors, { name: colors.length ? "" : "Principal", hex: "#1E40AF" }] })}><Plus className="w-4 h-4 mr-1" /> Cor</Button>
          )}
        </div>
      </div>

      {editable && colors.length > 0 && (
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={!!brand.use_in_theme} onChange={(e) => save({ ...brand, use_in_theme: e.target.checked })} />
          Usar as cores da marca nas telas do Deixa com a IA (logo e cores em Configurações → Aparência)
        </label>
      )}

      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">{editable ? "3. Fontes" : "Fontes"}</p>
        {editable
          ? <Input className="h-8" value={brand.fonts ?? ""} placeholder="Ex.: títulos em Montserrat, textos em Open Sans" onChange={(e) => setBrand({ ...brand, fonts: e.target.value.slice(0, 200) })} onBlur={() => save(brand)} />
          : <p className="text-sm">{brand.fonts || <span className="text-xs text-muted-foreground">Não informado.</span>}</p>}
      </div>

      {editable && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-2">
          <Button size="sm" variant="outline" onClick={() => window.open("/diagnostico/manual-marca", "_blank")}>
            <BookOpen className="w-4 h-4 mr-1" /> Gerar o manual da marca (PDF)
          </Button>
          <span className="text-xs text-muted-foreground">Logo, cores, fontes e tom de voz num documento pronto para salvar em PDF e mandar para quem faz a sua comunicação.</span>
        </div>
      )}
    </div>
  );
}
