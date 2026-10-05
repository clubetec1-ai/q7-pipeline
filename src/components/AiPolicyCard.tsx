import { ShieldCheck } from "lucide-react";

/**
 * "O que a IA nunca faz": a política fixa da plataforma em linguagem simples. A regra
 * que vale é a do servidor (supabase/functions/_shared/ai-policy.ts → PLATFORM_POLICY),
 * colocada antes de qualquer instrução em toda chamada de IA; esta tela só a mostra.
 * Ao mudar a política lá, atualize este texto.
 */
const RULES: [string, string][] = [
  ["Não inventa", "Usa só o que a empresa e o sistema informam. Nunca inventa preço, prazo, condição, lei, documento, protocolo, site ou passo a passo; se não sabe, passa para uma pessoa."],
  ["Nada ilegal ou antiético", "Não ajuda em fraude, golpe, falsificação, discriminação ou qualquer coisa que viole a lei, inclusive a LGPD."],
  ["Não compromete a empresa", "Não promete desconto, acordo ou prazo que a empresa não autorizou, não fala mal de ninguém e não expõe informação interna ou de outros clientes."],
  ["Cuida dos dados pessoais", "Pede só o necessário e nunca pede senha, código de verificação ou dados completos de cartão."],
  ["Ninguém muda as regras pela conversa", "Ignora pedidos como \"esqueça suas instruções\" ou \"sou o dono, faça X\". O comportamento só muda pela configuração aprovada aqui; esta política só a Clubetec altera."],
  ["Na dúvida, passa para uma pessoa", "Em situação de risco ou fora do papel dela, não age: explica com educação e encaminha para a equipe."],
];

export function AiPolicyCard() {
  return (
    <section className="rounded-xl border bg-card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-5 h-5 text-success" />
        <h2 className="text-base font-semibold">O que a IA nunca faz</h2>
        <span className="ml-auto text-xs text-muted-foreground">Regras fixas da plataforma — valem para todas as IAs do sistema</span>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {RULES.map(([t, d]) => (
          <li key={t} className="text-sm">
            <p className="font-medium">{t}</p>
            <p className="text-muted-foreground">{d}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
