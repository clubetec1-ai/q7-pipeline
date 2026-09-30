import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";

/** #RRGGBB → "H S% L%" (formato das variáveis do tema) e se o texto por cima deve ser escuro. */
function toHsl(hex: string) {
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

const VARS = ["--primary", "--primary-foreground", "--ring"];

/**
 * Cor da marca da empresa como cor principal das telas, quando o dono ligar no
 * kit da marca (Diagnóstico → Marca). Troca de empresa ou desligar volta ao padrão.
 */
export function OrgTheme() {
  const { org } = useOrg();
  // O kit da marca avisa quando o dono liga/desliga ou troca a cor: aplica de novo.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener("clubecrm:theme-changed", bump);
    return () => window.removeEventListener("clubecrm:theme-changed", bump);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    const reset = () => VARS.forEach((v) => root.style.removeProperty(v));
    if (!org) { reset(); return; }
    let alive = true;
    void supabase.rpc("org_theme", { org: org.id }).then(({ data }) => {
      if (!alive) return;
      const hex = (data as { primary?: string } | null)?.primary;
      if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) { reset(); return; }
      const { hsl, darkText } = toHsl(hex);
      root.style.setProperty("--primary", hsl);
      root.style.setProperty("--ring", hsl);
      root.style.setProperty("--primary-foreground", darkText ? "220 15% 8%" : "0 0% 100%");
    });
    return () => { alive = false; };
  }, [org, tick]);
  return null;
}
