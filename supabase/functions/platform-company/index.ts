import { createClient } from "npm:@supabase/supabase-js@2.49.1";
import { HttpError, isPlatformOperator, requireUser } from "../_shared/auth.ts";
import { getSecret, safeEqual } from "../_shared/secrets.ts";

/**
 * Dados da Clubetec atualizados pela consulta pública do CNPJ (BrasilAPI, dados da
 * Receita Federal). Chamado pelo cron semanal (x-cron-secret) ou pela Clubetec em
 * Plataforma ("Atualizar pela Receita"). Só grava dados públicos da empresa.
 */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const s = (v: unknown, n = 200) => String(v ?? "").trim().slice(0, n);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const cron = req.headers.get("x-cron-secret");
    if (cron) {
      const expected = await getSecret(admin, "platform:cron_secret");
      if (!expected || !safeEqual(cron, expected)) return json({ ok: false, error: "unauthorized" }, 401);
    } else {
      const ctx = await requireUser(req);
      if (!(await isPlatformOperator(ctx))) throw new HttpError(403, "Só a Clubetec");
    }
    const { data: row } = await admin.from("platform_company").select("cnpj").eq("id", true).maybeSingle();
    const cnpj = String(row?.cnpj ?? "");
    if (!/^[0-9]{14}$/.test(cnpj)) throw new HttpError(409, "CNPJ da Clubetec não cadastrado");

    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!res?.ok) {
      await admin.from("platform_company").update({ refresh_error: `Consulta do CNPJ falhou (HTTP ${res?.status ?? "sem resposta"})` }).eq("id", true);
      return json({ ok: false, error: "A consulta do CNPJ não respondeu agora. Tente mais tarde." }, 502);
    }
    const d = await res.json();
    const cep = s(d.cep, 8).replace(/\D/g, "");
    const official = {
      razao_social: s(d.razao_social), nome_fantasia: s(d.nome_fantasia), cnpj,
      situacao: s(d.descricao_situacao_cadastral, 40), porte: s(d.porte, 60),
      natureza_juridica: s(d.natureza_juridica, 120), abertura: s(d.data_inicio_atividade, 10),
      endereco: {
        logradouro: [s(d.descricao_tipo_de_logradouro, 20), s(d.logradouro)].filter(Boolean).join(" "),
        numero: s(d.numero, 20), complemento: s(d.complemento, 100), bairro: s(d.bairro, 100),
        municipio: s(d.municipio, 100), uf: s(d.uf, 2), cep: cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep,
      },
      cnae_principal: { codigo: s(d.cnae_fiscal, 10), descricao: s(d.cnae_fiscal_descricao) },
      cnaes_secundarios: ((d.cnaes_secundarios ?? []) as { codigo: number; descricao: string }[])
        .filter((c) => c.codigo).slice(0, 40).map((c) => ({ codigo: s(c.codigo, 10), descricao: s(c.descricao) })),
    };
    if (!official.razao_social) throw new HttpError(502, "A consulta do CNPJ veio vazia.");
    await admin.from("platform_company").update({ official, refreshed_at: new Date().toISOString(), refresh_error: null, updated_at: new Date().toISOString() }).eq("id", true);
    return json({ ok: true, official });
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    console.error("[platform-company]", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Erro interno" }, 500);
  }
});
