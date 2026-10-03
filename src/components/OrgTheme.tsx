import { useEffect, useState, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";

/** #RRGGBB → "H S% L%" (formato das variáveis do tema) e se o texto por cima deve ser escuro. */
export function toHsl(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return { hsl: `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`, darkText: lum > 0.6 };
}

const HEX = /^#[0-9a-f]{6}$/i;
const VARS = ["--primary", "--primary-foreground", "--ring", "--brand-secondary"];

/** Logo da empresa (link temporário) para o cabeçalho; muda junto com a empresa selecionada. */
let logoUrl: string | null = null;
const listeners = new Set<() => void>();
const setLogo = (u: string | null) => { if (u !== logoUrl) { logoUrl = u; listeners.forEach((l) => l()); } };
export function useOrgLogo() {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => logoUrl);
}

/**
 * Aparência da empresa (Configurações → Aparência): cor principal e secundária nas
 * telas, quando o dono ligar, e o logo no cabeçalho. Trocar de empresa ou desligar
 * volta ao padrão do Deixa com a IA.
 */
export function OrgTheme() {
  const { org } = useOrg();
  // A tela de aparência avisa quando o dono muda algo: aplica de novo.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener("clubecrm:theme-changed", bump);
    return () => window.removeEventListener("clubecrm:theme-changed", bump);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    const reset = () => { VARS.forEach((v) => root.style.removeProperty(v)); setLogo(null); };
    if (!org) { reset(); return; }
    let alive = true;
    void supabase.rpc("org_theme", { org: org.id }).then(async ({ data }) => {
      if (!alive) return;
      const t = (data ?? {}) as { primary?: string; secondary?: string; logo?: string };
      VARS.forEach((v) => root.style.removeProperty(v));
      if (t.primary && HEX.test(t.primary)) {
        const { hsl, darkText } = toHsl(t.primary);
        root.style.setProperty("--primary", hsl);
        root.style.setProperty("--ring", hsl);
        root.style.setProperty("--primary-foreground", darkText ? "220 15% 8%" : "0 0% 100%");
      }
      if (t.secondary && HEX.test(t.secondary)) root.style.setProperty("--brand-secondary", toHsl(t.secondary).hsl);
      if (!t.logo) { setLogo(null); return; }
      const { data: signed } = await supabase.storage.from("brand").createSignedUrl(t.logo, 3600);
      if (alive) setLogo(signed?.signedUrl ?? null);
    });
    return () => { alive = false; };
  }, [org, tick]);
  return null;
}
