import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowLeft, Palette, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";
import { useToast } from "@/hooks/use-toast";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBrandKit, type Brand } from "@/components/brand/BrandKit";
import { themeFor } from "@/components/OrgTheme";

type Theme = { primary?: string; secondary?: string; logo?: string };
type BrandWithTheme = Brand & { theme?: Theme };

const HEX = /^#[0-9a-f]{6}$/i;
const DEFAULT_PRIMARY = "#22C1A4";
const DEFAULT_SECONDARY = "#215371";
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="space-y-1 text-sm">
      <span>{label}</span>
      <div className="flex items-center gap-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="w-10 h-9 rounded cursor-pointer border" aria-label={label} />
        <Input className="h-9 w-28 font-mono" value={text} maxLength={7}
          onChange={(e) => { setText(e.target.value); if (HEX.test(e.target.value)) onChange(e.target.value); }} />
      </div>
    </label>
  );
}

/**
 * Configurações → Aparência (dono/admin): logo da empresa no cabeçalho e cores
 * principal e secundária nas telas. Fica no kit da marca (o mesmo do Diagnóstico).
 */
export default function ConfigAparencia() {
  const { org, can } = useOrg();
  const { toast } = useToast();
  const { kit, reload } = useBrandKit(org?.id);
  const [brand, setBrand] = useState<BrandWithTheme>({});
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setBrand((kit?.brand ?? {}) as BrandWithTheme); }, [kit]);
  const theme = brand.theme ?? {};
  useEffect(() => {
    if (!theme.logo) { setLogoUrl(null); return; }
    void supabase.storage.from("brand").createSignedUrl(theme.logo, 3600).then(({ data }) => setLogoUrl(data?.signedUrl ?? null));
  }, [theme.logo]);

  if (!org) return null;
  if (!can("org.settings")) return <Navigate to="/configuracoes" replace />;

  const primary = HEX.test(theme.primary ?? "") ? theme.primary! : (brand.colors?.[0]?.hex && HEX.test(brand.colors[0].hex) ? brand.colors[0].hex : DEFAULT_PRIMARY);
  const secondary = HEX.test(theme.secondary ?? "") ? theme.secondary! : (brand.colors?.[1]?.hex && HEX.test(brand.colors[1].hex) ? brand.colors[1].hex : DEFAULT_SECONDARY);

  const save = async (next: BrandWithTheme, msg?: string) => {
    setBrand(next);
    const upd = await supabase.from("company_profiles").update({ brand: next as never }, { count: "exact" }).eq("organization_id", org.id);
    let error = upd.error;
    if (!error && !upd.count) {
      await supabase.from("company_profiles").insert({ organization_id: org.id, sections: {} } as never);
      ({ error } = await supabase.from("company_profiles").update({ brand: next as never }).eq("organization_id", org.id));
    }
    if (error) return toast({ variant: "destructive", title: "Não salvou", description: error.message });
    if (msg) toast({ title: msg });
    window.dispatchEvent(new Event("clubecrm:theme-changed"));
    void reload();
  };

  const uploadLogo = async (file: File) => {
    const ext = EXT[file.type];
    if (!ext) return toast({ variant: "destructive", title: "Use PNG, JPG ou WEBP" });
    if (file.size > 2 * 1024 * 1024) return toast({ variant: "destructive", title: "Logo acima de 2 MB" });
    setBusy(true);
    const path = `${org.id}/logo-telas-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("brand").upload(path, file, { contentType: file.type });
    setBusy(false);
    if (error) return toast({ variant: "destructive", title: "Não enviou", description: error.message });
    const old = theme.logo;
    await save({ ...brand, theme: { ...theme, logo: path } }, "Logo atualizado");
    if (old && old !== path) await supabase.storage.from("brand").remove([old]);
  };
  const removeLogo = async () => {
    const old = theme.logo;
    await save({ ...brand, theme: { ...theme, logo: undefined } }, "Logo removido");
    if (old) await supabase.storage.from("brand").remove([old]);
  };
  const setColors = (patch: Theme) => setBrand({ ...brand, theme: { ...theme, ...patch } });

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader active="configuracoes" />
      <main className="flex-1 w-full max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
        <div>
          <Link to="/configuracoes" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"><ArrowLeft className="w-4 h-4" /> Configurações</Link>
          <h1 className="text-2xl font-semibold flex items-center gap-2 mt-1"><Palette className="w-6 h-6" /> Aparência</h1>
          <p className="text-sm text-muted-foreground">O logo e as cores da sua empresa nas telas da sua equipe. Seus clientes não veem estas telas.</p>
        </div>

        <section className="rounded-xl border bg-card p-5 space-y-3">
          <p className="font-medium">Logo da empresa</p>
          <div className="flex flex-wrap items-center gap-4">
            <div className="h-20 w-40 rounded-md border flex items-center justify-center bg-[repeating-conic-gradient(#eee_0_25%,#fff_0_50%)] bg-[length:12px_12px]">
              {logoUrl ? <img src={logoUrl} alt="Logo da empresa" className="max-h-16 max-w-[9rem] object-contain" /> : <span className="text-xs text-muted-foreground">Sem logo</span>}
            </div>
            <div className="flex gap-2">
              <label className="inline-flex items-center gap-1 rounded-md border px-3 h-9 text-sm cursor-pointer hover:bg-muted">
                <Upload className="w-4 h-4" /> {busy ? "Enviando…" : logoUrl ? "Trocar logo" : "Enviar logo"}
                <input type="file" className="hidden" accept="image/png,image/jpeg,image/webp" disabled={busy}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadLogo(f); }} />
              </label>
              {logoUrl && <Button variant="outline" onClick={() => void removeLogo()}>Remover</Button>}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">PNG com fundo transparente fica melhor. Até 2 MB. Aparece no topo das telas, ao lado do Deixa com a IA.</p>
        </section>

        <section className="rounded-xl border bg-card p-5 space-y-4">
          <p className="font-medium">Cores</p>
          <div className="flex flex-wrap gap-6">
            <ColorField label="Cor principal (botões e destaques)" value={primary} onChange={(v) => setColors({ primary: v })} />
            <ColorField label="Cor secundária (faixa do topo)" value={secondary} onChange={(v) => setColors({ secondary: v })} />
          </div>
          <div className="rounded-md border overflow-hidden" aria-label="Prévia">
            <div className="h-1.5" style={{ background: secondary }} />
            <div className="p-3 flex items-center gap-3">
              <span className="rounded-md px-3 h-8 inline-flex items-center text-sm font-medium" style={{ background: primary, color: themeFor(primary).fgHex }}>Botão</span>
              <span className="text-sm" style={{ color: `hsl(${themeFor(primary).light.text})` }}>Link e destaque</span>
              <span className="ml-auto text-xs text-muted-foreground">Prévia</span>
            </div>
          </div>
          {!themeFor(primary).readable && (
            <p className="text-xs text-warning-text bg-warning-soft rounded-md px-3 py-2">O texto dos botões pode ficar difícil de ler com esta cor principal. Prefira um tom mais escuro ou mais claro.</p>
          )}
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={!!brand.use_in_theme} onChange={(e) => setBrand({ ...brand, use_in_theme: e.target.checked })} />
            Usar estas cores nas telas (desligado, fica o verde do Deixa com a IA)
          </label>
          <div className="flex gap-2">
            <Button onClick={() => void save({ ...brand, theme: { ...theme, primary, secondary } }, "Cores salvas")}>Salvar cores</Button>
            {brand.use_in_theme && (
              <Button variant="outline" onClick={() => void save({ ...brand, use_in_theme: false }, "Voltou ao padrão")}>Voltar ao padrão</Button>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
