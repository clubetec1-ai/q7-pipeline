const hex2 = (n: number) => n.toString(16).padStart(2, "0");

/**
 * Cores do logo, lidas no próprio navegador (sem IA e sem enviar o arquivo a ninguém):
 * reduz a imagem, ignora fundo transparente/branco, agrupa tons parecidos e devolve as
 * cores mais presentes (até 5), da mais usada para a menos usada.
 */
export async function logoColors(src: Blob | string): Promise<string[]> {
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
    const w = 96, h = Math.max(1, Math.round((96 * img.height) / Math.max(1, img.width)));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return [];
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const groups = new Map<string, { n: number; r: number; g: number; b: number }>();
    let total = 0;
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
      if (a < 128 || (r > 238 && g > 238 && b > 238)) continue; // fundo
      total++;
      const k = `${r >> 4},${g >> 4},${b >> 4}`;
      const e = groups.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += r; e.g += g; e.b += b;
      groups.set(k, e);
    }
    const picked: [number, number, number][] = [];
    for (const e of [...groups.values()].sort((x, y) => y.n - x.n)) {
      if (e.n < total * 0.015 || picked.length >= 5) break;
      const col: [number, number, number] = [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)];
      if (picked.every((p) => Math.hypot(p[0] - col[0], p[1] - col[1], p[2] - col[2]) > 60)) picked.push(col);
    }
    return picked.map(([r, g, b]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase());
  } catch {
    return [];
  } finally {
    if (typeof src !== "string") URL.revokeObjectURL(url);
  }
}
