import { createClient } from "npm:@supabase/supabase-js@2.49.1";

/**
 * Página de captação pública (Etapa B, item 3): devolve SÓ o que o dono publicou em Funil de vendas → Página de
 * captação (título, texto e o link do WhatsApp com a origem). Sem login; nada mais da empresa sai daqui.
 */
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "public, max-age=60" } });
const clip = (v: unknown, n: number) => String(v ?? "").replace(/[<>]/g, "").trim().slice(0, n);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const slug = String(body?.slug ?? new URL(req.url).searchParams.get("slug") ?? "").toLowerCase();
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) return json({ ok: false }, 404);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: org } = await admin.from("organizations").select("name, status, settings").eq("slug", slug).maybeSingle();
  const c = (org?.settings as Record<string, any> | null)?.captacao;
  if (!org || org.status !== "active" || !c?.ativo) return json({ ok: false }, 404);
  const phone = String(c.phone ?? "").replace(/\D/g, "");
  if (phone.length < 10 || phone.length > 15) return json({ ok: false }, 404);
  const origem = clip(c.origem, 30).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "site";
  const msg = clip(c.msg, 120) || "Olá! Quero saber mais.";
  return json({
    ok: true, nome: clip(org.name, 80), titulo: clip(c.titulo, 80) || clip(org.name, 80), texto: clip(c.texto, 600),
    link: `https://wa.me/${phone}?text=${encodeURIComponent(`${msg} (cód. ${origem})`)}`,
  });
});
