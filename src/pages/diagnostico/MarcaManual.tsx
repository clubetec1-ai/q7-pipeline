import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";
import { useBrandKit } from "@/components/brand/BrandKit";
import { Button } from "@/components/ui/button";

const HEX = /^#[0-9a-f]{6}$/i;
const rgb = (h: string) => `${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)}`;
// Texto escuro ou claro sobre a cor (legibilidade).
const ink = (h: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#111827" : "#FFFFFF";
};

/**
 * Manual da marca gerado pelo sistema (bônus para quem não tem um): logo, cores com
 * HEX e RGB, fontes, identidade visual e tom de voz do Diagnóstico, numa página pronta
 * para "Salvar em PDF". Usa só o que a empresa cadastrou; o que faltar aparece como pendente.
 */
export default function MarcaManual() {
  const { org } = useOrg();
  const { kit } = useBrandKit(org?.id);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const files = kit?.brand.files ?? [];
  const logos = files.filter((f) => f.kind === "logo");

  useEffect(() => {
    if (!logos.length) return;
    void supabase.storage.from("brand").createSignedUrls(logos.map((f) => f.path), 3600).then(({ data }) => {
      const m: Record<string, string> = {};
      (data ?? []).forEach((d) => { if (d.path && d.signedUrl) m[d.path] = d.signedUrl; });
      setUrls(m);
    });
  }, [kit]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!org || !kit) return null;
  const colors = (kit.brand.colors ?? []).filter((c) => HEX.test(c.hex));
  const main = colors[0]?.hex ?? "#111827";
  const pend = <span className="italic text-gray-400">Ainda não cadastrado no Diagnóstico → Marca.</span>;
  const Section = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
    <section className="break-inside-avoid space-y-3 py-6 border-b border-gray-200">
      <h2 className="text-xl font-bold" style={{ color: main }}>{n}. {title}</h2>
      {children}
    </section>
  );

  return (
    <div className="min-h-screen bg-white text-gray-900 print:bg-white">
      <div className="print:hidden sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-white/95 px-4 py-2">
        <p className="text-sm text-gray-600">Manual da marca gerado pelo Deixa com a IA. Para salvar: <b>Salvar em PDF</b> e escolha "Salvar como PDF" no destino.</p>
        <Button size="sm" onClick={() => window.print()}><Printer className="w-4 h-4 mr-1" /> Salvar em PDF</Button>
      </div>
      <main className="mx-auto max-w-3xl px-8 py-8" style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}>
        <header className="flex min-h-[40vh] flex-col items-center justify-center gap-6 border-b border-gray-200 pb-10 text-center print:min-h-[90vh]">
          {logos[0] && urls[logos[0].path] && <img src={urls[logos[0].path]} alt="Logo" className="max-h-40 max-w-[70%] object-contain" />}
          <h1 className="text-4xl font-bold">{org.name}</h1>
          <p className="text-lg text-gray-500">Manual da marca</p>
          <div className="flex gap-1">{colors.slice(0, 6).map((c) => <span key={c.hex} className="h-3 w-10 rounded" style={{ background: c.hex }} />)}</div>
        </header>

        <Section n={1} title="Logo">
          {logos.length ? (
            <div className="grid grid-cols-2 gap-4">
              {logos.map((f) => (
                <figure key={f.path} className="space-y-1">
                  <div className="flex h-36 items-center justify-center rounded border p-4">{urls[f.path] && <img src={urls[f.path]} alt={f.name} className="max-h-28 max-w-full object-contain" />}</div>
                  <div className="flex h-36 items-center justify-center rounded p-4" style={{ background: main }}>{urls[f.path] && <img src={urls[f.path]} alt="" className="max-h-28 max-w-full object-contain" />}</div>
                  <figcaption className="text-xs text-gray-500">{f.name} — sobre fundo claro e sobre a cor principal</figcaption>
                </figure>
              ))}
            </div>
          ) : pend}
          <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1">
            <li>Deixe um espaço livre ao redor do logo (no mínimo a altura de uma letra do nome).</li>
            <li>Não estique, não gire, não troque as cores e não aplique sombras ou efeitos.</li>
            <li>Use a versão que tiver melhor contraste com o fundo.</li>
          </ul>
        </Section>

        <Section n={2} title="Cores">
          {colors.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {colors.map((c) => (
                <div key={c.hex} className="overflow-hidden rounded border">
                  <div className="flex h-20 items-end p-2 text-sm font-semibold" style={{ background: c.hex, color: ink(c.hex) }}>{c.name || "Cor"}</div>
                  <div className="space-y-0.5 p-2 font-mono text-xs"><p>HEX {c.hex.toUpperCase()}</p><p>RGB {rgb(c.hex)}</p></div>
                </div>
              ))}
            </div>
          ) : pend}
        </Section>

        <Section n={3} title="Tipografia">
          {kit.brand.fonts ? <p className="text-sm whitespace-pre-wrap">{kit.brand.fonts}</p> : pend}
          <p className="text-xs text-gray-500">Use sempre as mesmas fontes em títulos e textos: a repetição é o que faz a marca ser reconhecida.</p>
        </Section>

        <Section n={4} title="Identidade visual">
          {kit.visual ? <p className="text-sm whitespace-pre-wrap">{kit.visual}</p> : pend}
        </Section>

        <Section n={5} title="Tom de voz">
          {kit.voz ? <p className="text-sm whitespace-pre-wrap">{kit.voz}</p> : pend}
        </Section>

        <p className="pt-6 text-center text-xs text-gray-400">Gerado em {new Date().toLocaleDateString("pt-BR")} a partir do Diagnóstico da empresa · Deixa com a IA</p>
      </main>
    </div>
  );
}
