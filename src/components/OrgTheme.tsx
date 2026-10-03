import { useEffect, useState, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/contexts/OrgContext";

type HSL = [number, number, number];
const HEX = /^#[0-9a-f]{6}$/i;
const NAVY = "#0B1E3D";
// Fundos de referência (iguais aos tokens de src/index.css).
const BG_LIGHT: HSL = [210, 20, 98];
const BG_DARK: HSL = [220, 18, 8];
const CARD_DARK: HSL = [220, 16, 11];

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}
function rgbToHsl([r, g, b]: [number, number, number]): HSL {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}
function hslToRgb([h, s, l]: HSL): [number, number, number] {
  const S = s / 100, L = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
/** Luminância relativa (WCAG, com linearização). */
function lum([r, g, b]: [number, number, number]) {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: [number, number, number], b: [number, number, number]) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const css = ([h, s, l]: HSL) => `${h} ${s}% ${l}%`;
/** Anda a luminosidade (passos de 2%) até atingir o contraste mínimo com o fundo. */
function reach(c: HSL, bg: HSL, min: number, dir: 1 | -1): HSL {
  let cur = c;
  while (contrast(hslToRgb(cur), hslToRgb(bg)) < min && cur[2] > 2 && cur[2] < 98) cur = [cur[0], cur[1], cur[2] + 2 * dir];
  return cur;
}

/**
 * Tema a partir da cor da empresa, com contraste WCAG real: texto do botão (branco ou
 * marinho, o que for mais legível), cor de link legível no claro e no escuro e cor
 * principal clareada no escuro quando ficaria apagada. Usada nas telas e na prévia.
 */
export function themeFor(hex: string) {
  const rgb = hexToRgb(hex);
  const base = rgbToHsl(rgb);
  const onWhite = contrast(rgb, [1, 1, 1]);
  const onNavy = contrast(rgb, hexToRgb(NAVY));
  const fgHex = onWhite >= onNavy ? "#FFFFFF" : NAVY;
  const darkPrimary = reach(base, BG_DARK, 3, 1);
  return {
    fgHex,
    readable: Math.max(onWhite, onNavy) >= 4.5,
    light: { primary: css(base), fg: css(rgbToHsl(hexToRgb(fgHex))), text: css(reach(base, BG_LIGHT, 4.5, -1)) },
    dark: {
      primary: css(darkPrimary),
      fg: css(rgbToHsl(hexToRgb(contrast(hslToRgb(darkPrimary), [1, 1, 1]) >= contrast(hslToRgb(darkPrimary), hexToRgb(NAVY)) ? "#FFFFFF" : NAVY))),
      text: css(reach(base, CARD_DARK, 4.5, 1)),
    },
  };
}

/** Logo da empresa (link temporário) para o cabeçalho; muda junto com a empresa selecionada. */
let logoUrl: string | null = null;
const listeners = new Set<() => void>();
const setLogo = (u: string | null) => { if (u !== logoUrl) { logoUrl = u; listeners.forEach((l) => l()); } };
export function useOrgLogo() {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => logoUrl);
}

const STYLE_ID = "org-theme";
function applyCss(text: string) {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!text) { el?.remove(); return; }
  if (!el) { el = document.createElement("style"); el.id = STYLE_ID; document.head.appendChild(el); }
  el.textContent = text;
}

/**
 * Aparência da empresa (Configurações → Aparência): cor principal e secundária nas
 * telas, quando o dono ligar, e o logo no cabeçalho. Trocar de empresa ou desligar
 * volta ao padrão do Deixa com a IA. As cores vão num <style> com bloco claro e
 * escuro, para o tema escuro continuar legível.
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
    const reset = () => { applyCss(""); setLogo(null); };
    if (!org) { reset(); return; }
    let alive = true;
    void supabase.rpc("org_theme", { org: org.id }).then(async ({ data }) => {
      if (!alive) return;
      const t = (data ?? {}) as { primary?: string; secondary?: string; logo?: string };
      const light: string[] = [], dark: string[] = [];
      if (t.primary && HEX.test(t.primary)) {
        const th = themeFor(t.primary);
        light.push(`--primary:${th.light.primary}`, `--ring:${th.light.primary}`, `--primary-foreground:${th.light.fg}`, `--primary-text:${th.light.text}`);
        dark.push(`--primary:${th.dark.primary}`, `--ring:${th.dark.primary}`, `--primary-foreground:${th.dark.fg}`, `--primary-text:${th.dark.text}`);
      }
      if (t.secondary && HEX.test(t.secondary)) {
        const s = css(rgbToHsl(hexToRgb(t.secondary)));
        light.push(`--brand-secondary:${s}`);
        dark.push(`--brand-secondary:${css(reach(rgbToHsl(hexToRgb(t.secondary)), BG_DARK, 3, 1))}`);
      }
      applyCss(light.length ? `:root{${light.join(";")}}.dark{${dark.join(";")}}` : "");
      if (!t.logo) { setLogo(null); return; }
      const { data: signed } = await supabase.storage.from("brand").createSignedUrl(t.logo, 3600);
      if (alive) setLogo(signed?.signedUrl ?? null);
    });
    return () => { alive = false; };
  }, [org, tick]);
  return null;
}
